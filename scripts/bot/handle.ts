// The bot is the only writer of labels and assignees, and the path agents use for
// dependencies (hand edits to dependencies are allowed). It
//   - sets labels and dependencies written in the body when an issue opens,
//   - applies slash commands from comments, checking who may run them,
//   - reverts label and assignee changes made by hand,
//   - reopens issues closed without a summary or by someone other than the author (unless
//     the summary says why), and tells dependents when a blocker closes,
//   - reminds authors to close their issues when a circus PR referencing them is merged,
//   - links runs to their parent and reports their summary back (see lib/run.ts),
//   - lets others review runs awaiting review (review:lgtm, status:needs-author),
//   - drops status and review labels on close and mirrors issues onto the board (see lib/board.ts);
//     nobody else writes to the board.
// Events caused by bots (including itself) are ignored, so its own writes do not loop.
import type { GitHub, Issue } from './github.ts';
import { boardValues, type Board } from '../lib/board.ts';
import { dependsFromBody } from '../lib/deps.ts';
import { applyLabels, isBotLabel, isKnown, labelsFromBody } from '../lib/labels.ts';
import { parentOf, RUN_LABEL } from '../lib/run.ts';
import { parseSlash, type SlashCommand } from '../lib/slash.ts';
import { closedForAuthor, hasSummary, splitSummary, SUMMARY_HEADING } from '../lib/summary.ts';

export interface Event {
  name: string; // GITHUB_EVENT_NAME
  payload: any;
}

export interface Effects { acceptedLabel(n: number, label: string): void }

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
      if (parentOf(issue.body) === null || !logins(issue).includes(actor)) return `只有${who}可以修改 label`;
      return cmd.args.every((l) => REVIEWER_LABELS[cmd.verb as 'label' | 'unlabel'].includes(l))
        ? null
        : `只有${who}可以修改 label；reviewer（运行 issue 的 assignee）只能 \`/label ${LGTM}\`、\`/label ${NEEDS_AUTHOR}\`、\`/unlabel ${LGTM}\``;
    case 'depend':
    case 'undepend':
      return `只有${who}可以修改依赖`;
    case 'assign':
      return logins(issue).includes(actor) ? null : `只有${who}以及现有 assignee 可以拉人`;
    case 'unassign': {
      const others = cmd.args.filter((u) => u !== actor);
      return others.length ? `只有${who}可以移除别人：${others.map((u) => `@${u}`).join(' ')}` : null;
    }
  }
}

// On a run, the assignees are the reviewers its author asked for. Besides the owner, they may
// approve a run awaiting review with review:lgtm, or hand it back with status:needs-author
// (which then replaces status:in-review).
export const LGTM = 'review:lgtm';
const IN_REVIEW = 'status:in-review';
const NEEDS_AUTHOR = 'status:needs-author';
const REVIEWER_LABELS = { label: [LGTM, NEEDS_AUTHOR], unlabel: [LGTM] };

// A commit SHA (7–40 hex digits, at least one digit) says which revision an lgtm approved.
const COMMIT_SHA = /(?<![\w])(?=[a-f]*\d)[0-9a-f]{7,40}(?![\w])/;

// Why adding a review label is refused given the labels so far; null when allowed.
function reviewRule(label: string, actor: string, issue: Issue, labels: string[], comment: string, isWriter: () => boolean): string | null {
  if (label === LGTM) {
    if (parentOf(issue.body) === null) return `${LGTM} 只用于运行 issue`;
    if (actor === issue.user.login) return `作者不能给自己的运行 issue 打 ${LGTM}`;
    if (!labels.includes(IN_REVIEW)) return `只能在 ${IN_REVIEW} 时打 ${LGTM}`;
    if (!COMMIT_SHA.test(comment)) return `评论里要写明审过的 commit SHA`;
  }
  if (label === NEEDS_AUTHOR && actor !== issue.user.login && !isWriter() && !labels.includes(IN_REVIEW)) {
    return `reviewer 只能在 ${IN_REVIEW} 时打 ${NEEDS_AUTHOR}`;
  }
  return null;
}

function applyCommands(gh: GitHub, issue: Issue, actor: string, commands: SlashCommand[], comment: string, effects?: Effects): string[] {
  const errors: string[] = [];
  const accepted: string[] = [];
  let writer: boolean | undefined;
  const isWriter = () => (writer ??= ['admin', 'write'].includes(gh.permission(actor)));
  // Labels are applied in command order, so review rules see the labels set before them.
  const current = names(issue);
  let labels = current;
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
      for (const l of cmd.args.filter((x) => isKnown(x))) {
        const refused = reviewRule(l, actor, issue, labels, comment, isWriter);
        if (refused) {
          errors.push(`${line}：${refused}`);
          continue;
        }
        labels = applyLabels(labels, [l], []);
        accepted.push(l);
        // A new revision to review, or changes requested: an earlier lgtm no longer holds.
        if (l === IN_REVIEW || l === NEEDS_AUTHOR) labels = labels.filter((x) => x !== LGTM);
      }
    } else if (cmd.verb === 'unlabel') {
      // Any other label may be removed, including ones from before the registry.
      labels = applyLabels(labels, [], cmd.args.filter((l) => !isBotLabel(l)));
    } else if (cmd.verb === 'assign') {
      const after = gh.addAssignees(issue.number, cmd.args);
      const skipped = cmd.args.filter((u) => !after.includes(u));
      if (skipped.length) errors.push(`${line}：GitHub 拒绝 assign ${skipped.map((u) => `@${u}`).join(' ')}（不是协作者？）`);
    } else if (cmd.verb === 'depend') {
      errors.push(...addDependencies(gh, issue.number, cmd.args).map((e) => `${line}：${e}`));
    } else if (cmd.verb === 'undepend') {
      for (const arg of cmd.args) {
        const blocker = resolve(gh, issue.number, arg);
        if (typeof blocker === 'string') errors.push(`${line}：${blocker}`);
        else gh.removeBlockedBy(issue.number, blocker.id);
      }
    } else {
      gh.removeAssignees(issue.number, cmd.args);
    }
  }
  if (labels.join('\n') !== current.join('\n')) gh.setLabels(issue.number, labels);
  for (const label of accepted.filter(l => labels.includes(l))) effects?.acceptedLabel(issue.number, label);
  return errors;
}

// Bot-set labels an issue should carry, judged from its body.
// The issue an argument names, or why it cannot be a dependency of n.
function resolve(gh: GitHub, n: number, arg: string): Issue | string {
  if (!/^\d+$/.test(arg)) return `${arg} 不是 issue 编号`;
  if (Number(arg) === n) return '不能依赖自己';
  try {
    const issue = gh.getIssue(Number(arg));
    return issue.pull_request ? `#${arg} 是 PR，不是 issue` : issue;
  } catch {
    return `#${arg} 不存在`;
  }
}

// Marks n as blocked by each issue; returns the problems.
function addDependencies(gh: GitHub, n: number, args: (string | number)[]): string[] {
  const errors: string[] = [];
  for (const arg of args) {
    const blocker = resolve(gh, n, String(arg));
    if (typeof blocker === 'string') {
      errors.push(blocker);
      continue;
    }
    try {
      gh.addBlockedBy(n, blocker.id);
    } catch (e) {
      errors.push(`无法依赖 #${blocker.number}：${(e as Error).message.split('\n')[0]}`);
    }
  }
  return errors;
}

const openRefs = (issues: Issue[]) => issues.filter((i) => i.state === 'open').map((i) => `#${i.number}`);

const expectedBotLabels = (issue: Issue) => (parentOf(issue.body) !== null ? [RUN_LABEL] : []);

function openRun(gh: GitHub, run: Issue, parent: number): number | null {
  let item: Issue | null = null;
  try {
    item = gh.getIssue(parent);
  } catch {
    // Missing parent: reported below.
  }
  if (!item || item.pull_request || item.state !== 'open' || parentOf(item.body) !== null) {
    gh.comment(run.number, `#${parent} 不是未关闭的普通 issue，不能作为 parent。请关闭本 issue，修正首行的 \`Parent: #N\` 后重新开。`);
    return null;
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
  const waiting = openRefs(gh.blockedBy(parent));
  if (waiting.length) gh.comment(run.number, `提醒：#${parent} 还有未完成的依赖 ${waiting.join(' ')}。可以先做不受影响的部分。`);
  return parent;
}

const REVERT_HINT = 'label 和 assignee 只能由 bot 修改：在评论里写 `/label`、`/unlabel`、`/assign`、`/unassign`。';

// When a blocker closes, each open dependent hears what is left; returns the dependents.
function notifyDependents(gh: GitHub, blocker: Issue): number[] {
  const dependents = gh.blocking(blocker.number).filter((i) => i.state === 'open');
  for (const d of dependents) {
    const left = openRefs(gh.blockedBy(d.number)).filter((r) => r !== `#${blocker.number}`);
    const next = left.length ? `还在等 ${left.join(' ')}` : '依赖都已完成，可以开始';
    gh.comment(d.number, `依赖 #${blocker.number} 已关闭：**${blocker.title}**，总结见 #${blocker.number}。${next}。`);
  }
  return dependents.map((d) => d.number);
}

// Mirrors a non-run issue onto the board.
function syncBoard(gh: GitHub, board: Board, item: Issue): void {
  if (item.pull_request || parentOf(item.body) !== null) return;
  const openRuns = gh.subIssues(item.number).filter((i) => i.state === 'open' && parentOf(i.body) !== null).length;
  board.sync(item.node_id, boardValues(item, openRuns, item.issue_dependencies_summary?.blocked_by ?? 0));
}

// Scheduled and manual workflow runs resync every open issue, which also undoes edits
// made on the board by hand and refills values cleared by a Status options change.
const RESYNC_EVENTS = ['schedule', 'workflow_dispatch'];

// Issues a PR body points at with "Refs/Fixes/Closes/Resolves #N" (or owner/repo#N for this repository).
export function referencedIssues(body: string | null | undefined, repo: string): number[] {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(?:refs|fixes|fixed|closes|closed|resolves|resolved)\\s*:?\\s+(?:${escaped})?#(\\d+)`, 'gi');
  const out: number[] = [];
  for (const m of (body ?? '').matchAll(re)) if (!out.includes(Number(m[1]))) out.push(Number(m[1]));
  return out;
}

// A merged PR does not close its issues: their authors do, after summarizing.
function remindAuthors(gh: GitHub, payload: any): void {
  const pr = payload.pull_request;
  if (payload.action !== 'closed' || !pr?.merged || payload.sender?.type === 'Bot') return;
  for (const n of referencedIssues(pr.body, payload.repository.full_name)) {
    let issue: Issue;
    try {
      issue = gh.getIssue(n);
    } catch {
      continue;
    }
    if (issue.pull_request || issue.state !== 'open') continue;
    gh.comment(
      n,
      `@${issue.user.login} PR #${pr.number} 已由 @${payload.sender.login} 合并。请作者把整个 issue 读一遍，写总结后关闭：` +
        `\`node scripts/cli.ts close ${n} --title "<结果>" --summary-file <文件>\`。`,
    );
  }
}

export function handle(event: Event, gh: GitHub, board?: Board, effects?: Effects): void {
  if (event.name === 'pull_request_target') return remindAuthors(gh, event.payload);
  if (RESYNC_EVENTS.includes(event.name)) {
    if (board) for (const item of gh.listOpenIssues()) syncBoard(gh, board, item);
    return;
  }
  const touched = dispatch(event, gh, effects);
  if (board) for (const n of new Set(touched)) syncBoard(gh, board, gh.getIssue(n));
}

// Applies the event and returns the issues whose board entry may have changed.
function dispatch(event: Event, gh: GitHub, effects?: Effects): number[] {
  const { action, issue, sender } = event.payload;
  if (!issue || issue.pull_request || sender?.type === 'Bot') return [];
  const n: number = issue.number;
  const who = `@${sender.login}`;

  switch (`${event.name}.${action}`) {
    case 'issues.opened': {
      const parent = parentOf(issue.body);
      if (parent !== null) {
        const synced = openRun(gh, issue, parent);
        return synced === null ? [] : [synced];
      }
      const failed = addDependencies(gh, n, dependsFromBody(issue.body));
      if (failed.length) gh.comment(n, [`正文里的依赖有问题：`, ...failed.map((e) => `- ${e}`), '', '用 `/depend #N` 补上。'].join('\n'));
      const wanted = labelsFromBody(issue.body);
      if (wanted.length) {
        const current = names(gh.getIssue(n));
        const next = applyLabels(current, wanted, []);
        if (next.join('\n') !== current.join('\n')) gh.setLabels(n, next);
      }
      return [n];
    }
    case 'issues.labeled': {
      const label: string = event.payload.label.name;
      const opening = Date.parse(issue.updated_at) - Date.parse(issue.created_at) < OPENING_MS;
      if (opening && labelsFromBody(issue.body).includes(label)) return [];
      if (expectedBotLabels(issue).includes(label)) return [];
      const current = names(gh.getIssue(n));
      if (!current.includes(label)) return [];
      gh.setLabels(n, current.filter((l) => l !== label));
      gh.comment(n, `${who} 已撤销手动打上的 \`${label}\`。${REVERT_HINT}`);
      return [];
    }
    case 'issues.unlabeled': {
      const label: string = event.payload.label.name;
      const current = names(gh.getIssue(n));
      if (current.includes(label)) return [];
      gh.setLabels(n, [...current, label]);
      gh.comment(n, `${who} 已恢复被手动移除的 \`${label}\`。${REVERT_HINT}`);
      return [];
    }
    case 'issues.assigned': {
      const user: string = event.payload.assignee.login;
      gh.removeAssignees(n, [user]);
      gh.comment(n, `${who} 已撤销手动 assign 的 @${user}。${REVERT_HINT}`);
      return [];
    }
    case 'issues.unassigned': {
      const user: string = event.payload.assignee.login;
      gh.addAssignees(n, [user]);
      gh.comment(n, `${who} 已恢复被手动移除的 assignee @${user}。${REVERT_HINT}`);
      return [];
    }
    case 'issues.closed': {
      const author: string = issue.user.login;
      if (hasSummary(issue.body) && sender.login !== author && !closedForAuthor(splitSummary(issue.body).summary, author)) {
        gh.reopen(n);
        gh.comment(
          n,
          `${who} 这个 issue 应由作者 @${author} 关闭，已重新打开。@${author} 请把整个 issue 读一遍，写总结后关闭。` +
            '确需代关时，用 `node scripts/cli.ts close N --for-author "<理由>"`，总结第一行会记下代关理由。',
        );
        return [n];
      }
      if (hasSummary(issue.body)) {
        // Done is the closed state itself, not a label; neither is a review left on it.
        const current = names(gh.getIssue(n));
        const open = current.filter((l) => !l.startsWith('status:') && !l.startsWith('review:'));
        if (open.length !== current.length) gh.setLabels(n, open);
        const parent = parentOf(issue.body);
        if (parent === null) return [n, ...notifyDependents(gh, issue)];
        const { summary } = splitSummary(issue.body);
        gh.comment(parent, `运行 #${n}（@${issue.user.login}）已结束：**${issue.title}**\n\n${summary}`);
        return [parent, ...notifyDependents(gh, issue)];
      }
      gh.reopen(n);
      gh.comment(
        n,
        `${who} 关闭前需要先总结：把整个 issue 读一遍，改成能概括结果的标题，并在正文开头写 \`${SUMMARY_HEADING}\`。` +
          '用 `node scripts/cli.ts close N --title T --summary-file F` 一步完成。已重新打开。',
      );
      return [n];
    }
    case 'issues.reopened': {
      const parent = parentOf(issue.body);
      if (parent !== null) return [parent, ...gh.blocking(n).filter((i) => i.state === 'open').map((i) => i.number)];
      return [n, ...gh.blocking(n).filter((i) => i.state === 'open').map((i) => i.number)];
    }
    case 'issue_comment.created': {
      const commands = parseSlash(event.payload.comment.body);
      if (!commands.length) return [];
      const errors = applyCommands(gh, gh.getIssue(n), sender.login, commands, event.payload.comment.body, effects);
      if (errors.length) gh.comment(n, [`${who} 以下命令有问题，其余已执行：`, ...errors.map((e) => `- ${e}`)].join('\n'));
      else gh.react(event.payload.comment.id, '+1');
      return [n];
    }
  }
  return [];
}
