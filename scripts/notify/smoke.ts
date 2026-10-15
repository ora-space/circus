// Explicit local smoke test: simulated GitHub state through the REAL handler, queue and Feishu sender.
// No real GitHub writes, no test actor privileges outside the in-memory GitHub port.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { parseConfig } from '../bot/notifications/config.ts';
import { readJson } from '../bot/notifications/runtime.ts';
import { parseRecipients, feishuApp } from '../bot/notifications/feishu.ts';
import { fileStore, flush, emptyState, type StateStore } from '../bot/notifications/store.ts';
import { observeHandle, snapshot } from '../bot/notifications/observe.ts';
import { fixture } from '../bot/notifications/testing.ts';

async function main() {
  const { values } = parseArgs({ options: {
    'config-file': { type:'string' }, 'credentials-file': { type:'string' }, 'recipients-file': { type:'string' },
    'state-file': { type:'string' }, recipient: { type:'string' }, issue: { type:'string' },
  } });
  if (!values.recipient || !values['credentials-file'] || !values['recipients-file'] || !values['config-file']) {
    throw new Error('须明确提供 --recipient、--config-file、--credentials-file、--recipients-file');
  }
  const config = parseConfig(readJson(values['config-file']));
  if (!config.enabled || config.transport !== 'feishu-app') throw new Error('本地测试须显式启用 feishu-app');
  const credentials = readJson(values['credentials-file']) as { app_id:string; app_secret:string };
  const recipients = parseRecipients(readJson(values['recipients-file']));
  if (Object.keys(recipients).length !== 1 || !recipients[values.recipient.toLowerCase()]) throw new Error('smoke 只允许映射唯一明确收件人');
  const number = Number(values.issue ?? 104);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('issue 必须是正整数');
  const f = fixture({ number, user:{login:values.recipient}, title:'本地链路验证（模拟交接）：状态变更 → 飞书私聊' });
  const event = { name:'issue_comment', payload:{action:'created', issue:structuredClone(f.issue),
    sender:{login:'owner',type:'User'}, comment:{id:'local-smoke-handoff-v1',body:'/label status:needs-author',created_at:'2026-10-14T00:00:00Z'} } };
  const store = fileStore(resolve(values['state-file'] ?? '.tmp/notification-smoke-state.json'));
  try {
    observeHandle(event,f.gh,'ora-space/circus',store,config);
    assert.equal(f.issue.labels[0].name,'status:needs-author');
    const sender=feishuApp(credentials,recipients);
    const read=()=>snapshot(f.gh,'ora-space/circus',number);
    const first=await flush(store,config,sender,read,console.log);
    if (first.failed) throw new Error('真实私聊未送达，记录已保留；重试此命令不会重放真实 GitHub 操作');
    observeHandle(event,f.gh,'ora-space/circus',store,config);
    const repeat=await flush(store,config,sender,read,console.log);
    assert.equal(repeat.sent,0,'同一来源事件重放应静默');
    for (const mode of ['self','disabled']) {
      const other=fixture({number,user:{login:values.recipient}});
      const local:StateStore={state:emptyState(),save(){},close(){}};
      const cfg=structuredClone(config);
      if(mode==='disabled')cfg.statusTransitions['none->needs-author']=false;
      observeHandle({...event,payload:{...event.payload,issue:structuredClone(other.issue),
        sender:{login:mode==='self'?values.recipient:'owner',type:'User'}}},other.gh,'ora-space/circus',local,cfg);
      assert.equal(local.state.records.length,0,`${mode} 应静默`);
    }
    console.log(`本地链路通过：本次真实发送 ${first.sent} 条；重放、自通知与关闭开关均静默。GitHub 状态为模拟，未修改真实 issue。`);
  } finally { store.close(); }
}
if(import.meta.main)main().catch(()=>{console.error('本地通知验证失败（凭据及人员信息已隐藏）；请检查状态文件和上述阶段结果。');process.exitCode=1;});
