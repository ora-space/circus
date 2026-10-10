// Event handler for the circus workflow. Labels are the source of truth:
//   status:<slug>   one per open item issue; Done is a closed issue
//   priority:<p0-3> one per item issue
//   run             a worker's single attempt at an item; first body line is "Parent: #N"
// The handler runs as the circus GitHub App. Events the App itself causes are ignored,
// so every issue it changes is synced to the Project inline.
const fs = require('fs');

const STATUS = {
  inbox: 'Inbox',
  ready: 'Ready',
  running: 'Running',
  'needs-owner': 'Needs Owner',
  'in-review': 'In Review',
};
const DEFAULT_OUTCOME = 'needs-owner';

function readEnv(path = 'circus.env') {
  const env = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^(\w+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const labelNames = (issue) => issue.labels.map((l) => (typeof l === 'string' ? l : l.name));
const parentOf = (issue) => {
  const m = /^Parent:\s*#(\d+)/.exec((issue.body || '').trimStart());
  return m ? Number(m[1]) : null;
};
const isRun = (issue) => labelNames(issue).includes('run') || parentOf(issue) !== null;

// "状态：In Review" in the latest report decides what happens to the item when a run closes.
function outcomeOf(comments) {
  for (const c of [...comments].reverse()) {
    const m = /^\s*[-*]?\s*状态\s*[:：]\s*(.+?)\s*$/m.exec(c.body || '');
    if (!m) continue;
    const slug = m[1].toLowerCase().replace(/[\s_]+/g, '-').replace(/`/g, '');
    if (slug === 'done' || slug in STATUS) return slug;
  }
  return DEFAULT_OUTCOME;
}

module.exports = async function handle({ github, context, core, env = readEnv() }) {
  const { action, issue, sender, label } = context.payload;
  if (sender.type === 'Bot' || issue.pull_request) return;
  const { owner, repo } = context.repo;
  const base = { owner, repo };

  const getIssue = async (n) => (await github.rest.issues.get({ ...base, issue_number: n })).data;
  const comment = (n, body) => github.rest.issues.createComment({ ...base, issue_number: n, body });
  const addLabels = (n, labels) => github.rest.issues.addLabels({ ...base, issue_number: n, labels });
  const removeLabel = (n, name) =>
    github.rest.issues.removeLabel({ ...base, issue_number: n, name }).catch((e) => {
      if (e.status !== 404) throw e;
    });

  // Keep exactly one label with the given prefix (or none when keep is null).
  async function setExclusive(n, prefix, keep) {
    const current = labelNames(await getIssue(n)).filter((l) => l.startsWith(prefix));
    for (const l of current) if (l !== keep) await removeLabel(n, l);
    if (keep && !current.includes(keep)) await addLabels(n, [keep]);
  }
  const setStatus = (n, slug) => setExclusive(n, 'status:', slug ? `status:${slug}` : null);

  async function ensureDefaults(item) {
    const names = labelNames(item);
    const add = [];
    if (!names.some((l) => l.startsWith('status:'))) add.push('status:inbox');
    if (!names.some((l) => l.startsWith('priority:'))) add.push('priority:p2');
    if (add.length) await addLabels(item.number, add);
  }

  let projectMeta;
  async function project() {
    if (projectMeta) return projectMeta;
    const data = await github.graphql(
      `query($o: String!, $n: Int!) { organization(login: $o) { projectV2(number: $n) {
        id fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }`,
      { o: env.CIRCUS_OWNER, n: Number(env.CIRCUS_PROJECT) },
    );
    const p = data.organization.projectV2;
    projectMeta = { id: p.id, fields: Object.fromEntries(p.fields.nodes.filter((f) => f.name).map((f) => [f.name, f])) };
    return projectMeta;
  }

  // Mirror an item issue's state and labels onto the Project board.
  async function sync(n) {
    const item = await getIssue(n);
    if (isRun(item) || item.pull_request) return;
    const p = await project();
    const added = await github.graphql(
      `mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: {projectId: $p, contentId: $c}) { item { id } } }`,
      { p: p.id, c: item.node_id },
    );
    const itemId = added.addProjectV2ItemById.item.id;
    const names = labelNames(item);
    const slug = (prefix) => names.find((l) => l.startsWith(prefix))?.slice(prefix.length);
    const values = {
      Status: item.state === 'closed' ? 'Done' : STATUS[slug('status:')] || 'Inbox',
      Priority: slug('priority:')?.toUpperCase(),
    };
    for (const [field, value] of Object.entries(values)) {
      if (!value) continue;
      const f = p.fields[field];
      const option = f?.options.find((o) => o.name === value);
      if (!option) {
        core.warning(`Project 缺少字段 ${field} 或选项 ${value}`);
        continue;
      }
      await github.graphql(
        `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input:
          {projectId: $p, itemId: $i, fieldId: $f, value: {singleSelectOptionId: $o}}) { projectV2Item { id } } }`,
        { p: p.id, i: itemId, f: f.id, o: option.id },
      );
    }
  }

  async function openRunsOf(parent, except) {
    const { data } = await github.request('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
      ...base,
      issue_number: parent,
      per_page: 100,
    });
    return data.filter((i) => i.state === 'open' && i.number !== except && isRun(i));
  }

  if (isRun(issue)) {
    const parent = parentOf(issue);
    if (!parent) return;

    if (action === 'opened') {
      let item;
      try {
        item = await getIssue(parent);
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      if (!item || item.pull_request || isRun(item) || item.state === 'closed') {
        await comment(issue.number, `#${parent} 不是一个未关闭的事项 issue。请关闭本 issue，修正首行的 \`Parent: #N\` 后重新开。`);
        return;
      }
      await addLabels(issue.number, ['run']);
      await github.request('POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
        ...base,
        issue_number: parent,
        sub_issue_id: issue.id,
      });
      await setStatus(parent, 'running');
      await sync(parent);
    } else if (action === 'reopened') {
      await setStatus(parent, 'running');
      await sync(parent);
    } else if (action === 'closed') {
      const { data: comments } = await github.rest.issues.listComments({ ...base, issue_number: issue.number, per_page: 100 });
      const outcome = outcomeOf(comments);
      const others = await openRunsOf(parent, issue.number);
      const label = outcome === 'done' ? 'Done' : STATUS[outcome];
      if (others.length && outcome !== 'done') {
        await comment(parent, `运行 #${issue.number} 结束（${label}）；仍有运行在进行：${others.map((i) => `#${i.number}`).join(' ')}。`);
        return;
      }
      if (outcome === 'done') {
        await setStatus(parent, null);
        await github.rest.issues.update({ ...base, issue_number: parent, state: 'closed', state_reason: 'completed' });
      } else {
        await setStatus(parent, outcome);
      }
      await comment(parent, `运行 #${issue.number} 结束 → **${label}**。汇报见 #${issue.number}。`);
      await sync(parent);
    }
    return;
  }

  // Item issues.
  if (action === 'opened' || action === 'reopened') {
    await ensureDefaults(issue);
  } else if (action === 'closed') {
    await setStatus(issue.number, null);
  } else if (action === 'labeled' && label) {
    for (const prefix of ['status:', 'priority:']) {
      if (label.name.startsWith(prefix)) await setExclusive(issue.number, prefix, label.name);
    }
  }
  await sync(issue.number);
};

module.exports.outcomeOf = outcomeOf;
module.exports.parentOf = parentOf;
