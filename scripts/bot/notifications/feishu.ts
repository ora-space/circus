export interface Recipient { mobile?: string; open_id?: string }
export type Recipients = Record<string, Recipient>;
export interface Sender {
  identity(login: string): Promise<string>;
  send(identity: string, text: string, id: string): Promise<void>;
}
export function parseRecipients(raw: unknown): Recipients {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('人员映射必须是对象');
  const result: Recipients = {};
  for (const [login, item] of Object.entries(raw)) {
    if (!/^[\w-]+$/.test(login) || !item || typeof item !== 'object' || Array.isArray(item)) throw new Error('人员映射格式错误');
    const r = item as Recipient;
    if (Object.keys(r).some(k => !['mobile', 'open_id'].includes(k)) || (!!r.mobile === !!r.open_id)) throw new Error('人员映射每人须且仅须设置 mobile 或 open_id');
    if (r.mobile !== undefined && (typeof r.mobile !== 'string' || !/^\+?[\d -]{5,20}$/.test(r.mobile))) throw new Error('人员映射手机号格式错误');
    if (r.open_id !== undefined && (typeof r.open_id !== 'string' || !/^ou_[\w]+$/.test(r.open_id))) throw new Error('人员映射 open_id 格式错误');
    if (result[login.toLowerCase()]) throw new Error('人员映射包含重复 GitHub 账号');
    result[login.toLowerCase()] = r;
  }
  return result;
}
export class DeliveryError extends Error {
  retryable: boolean;
  constructor(stage: string, code: string | number, retryable = false) {
    super(`飞书 ${stage} 失败（${code}）`); this.retryable = retryable;
  }
}
export function feishuApp(
  credentials: { app_id: string; app_secret: string }, recipients: Recipients,
  request: typeof fetch = fetch, now = Date.now,
): Sender {
  if (typeof credentials.app_id !== 'string' || !credentials.app_id || typeof credentials.app_secret !== 'string' || !credentials.app_secret) throw new Error('缺少有效飞书应用凭据');
  let token: string | undefined;
  let expires = 0;
  const identities = new Map<string, string>();
  async function post(stage: string, endpoint: string, body: unknown, auth?: string): Promise<any> {
    let response: Response;
    try {
      response = await request(`https://open.feishu.cn/open-apis/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new DeliveryError(stage, 'network/timeout', true); }
    let result: any;
    try { result = await response.json(); } catch { throw new DeliveryError(stage, `HTTP ${response.status}/invalid-json`, true); }
    if (!response.ok || result.code !== 0) {
      // Never include server msg, raw bodies, URLs, credentials, mobile or token in errors/logs.
      const code = result.code ?? response.status;
      throw new DeliveryError(stage, code, response.status >= 500 || response.status === 429 || [99991400, 99991401, 99991402, 11232, 11247].includes(code));
    }
    return result;
  }
  async function accessToken() {
    if (token && now() < expires) return token;
    const result = await post('token', 'auth/v3/tenant_access_token/internal', credentials);
    if (typeof result.tenant_access_token !== 'string' || typeof result.expire !== 'number') throw new DeliveryError('token', 'invalid-response');
    token = result.tenant_access_token; expires = now() + Math.max(0, result.expire - 60) * 1000;
    return token;
  }
  return {
    async identity(login) {
      const key = login.toLowerCase();
      if (identities.has(key)) return identities.get(key)!;
      const person = recipients[key];
      if (!person) throw new DeliveryError('人员映射', 'missing');
      let id = person.open_id;
      if (!id) {
        const result = await post('人员查询', 'contact/v3/users/batch_get_id?user_id_type=open_id', { mobiles: [person.mobile] }, await accessToken());
        const rows = result.data?.user_list ?? [];
        if (rows.length !== 1 || !/^ou_\w+$/.test(rows[0].user_id ?? '')) throw new DeliveryError('人员查询', 'not-found');
        id = rows[0].user_id;
      }
      identities.set(key, id!); return id!;
    },
    async send(identity, text, id) {
      // Stable UUID on retries helps Feishu suppress duplicate sends within its deduplication window.
      // Local sent records also survive that window; neither is a distributed exactly-once guarantee.
      await post('发送', 'im/v1/messages?receive_id_type=open_id', {
        receive_id: identity, msg_type: 'text', content: JSON.stringify({ text }), uuid: id.slice(0, 32),
      }, await accessToken());
    },
  };
}
