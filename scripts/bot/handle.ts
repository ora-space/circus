// The bot is the only writer of labels and assignees. It
//   - sets labels written in the body when an issue opens,
//   - applies slash commands from comments, checking who may run them,
//   - reverts label and assignee changes made by hand,
//   - reopens issues closed without a summary,
//   - links runs to their parent and reports their summary back (see lib/run.ts).
// Events caused by bots (including itself) are ignored, so its own writes do not loop.
import type { GitHub, Issue } from './github.ts';
import { applyLabels, isBotLabel, isKnown, labelsFromBody } from '../lib/labels.ts';
import { parentOf, RUN_LABEL } from '../lib/run.ts';
import { parseSlash, type SlashCommand } from '../lib/slash.ts';
import { hasSummary, splitSummary, SUMMARY_HEADING } from '../lib/summary.ts';

export interface Event {
  name: string; // GITHUB_EVENT_NAME
  payload: any;
}

// Labels passed at creation arrive as separate `labeled` events right after `opened`;
// body labels seen in that window are the opener's, not a manual edit.
const OPENING_MS = 60_000;

const names = (issue: Issue) => issue.labels.map((l) => l.name);
const logins = (issue: Issue) => issue.assignees.map((a) => a.login);

// Whoever may write to the repository (the owner) has the author's rights on every issue.
// Their manual edits are still reverted: the owner's agents share the owner's account, and
// only commands leave a trace and go through the registry.
// isWriter is lazy so the permission lookup only happens for non-authors.
export function authorize(cmd: SlashCommand, actor: string, issue: Issue, isWriter: () => boolean): string | null {
  const author = issue.user.login;
  if (actor === author || isWriter()) return null;
  const who = `作者 @${author} 和有写权限的人`;
  switch (cmd.verb) {
    case 'label':
    case 'unlabel':
      return `只有${who}可以修改 label`;
    case 'assign':
      return logins(issue).includes(actor) ? null : `只有${who}以及现有 assignee 可以拉人`;
    case 'unassign': {
      const others = cmd.args.filter((u) => u !== actor);
      return others.length ? `只有${who}可以移除别人：${others.map((u) => `@${u}`).join(' ')}` : null;
    }
  }
}

function applyCommands(gh: GitHub, issue: Issue, actor: string, commands: SlashCommand[]): string[] {
  const errors: string[] = [];
  let writer: boolean | undefined;
  const isWriter = () => (writer ??= ['admin', 'write'].includes(gh.permission(actor)));
  const add: string[] = [];
  const remove: string[] = [];
  for (const cmd of commands) {
    const line = `\`/${cmd.verb}${cmd.args.length ? ' ' + cmd.args.join(' ') : ''}\``;
    if (!cmd.args.length) {
      errors.push(`${line}：缺少参数`);
      continue;
    }
    const denied = authorize(cmd, actor, issue, isWriter);
    if (denied) {
      errors.push(`${line}：${denied}`);
      continue;
    }
    const managed = cmd.args.filter(isBotLabel);
    if ((cmd.verb === 'label' || cmd.verb === 'unlabel') && managed.length) {
      errors.push(`${line}：${managed.join(' ')} 由 bot 管理`);
    }
    if (cmd.verb === 'label') {
      const unknown = cmd.args.filter((l) => !isKnown(l) && !isBotLabel(l));
      if (unknown.length) errors.push(`${line}：未登记的 label ${unknown.join(' ')}`);
      add.push(...cmd.args.filter((l) => isKnown(l)));
    } else if (cmd.verb === 'unlabel') {
      // Any other label may be removed, including ones from before the registry.
      remove.push(...cmd.args.filter((l) => !isBotLabel(l)));
    } else if (cmd.verb === 'assign') {
      const after = gh.addAssignees(issue.number, cmd.args);
      const skipped = cmd.args.filter((u) => !after.includes(u));
      if (skipped.length) errors.push(`${line}：GitHub 拒绝 assign ${skipped.map((u) => `@${u}`).join(' ')}（不是协作者？）`);
    } else {
      gh.removeAssignees(issue.number, cmd.args);
    }
  }
  if (add.length || remove.length) {
    const current = names(issue);
    const next = applyLabels(current, add, remove);
    if (next.join('\n') !== current.join('\n')) gh.setLabels(issue.number, next);
  }
  return errors;
}

// Bot-set labels an issue should carry, judged from its body.
const expectedBotLabels = (issue: Issue) => (parentOf(issue.body) !== null ? [RUN_LABEL] : []);

function openRun(gh: GitHub, run: Issue, parent: number): void {
  let item: Issue | null = null;
  try {
    item = gh.getIssue(parent);
  } catch {
    // Missing parent: reported below.
  }
  if (!item || item.pull_request || item.state !== 'open' || parentOf(item.body) !== null) {
    gh.comment(run.number, `#${parent} 不是未关闭的普通 issue，不能作为 parent。请关闭本 issue，修正首行的 \`Parent: #N\` 后重新开。`);
    return;
  }
  const current = names(gh.getIssue(run.number));
  const next = applyLabels(current, [...labelsFromBody(run.body), RUN_LABEL], []);
  if (next.join('\n') !== current.join('\n')) gh.setLabels(run.number, next);
  gh.addSubIssue(parent, run.id);
  // Fallback for runs opened without a prior /assign on the parent.
  const author = run.user.login;
  if (!logins(item).includes(author) && !gh.addAssignees(parent, [author]).includes(author)) {
    gh.comment(run.number, `无法把 @${author} assign 到 #${parent}（不是协作者？）。`);
  }
}

const REVERT_HINT = 'label 和 assignee 只能由 bot 修改：在评论里写 `/label`、`/unlabel`、`/assign`、`/unassign`。';

export function handle(event: Event, gh: GitHub): void {
  const { action, issue, sender } = event.payload;
  if (!issue || issue.pull_request || sender?.type === 'Bot') return;
  const n: number = issue.number;
  const who = `@${sender.login}`;

  switch (`${event.name}.${action}`) {
    case 'issues.opened': {
      const parent = parentOf(issue.body);
      if (parent !== null) return openRun(gh, issue, parent);
      const wanted = labelsFromBody(issue.body);
      if (!wanted.length) return;
      const current = names(gh.getIssue(n));
      const next = applyLabels(current, wanted, []);
      if (next.join('\n') !== current.join('\n')) gh.setLabels(n, next);
      return;
    }
    case 'issues.labeled': {
      const label: string = event.payload.label.name;
      const opening = Date.parse(issue.updated_at) - Date.parse(issue.created_at) < OPENING_MS;
      if (opening && labelsFromBody(issue.body).includes(label)) return;
      if (expectedBotLabels(issue).includes(label)) return;
      const current = names(gh.getIssue(n));
      if (!current.includes(label)) return;
      gh.setLabels(n, current.filter((l) => l !== label));
      gh.comment(n, `${who} 已撤销手动打上的 \`${label}\`。${REVERT_HINT}`);
      return;
    }
    case 'issues.unlabeled': {
      const label: string = event.payload.label.name;
      const current = names(gh.getIssue(n));
      if (current.includes(label)) return;
      gh.setLabels(n, [...current, label]);
      gh.comment(n, `${who} 已恢复被手动移除的 \`${label}\`。${REVERT_HINT}`);
      return;
    }
    case 'issues.assigned': {
      const user: string = event.payload.assignee.login;
      gh.removeAssignees(n, [user]);
      gh.comment(n, `${who} 已撤销手动 assign 的 @${user}。${REVERT_HINT}`);
      return;
    }
    case 'issues.unassigned': {
      const user: string = event.payload.assignee.login;
      gh.addAssignees(n, [user]);
      gh.comment(n, `${who} 已恢复被手动移除的 assignee @${user}。${REVERT_HINT}`);
      return;
    }
    case 'issues.closed': {
      if (hasSummary(issue.body)) {
        const parent = parentOf(issue.body);
        if (parent !== null) {
          const { summary } = splitSummary(issue.body);
          gh.comment(parent, `运行 #${n}（@${issue.user.login}）已结束：**${issue.title}**\n\n${summary}`);
        }
        return;
      }
      gh.reopen(n);
      gh.comment(
        n,
        `${who} 关闭前需要先总结：把整个 issue 读一遍，改成能概括结果的标题，并在正文开头写 \`${SUMMARY_HEADING}\`。` +
          '用 `node scripts/cli.ts close N --title T --summary-file F` 一步完成。已重新打开。',
      );
      return;
    }
    case 'issue_comment.created': {
      const commands = parseSlash(event.payload.comment.body);
      if (!commands.length) return;
      const errors = applyCommands(gh, gh.getIssue(n), sender.login, commands);
      if (errors.length) gh.comment(n, [`${who} 以下命令有问题，其余已执行：`, ...errors.map((e) => `- ${e}`)].join('\n'));
      else gh.react(event.payload.comment.id, '+1');
      return;
    }
  }
}
