import { readFileSync } from 'node:fs';
import type { Command } from '../lib/context.ts';
import { ghGitHub } from './github.ts';
import { handle } from './handle.ts';
import { ghBoard } from '../lib/board.ts';
import { parseArgs } from 'node:util';
import { ghWithToken } from '../lib/gh.ts';
import { resolve } from 'node:path';
import { runtime } from './notifications/runtime.ts';
import { fileStore, flush } from './notifications/store.ts';
import { observeHandle, snapshot } from './notifications/observe.ts';
import { linkedPulls } from './notifications/github.ts';
import { deliverEvent } from './notifications/deliver.ts';

const usage = `bot [--config-file F] [--credentials-file F] [--recipients-file F] [--state-file F]
    GitHub Action 调用：读取 GITHUB_EVENT_NAME、GITHUB_EVENT_PATH、GITHUB_REPOSITORY，以 GH_TOKEN 的身份处理事件；CIRCUS_PRODUCTS_TOKEN 用于在产品仓库重跑 CI。`;

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
    // CIRCUS_PRODUCTS_TOKEN only reaches the product repositories' Actions, for /rerun.
    const products = ctx.env.CIRCUS_PRODUCTS_TOKEN;
    const gh = ghGitHub(ctx.gh, repo, products ? ghWithToken(products) : undefined);
    let settings: ReturnType<typeof runtime>;
    try {
      settings = runtime(ctx, { config: values['config-file'], credentials: values['credentials-file'], recipients: values['recipients-file'] });
    } catch {
      ctx.out('通知配置或凭据不可用，本次通知跳过；请检查通知开关及 Actions Secrets');
      return handle(event, gh, board);
    }
    const { config, sender } = settings;
    if (!config.enabled) return handle(event, gh, board);
    const statePath = values['state-file'] ?? ctx.env.CIRCUS_NOTIFICATION_STATE;
    const pulls = (n: number) => linkedPulls(ctx.gh,repo,n);
    if (!statePath) return deliverEvent(event, gh, repo, config, sender!, ctx.out, board, pulls);
    const store = fileStore(resolve(ctx.root,statePath));
    let failure: unknown;
    try {
      try { observeHandle(event,gh,repo,store,config,board,pulls); } catch (e) { failure = e; }
      const result = await flush(store,config,sender!,n=>snapshot(gh,repo,n,pulls),ctx.out);
      if (result.failed) failure ??= new Error('存在未送达通知，已保留待发记录');
      if (failure) throw failure;
    } finally { store.close(); }
  },
};
