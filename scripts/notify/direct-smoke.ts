// Explicit pre-merge smoke: real Feishu/runtime, simulated GitHub only, no business writes.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { runtime } from '../bot/notifications/runtime.ts';
import { deliverEvent } from '../bot/notifications/deliver.ts';
import { fixture } from '../bot/notifications/testing.ts';
import { fakeContext } from '../lib/testing.ts';

async function main() {
  const { values } = parseArgs({ options: {
    recipient:{type:'string'},'credentials-file':{type:'string'},'recipients-file':{type:'string'},
  } });
  const recipient = values.recipient ?? process.env.NOTIFICATION_TEST_RECIPIENT;
  if (!recipient || !/^[\w-]+$/.test(recipient)) throw new Error('测试必须指定唯一 GitHub 收件人');
  const ctx = fakeContext(undefined,{root:process.cwd(),env:process.env}).ctx;
  const {config,sender}=runtime(ctx,{credentials:values['credentials-file'],recipients:values['recipients-file']});
  if(!config.enabled || !sender?.hasRecipient?.(recipient)) throw new Error('通知未启用或测试收件人未映射');
  // Send only to the explicitly named user, regardless of the production owner routing list.
  const cfg={...config,ownerRecipients:[]};
  if(!cfg.statusTransitions['in-review->needs-author']) throw new Error('测试状态转移开关未开启');
  let sent=0;const text:string[]=[];
  const actual={...sender,send:async(identity:string,message:string,id:string)=>{
    await sender.send(identity,message,id);sent++;text.push(message);
  }};
  const f=fixture({number:104,user:{login:recipient},labels:[{name:'status:in-review'}],
    title:'合并前功能验证（模拟交接）：飞书通知'});
  const actor=recipient.toLowerCase()==='owner'?'test-reviewer':'owner';
  if(actor==='test-reviewer')f.gh.permission=()=> 'write';
  await deliverEvent({name:'issue_comment',payload:{action:'created',issue:structuredClone(f.issue),
    sender:{login:actor,type:'User'},comment:{id:`direct-smoke:${randomUUID()}`,body:'/label status:needs-author'}}},
    f.gh,'ora-space/circus',cfg,actual,console.log);
  assert.equal(sent,1,'测试必须真实送达一条，否则失败');
  assert.match(text[0],/状态由「等待审查」变为「等待作者跟进」/);
  assert.doesNotMatch(text[0],/发起人：/);
  for(const mode of ['self','disabled'] as const) {
    const other=fixture({user:{login:recipient},labels:[{name:'status:in-review'}]});
    if(actor==='test-reviewer')other.gh.permission=()=> 'write';
    const off=structuredClone(cfg);if(mode==='disabled')off.statusTransitions['in-review->needs-author']=false;
    await deliverEvent({name:'issue_comment',payload:{action:'created',issue:other.issue,
      sender:{login:mode==='self'?recipient:actor,type:'User'},comment:{id:mode,body:'/label status:needs-author'}}},
      other.gh,'ora-space/circus',off,actual,console.log);
  }
  assert.equal(sent,1,'自通知和关闭开关必须静默');
  console.log('直接发送链路验证通过：真实发送 1 条；自通知/关闭开关静默；GitHub 状态为模拟，未修改真实 issue。');
}
if(import.meta.main) main().catch(()=>{
  console.error('直接通知测试失败；请检查配置、收件人范围及上述阶段日志（敏感信息已隐藏）。');process.exitCode=1;
});
