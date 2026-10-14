import { readFileSync } from 'node:fs';
import type { Command } from '../lib/context.ts';
import { ghGitHub } from './github.ts';
import { handle } from './handle.ts';
import { ghBoard } from '../lib/board.ts';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { runtime } from './notifications/runtime.ts';
import { fileStore, flush } from './notifications/store.ts';
import { observeHandle, snapshot } from './notifications/observe.ts';
import { linkedPulls } from './notifications/github.ts';

const usage = `bot [--config-file F] [--credentials-file F] [--recipients-file F] [--state-file F]
    GitHub Action 调用：读取 GITHUB_EVENT_NAME、GITHUB_EVENT_PATH、GITHUB_REPOSITORY，以 GH_TOKEN 的身份处理事件。`;

export const command: Command = {
  usage,
  async run(args, ctx) {
    const { values } = parseArgs({ args, options: {
      'config-file': { type: 'string' }, 'credentials-file': { type: 'string' }, 'recipients-file': { type: 'string' }, 'state-file': { type: 'string' },
    } });
    const { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: path, GITHUB_REPOSITORY: repo } = ctx.env;
    if (!name || !path || !repo) throw new Error('bot: 只在 GitHub Action 中运行');
    const board = ghBoard(ctx.gh, repo.split('/')[0], ctx.project);
    const event = { name, payload: JSON.parse(readFileSync(path, 'utf8')) };
    const gh = ghGitHub(ctx.gh, repo);
    const { config, sender } = runtime(ctx, { config: values['config-file'], credentials: values['credentials-file'], recipients: values['recipients-file'] });
    if (!config.enabled) return handle(event, gh, board);
    const statePath = values['state-file'] ?? ctx.env.CIRCUS_NOTIFICATION_STATE;
    if (!statePath) throw new Error('启用通知须指定持久 CIRCUS_NOTIFICATION_STATE 或 --state-file；不能使用临时 runner 状态冒充持久存储');
    const store = fileStore(resolve(ctx.root,statePath));
    const pulls = (n: number) => linkedPulls(ctx.gh,repo,n);
    let failure: unknown;
    try {
      try { observeHandle(event,gh,repo,store,config,board,pulls); } catch (e) { failure = e; }
      const result = await flush(store,config,sender!,n=>snapshot(gh,repo,n,pulls),ctx.out);
      if (result.failed) failure ??= new Error('存在未送达通知，已保留待发记录');
      if (failure) throw failure;
    } finally { store.close(); }
  },
};
