import { readFileSync } from 'node:fs';
import { parseConfig, type NotificationConfig } from './config.ts';
import { feishuApp, parseRecipients, type Sender } from './feishu.ts';
import type { Context } from '../../lib/context.ts';
export const readJson = (path: string): unknown => {
  // Hide JSON parse snippets: a malformed credential must not be echoed in an exception.
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('无法读取 JSON 配置，请检查文件路径与格式'); }
};
export function runtime(ctx: Context, options: { config?: string; credentials?: string; recipients?: string }): { config: NotificationConfig; sender?: Sender } {
  const config = parseConfig(readJson(options.config ?? `${ctx.root}/scripts/bot/notifications/notifications.json`));
  // Repository variable is the deployment switch; event payloads cannot override it.
  const enabled = ctx.env.CIRCUS_NOTIFICATIONS_ENABLED;
  if (enabled !== undefined && enabled !== '') {
    if (!['true', 'false'].includes(enabled)) throw new Error('CIRCUS_NOTIFICATIONS_ENABLED 必须为 true 或 false');
    config.enabled = enabled === 'true';
  }
  // Owner logins come from a repository variable too, so changing who receives owner notices needs no PR.
  const owners = ctx.env.CIRCUS_OWNER_RECIPIENTS?.trim();
  if (owners) {
    const logins = owners.split(/[\s,]+/).filter(Boolean);
    if (logins.some(x => !/^[\w-]+$/.test(x))) throw new Error('CIRCUS_OWNER_RECIPIENTS 必须是用逗号或空格分隔的 GitHub login');
    config.ownerRecipients = [...new Set(logins.map(x => x.toLowerCase()))];
  }
  if (!config.enabled) return { config };
  if (config.transport !== 'feishu-app') throw new Error('本次实现仅支持 feishu-app；群 webhook 尚未实现，不能启用');
  const credentials = options.credentials ? readJson(options.credentials) as { app_id: string; app_secret: string }
    : { app_id: ctx.env.FEISHU_APP_ID ?? '', app_secret: ctx.env.FEISHU_APP_SECRET ?? '' };
  let raw: unknown;
  if (options.recipients) raw = readJson(options.recipients);
  else {
    try { raw = JSON.parse(ctx.env.FEISHU_RECIPIENTS_JSON ?? '{}'); }
    catch { throw new Error('FEISHU_RECIPIENTS_JSON 格式错误'); }
  }
  return { config, sender: feishuApp({ app_id: credentials.app_id, app_secret: credentials.app_secret }, parseRecipients(raw)) };
}
