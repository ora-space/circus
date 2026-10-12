import type { Command } from '../lib/context.ts';
import { describeIdentity, whoami } from '../lib/identity.ts';

const usage = `whoami
    当前 GitHub 账号及其角色：owner（有写权限）或成员（只读）。agent 和它的人共用账号，所以这也是和你对话的人。`;

export const command: Command = {
  usage,
  run(_args, ctx) {
    ctx.out(describeIdentity(whoami(ctx)));
  },
};
