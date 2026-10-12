import { parseArgs } from 'node:util';
import { issueNumber, type Command } from '../lib/context.ts';
import { cleanupIssue, reportCleanup } from '../lib/cleanup.ts';
import { whoami } from '../lib/identity.ts';

const usage = `cleanup N [--dry-run]
    清理为 #N 做的本地工作：引用 #N 的 PR 中，由你的 fork 提出、已合并或关闭的，删除它在本地的 worktree 和分支。
    本地有 PR 之外的提交、worktree 有未提交的改动、分支检出在主目录时一律保留。close 关闭后会自动执行。`;

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { 'dry-run': { type: 'boolean', default: false } },
    });
    const n = issueNumber(positionals[0], usage);
    const dryRun = values['dry-run'];
    for (const line of reportCleanup(cleanupIssue(ctx, n, whoami(ctx).login, dryRun), dryRun)) ctx.out(line);
  },
};
