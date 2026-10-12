import { readFileSync } from 'node:fs';
import type { Command } from '../lib/context.ts';
import { ghGitHub } from './github.ts';
import { handle } from './handle.ts';

const usage = `bot
    GitHub Action 调用：读取 GITHUB_EVENT_NAME、GITHUB_EVENT_PATH、GITHUB_REPOSITORY，以 GH_TOKEN 的身份处理事件。`;

export const command: Command = {
  usage,
  run(_args, ctx) {
    const { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: path, GITHUB_REPOSITORY: repo } = ctx.env;
    if (!name || !path || !repo) throw new Error('bot: 只在 GitHub Action 中运行');
    handle({ name, payload: JSON.parse(readFileSync(path, 'utf8')) }, ghGitHub(ctx.gh, repo));
  },
};
