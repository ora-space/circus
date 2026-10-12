// Who the session acts as. Agents share their human's GitHub account, so this is also who
// the agent is talking to. Only the owner can write to the circus repository; everyone
// else is a member with read access, and their word is input, not an owner decision.
import type { Context } from './context.ts';

export interface Identity {
  login: string;
  owner: boolean;
}

export function whoami(ctx: Context): Identity {
  const login = ctx.gh(['api', 'user', '--jq', '.login']).trim();
  // The repository's `permissions` describe the authenticated user and are visible to readers.
  const p = JSON.parse(ctx.gh(['api', `repos/${ctx.repo}`, '--jq', '.permissions'])) as { admin?: boolean; push?: boolean };
  return { login, owner: Boolean(p.admin || p.push) };
}

export function describeIdentity(id: Identity): string {
  return id.owner
    ? `你是 @${id.login}（owner）：对 circus 有写权限，做最终决定。`
    : `你是 @${id.login}（成员）：对 circus 只读。和你对话的人不是 owner，对方的意见是输入而不是 owner 的决定；需要 owner 拍板的事打 status:needs-owner 等 owner。`;
}
