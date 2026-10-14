import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, STATUSES, EVENTS, PR_STATE_EVENTS, type NotificationConfig } from './config.ts';
import { candidates, stillValid, type Snapshot, type Cause } from './rules.ts';
import { emptyState, enqueue, flush, fileStore, type StateStore } from './store.ts';
import { feishuApp, parseRecipients } from './feishu.ts';
import { observeHandle, snapshot } from './observe.ts';

import { config, state, fixture } from './testing.ts';
const cause = (fields: Partial<Cause> = {}): Cause => ({ id:'comment:1', actor:'bob', kind:'command', ...fields });
const memory = (): StateStore => ({ state:emptyState(),save(){},close(){} });

test('strict config: independent switches, omitted off, forbidden diagonals, unknown fields/types',()=>{
  const c=config(); assert.equal(Object.keys(c.events).length,EVENTS.length);
  assert.equal(parseConfig({...c,events:{}}).events.pr_merged,undefined);
  assert.throws(()=>parseConfig({...c,events:{broadcaster:true}}));
  assert.throws(()=>parseConfig({...c,enabled:'yes'}));
  assert.throws(()=>parseConfig({...c,statusTransitions:{'in-review->in-review':true}}));
  assert.throws(()=>parseConfig({...c,statusTransitions:{'in-review->none':true}}));
});
test('all 16 transitions obey independent flags and exact routing',()=>{
  for (const a of STATUSES) for (const b of STATUSES) {
    const c=config(); const actual=candidates(state({status:a}),state({status:b}),cause(),c);
    assert.equal(actual.length,a===b || b==='none' ? 0 : 1,`${a}->${b}`);
    if (actual.length) assert.equal(actual[0].recipient,b==='needs-author'?'alice':'owner');
    c.statusTransitions[`${a}->${b}`]=false;
    if (a!==b) assert.equal(candidates(state({status:a}),state({status:b}),cause({requests:[`status:${b}`]}),c).length,0);
  }
});
test('creation uses only initial switches; author and actor never notified',()=>{
  const c=config();
  const s=state({status:'needs-owner'});
  c.statusTransitions['none->needs-owner']=false;
  assert.equal(candidates(undefined,s,cause({kind:'opened',issue:1}),c).length,1);
  c.initialStatus['needs-owner']=false;
  assert.equal(candidates(undefined,s,cause({kind:'opened'}),c).length,0);
  assert.equal(candidates(state(),state({status:'needs-author'}),cause({actor:'ALICE'}),config()).length,0);
});
test('review pre-registration silent; assigned during R only new reviewer; no self-review',()=>{
  const run=state({parent:10});
  assert.equal(candidates(run,{...run,assignees:['carol']},cause(),config()).length,0);
  const next={...run,status:'in-review' as const,assignees:['carol','alice']};
  assert.deepEqual(candidates(run,next,cause(),config()).map(x=>x.recipient),['owner','carol']);
  const added=candidates({...next,assignees:['carol']},{...next,assignees:['carol','dave']},cause(),config());
  assert.deepEqual(added.map(x=>x.recipient),['dave']);
  assert.equal(stillValid(added[0],{...next,assignees:[]}),false);
});
test('same status explicit requests differ from replay and denied/no request',()=>{
  const s=state({status:'in-review'});
  assert.equal(candidates(s,s,cause(),config()).length,0);
  assert.equal(candidates(s,s,cause({requests:['status:in-review']}),config())[0].key,'review_requested_again_same_revision');
  const pr={key:'ora-space/cloud#1',sha:'a1234567',state:'open' as const,url:'https://github.com/ora-space/cloud/pull/1'};
  assert.equal(candidates({...s,prs:[pr]},{...s,prs:[{...pr,sha:'b1234567'}]},cause({requests:['status:in-review']}),config())[0].key,'review_requested_for_new_revision');
});
test('assignment exits and removals are actionable and actor excluded',()=>{
  const s=state({assignees:['bob']});
  const left=candidates(s,state(),cause(),config());
  assert.equal(left[0].key,'participant_left');assert.equal(left[0].recipient,'alice');
  const removed=candidates(s,state(),cause({actor:'owner'}),config());
  assert.equal(removed[0].recipient,'bob');
  assert.equal(candidates({...s,status:'needs-owner'},state({status:'needs-owner'}),cause(),config()).length,0);
});
test('last dependency causes exclusive reasons; middle completion silent, handoff deferred',()=>{
  const s=state({blockers:[2,3],runs:[{number:4,author:'worker',open:true}]});
  assert.equal(candidates(s,{...s,blockers:[3]},cause({kind:'closed'}),config()).length,0);
  const next={...s,blockers:[]};
  assert.equal(candidates(s,next,cause({kind:'closed'}),config())[0].key,'last_blocker_closed');
  assert.equal(candidates(s,next,cause(),config())[0].key,'last_blocker_removed');
  assert.equal(candidates({...s,status:'needs-owner'},{...next,status:'needs-owner'},cause(),config()).length,0);
  const store=memory();
  enqueue(store,[{...s,status:'needs-owner'}],[{...next,status:'needs-owner'}],cause(),config());
  enqueue(store,[{...next,status:'needs-owner'}],[next],cause({id:'next'}),config());
  assert.equal(store.state.records[0].candidates[0].key,'execution_resumed_after_handoff');
});
test('blocker reopen prompts active workers; last run close prompts parent, close parent prompts run author',()=>{
  const s=state({runs:[{number:4,author:'worker',open:true}]});
  assert.equal(candidates(s,{...s,blockers:[2]},cause({kind:'reopened'}),config())[0].key,'blocker_reopened');
  assert.equal(candidates(s,{...s,runs:[{...s.runs[0],open:false}]},cause({kind:'closed'}),config())[0].key,'last_run_closed');
  const run=state({parent:10,author:'worker',status:'in-review'});
  assert.deepEqual(candidates(run,{...run,parentOpen:false},cause({kind:'closed'}),config()).map(c=>c.key),['parent_closed_with_open_runs']);
});
test('lgtm cleanup on a new request is not withdrawal; PR state itself never sends',()=>{
  const s=state({status:'in-review',lgtm:true});
  const next={...s,lgtm:false};
  assert.equal(candidates(s,next,cause(),config())[0].key,'lgtm_withdrawn');
  assert.deepEqual(candidates(s,next,cause({requests:['status:in-review']}),config()).map(c=>c.key),['review_requested_again_same_revision']);
  const a={key:'ora-space/cloud#1',sha:'abc123',state:'open' as const,url:'https://github.com/ora-space/cloud/pull/1'};
  const b={...a,key:'ora-space/cloud#2'};
  const merged=candidates({...s,prs:[a,b]},{...s,prs:[{...a,state:'merged'},b]},cause({kind:'pr'}),config());
  assert.equal(merged.length,0);
});
test('persisted queue: failures retry without business, replay dedup, stale requests expire',async()=>{
  const store=memory(); const before=state(); let after=state({status:'needs-author'});
  const c=config();enqueue(store,[before],[after],cause(),c);enqueue(store,[before],[after],cause(),c);
  assert.equal(store.state.records.length,1);
  let attempts=0;
  const sender={identity:async(u:string)=>u,send:async()=>{attempts++;throw new Error('temporary');}};
  assert.equal((await flush(store,c,sender,()=>after,()=>{})).failed,1);
  assert.equal(store.state.records[0].state,'pending');
  await flush(store,c,{...sender,send:async()=>{attempts++;}},()=>after,()=>{});
  assert.equal(store.state.records[0].state,'sent');assert.equal(attempts,2);
  await flush(store,c,sender,()=>after,()=>{});assert.equal(attempts,2);
  enqueue(store,[before],[after],cause({id:'next'}),c);after=before;
  assert.equal((await flush(store,c,sender,()=>after,()=>{})).obsolete,1);assert.equal(attempts,2);
});
test('config changed to off drops pending; identity duplicates and actor aliases do not receive twice',async()=>{
  const c=config();const store=memory();const after=state({parent:10,status:'in-review',assignees:['carol']});
  enqueue(store,[state({parent:10})],[after],cause(),c);
  let sends=0;
  const sender={identity:async(u:string)=>u==='bob'?'actor':u==='owner'||u==='carol'?'same':u,send:async()=>{sends++;}};
  await flush(store,c,sender,()=>after,()=>{});assert.equal(sends,1);
  const other=memory();enqueue(other,[state()],[state({status:'needs-author'})],cause(),c);
  await flush(other,c,{identity:async()=> 'same',send:async()=>{sends++;}},()=>state({status:'needs-author'}),()=>{});
  assert.equal(sends,1);
  const off=memory();enqueue(off,[state()],[state({status:'needs-author'})],cause(),c);
  c.statusTransitions['none->needs-author']=false;
  await flush(off,c,sender,()=>state({status:'needs-author'}),()=>{});assert.equal(sends,1);
});
test('local store survives restart and prevents simultaneous owners',()=>{
  const dir=mkdtempSync(join(tmpdir(),'circus-notify-')); const path=join(dir,'state.json');
  try {const a=fileStore(path);enqueue(a,[state()],[state({status:'needs-author'})],cause(),config());
    assert.throws(()=>fileStore(path),/占用/);a.close();const b=fileStore(path);assert.equal(b.state.records.length,1);b.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('Feishu resolves mobile once, reuses token, sends stable UUID and does not leak response secrets',async()=>{
  const requests:{url:string,body:any}[]=[];
  const reply=(x:unknown)=>new Response(JSON.stringify(x),{status:200});
  const fetcher=(async(url:any,init:any)=>{requests.push({url:String(url),body:JSON.parse(init.body)});
    if(String(url).includes('/auth/'))return reply({code:0,tenant_access_token:'token-secret',expire:7200});
    if(String(url).includes('batch_get'))return reply({code:0,data:{user_list:[{user_id:'ou_person'}]}});
    return reply({code:0,data:{message_id:'om_test'}});
  }) as typeof fetch;
  const sender=feishuApp({app_id:'cli_test',app_secret:'top-secret'},parseRecipients({Alice:{mobile:'+8613800000000'}}),fetcher);
  const id=await sender.identity('ALICE');assert.equal(id,'ou_person');await sender.identity('alice');
  await sender.send(id,'test','1234567890');assert.equal(requests.length,3);
  assert.deepEqual(requests[1].body,{mobiles:['+8613800000000']});assert.equal(requests[2].body.uuid,'1234567890');
  const bad=feishuApp({app_id:'id',app_secret:'top-secret'}, {}, (async()=>reply({code:99991672,msg:'top-secret token-secret'})) as typeof fetch);
  await assert.rejects(bad.send('ou_test','t','1'),e=>e instanceof Error && !e.message.includes('secret') && e.message.includes('99991672'));
});

// Minimal mutable GitHub port: exercises the real handler instead of bypassing permissions / commands.
const event=(f:ReturnType<typeof fixture>,body:string,actor='owner',id=42)=>({name:'issue_comment',payload:{action:'created',issue:structuredClone(f.issue),sender:{login:actor,type:'User'},comment:{id,body,created_at:'2026-10-14T00:00:00Z'}}});
test('real handler observation: final labels only; denied command and assign+unassign silent; board failure preserves notification',()=>{
  const f=fixture();const store=memory();const c=config();
  observeHandle(event(f,'/label status:needs-owner\n/label status:in-review\n/label status:needs-author'),f.gh,'ora-space/circus',store,c);
  assert.deepEqual(store.state.records[0].candidates.map(x=>x.key),['statusTransitions.none->needs-author']);
  const denied=fixture();const silent=memory();observeHandle(event(denied,'/label status:needs-author','outsider'),denied.gh,'ora-space/circus',silent,c);
  assert.equal(silent.state.records.length,0);
  observeHandle(event(denied,'/assign bob\n/unassign bob','alice',43),denied.gh,'ora-space/circus',silent,c);assert.equal(silent.state.records.length,0);
  const failure=fixture();const kept=memory();
  assert.throws(()=>observeHandle(event(failure,'/label status:needs-author'),failure.gh,'ora-space/circus',kept,c,{sync(){throw new Error('board offline');}}));
  assert.equal(kept.state.records.length,1);
});
test('creation and illegal close never send false handoffs; direct run dependencies covered',()=>{
  const f=fixture({body:'status:needs-owner'});const s=memory();
  observeHandle({name:'issues',payload:{action:'opened',issue:structuredClone(f.issue),sender:{login:'alice',type:'User'}}},f.gh,'ora-space/circus',s,config());
  assert.equal(s.state.records[0].candidates[0].key,'initialStatus.needs-owner');
  f.issue.state='closed';f.issue.body='no summary';const bad=memory();
  observeHandle({name:'issues',payload:{action:'closed',issue:structuredClone(f.issue),sender:{login:'alice',type:'User'}}},f.gh,'ora-space/circus',bad,config());
  assert.equal(bad.state.records.length,0);assert.equal(f.issue.state,'open');
  const run=fixture({body:'## 总结\n已结束\n\n---\n\nParent: #2',state:'closed'});
  run.items.set(2,{...run.issue,number:2,id:1002,body:'',state:'open'});
  run.items.set(3,{...run.issue,number:3,id:1003,body:'',state:'open',user:{login:'worker'}});
  run.dependencies.set(3,[1]);const out=memory();
  observeHandle({name:'issues',payload:{action:'closed',issue:structuredClone(run.issue),sender:{login:'alice',type:'User'}}},run.gh,'ora-space/circus',out,config());
  assert.ok(out.state.records.some(r=>r.candidates.some(c=>c.key==='last_blocker_closed' && c.issue===3)));
});

test('partial mutation failure keeps already successful assignment for notification',()=>{
  const f=fixture(); const store=memory();
  const assign=f.gh.addAssignees;
  f.gh.addAssignees=(n,users)=>{if(users.includes('explode'))throw new Error('network');return assign(n,users);};
  assert.throws(()=>observeHandle(event(f,'/assign bob\n/assign explode','alice'),f.gh,'ora-space/circus',store,config()));
  assert.equal(store.state.records.length,1);
  assert.equal(store.state.records[0].candidates[0].recipient,'bob');
});

test('stored review version distinguishes a new head discovered before a same-status command',()=>{
  const c=config();const store=memory();
  const pr={key:'ora-space/cloud#1',sha:'abc123',state:'open' as const,url:'https://github.com/ora-space/cloud/pull/1'};
  const old=state({status:'in-review',prs:[pr]});store.state.snapshots[1]=old;
  const current=state({status:'in-review',prs:[{...pr,sha:'def123'}]});
  enqueue(store,[current],[current],cause({requests:['status:in-review']}),c);
  assert.equal(store.state.records[0].candidates[0].key,'review_requested_for_new_revision');
});

test('supported concrete events can be independently disabled; retired PR state fields reject true',()=>{
  const c=config();
  for(const key of EVENTS) {
    const changed=structuredClone(c);changed.events[key]=false;
    const parsed=parseConfig(changed);
    assert.equal(parsed.events[key],false);
    for(const other of EVENTS.filter(k=>k!==key))assert.equal(parsed.events[other],c.events[other]);
  }
  for(const key of PR_STATE_EVENTS)assert.throws(()=>parseConfig({...c,events:{...c.events,[key]:true}}));
});

test('new author request supersedes old pending request, including failed send and disabled new notification',async()=>{
  for(const disable of [false,true]) {
    const f=fixture(); const s=memory();const c=config();let sent=0;
    observeHandle(event(f,'/label status:needs-author','owner',100),f.gh,'ora-space/circus',s,c);
    await flush(s,c,{identity:async(u)=>u,send:async()=>{throw new Error('offline');}},()=>snapshot(f.gh,'ora-space/circus',1),()=>{});
    if(disable)c.events.author_request_updated=false;
    observeHandle(event(f,'/label status:needs-author','owner',101),f.gh,'ora-space/circus',s,c);
    const result=await flush(s,c,{identity:async(u)=>u,send:async()=>{sent++;}},()=>snapshot(f.gh,'ora-space/circus',1),()=>{});
    assert.equal(sent,disable?0:1);assert.equal(result.obsolete,1);
    assert.equal(s.state.records[0].state,'obsolete');
    observeHandle(event(f,'/label status:needs-author','owner',101),f.gh,'ora-space/circus',s,c);
    assert.equal((await flush(s,c,{identity:async(u)=>u,send:async()=>{sent++;}},()=>snapshot(f.gh,'ora-space/circus',1),()=>{})).sent,0);
  }
});
test('A -> none -> A never resurrects the first request; unrelated PR revision does not discard author action',async()=>{
  const s=memory(),c=config();const a=state({status:'needs-author'});let sent=0;
  enqueue(s,[state()],[a],cause({id:'old'}),c);
  enqueue(s,[a],[state()],cause({id:'finished'}),c);
  enqueue(s,[state()],[a],cause({id:'new'}),c);
  const current={...a,prs:[{key:'ora-space/cloud#1',sha:'new123',state:'open' as const,url:'https://github.com/ora-space/cloud/pull/1'}]};
  const result=await flush(s,c,{identity:async(u)=>u,send:async()=>{sent++;}},()=>current,()=>{});
  assert.equal(sent,1);assert.equal(result.obsolete,1);
});
test('actor alias resolution errors retain pending instead of bypassing self-notification filter',async()=>{
  const s=memory(),c=config(),a=state({status:'needs-author'});enqueue(s,[state()],[a],cause(),c);
  let sends=0;
  const result=await flush(s,c,{hasRecipient:()=>true,identity:async(u)=>{if(u==='bob')throw new Error('lookup unavailable');return 'same-person';},send:async()=>{sends++;}},()=>a,()=>{});
  assert.equal(result.failed,1);assert.equal(sends,0);assert.equal(s.state.records[0].state,'pending');
  await flush(s,c,{hasRecipient:()=>true,identity:async()=> 'same-person',send:async()=>{sends++;}},()=>a,()=>{});
  assert.equal(sends,0);assert.equal(s.state.records[0].state,'obsolete');
});
test('author handoff survives unavailable PR metadata; existing review retry waits for verified version',async()=>{
  const f=fixture({labels:[{name:'status:in-review'}]});const s=memory(),c=config();
  observeHandle(event(f,'/label status:needs-author'),f.gh,'ora-space/circus',s,c,undefined,()=>{throw new Error('no access');});
  assert.equal(s.state.records.length,1);
  const review=memory(),r=state({status:'in-review'});enqueue(review,[state()],[r],cause(),c);
  const result=await flush(review,c,{identity:async(u)=>u,send:async()=>{throw new Error('must not send');}},()=>({...r,prsKnown:false}),()=>{});
  assert.equal(result.failed,1);assert.equal(review.state.records[0].state,'pending');
});
test('version-1 state migration keeps sent history and only retries latest pending author request',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'circus-migration-')),path=join(dir,'state.json');
  try {
    const s=memory(),c=config(),a=state({status:'needs-author'});
    enqueue(s,[state()],[a],cause({id:'old'}),c);enqueue(s,[a],[a],cause({id:'new',requests:['status:needs-author']}),c);
    const raw:any=structuredClone(s.state);raw.version=1;delete raw.snapshots[1].handoffId;
    for(const record of raw.records)for(const candidate of record.candidates){delete candidate.guard.handoffId;candidate.guard.value+=':legacyhash';}
    writeFileSync(path,JSON.stringify(raw));const reopened=fileStore(path);
    try {let sends=0;const result=await flush(reopened,c,{identity:async(u)=>u,send:async()=>{sends++;}},()=>a,()=>{});
      assert.equal(reopened.state.version,2);assert.equal(sends,1);assert.equal(result.obsolete,1);
    } finally {reopened.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('a changed owner routing list and disabled switch are rechecked before send even when PR lookup is unavailable',async()=>{
  const c=config(),s=memory(),o=state({status:'needs-owner'});
  enqueue(s,[state()],[o],cause(),c);c.ownerRecipients=[];
  const result=await flush(s,c,{identity:async(u)=>u,send:async()=>{throw new Error('must not send');}},()=>o,()=>{});
  assert.equal(result.obsolete,1);assert.equal(result.failed,0);
  const r=memory(),cfg=config(),review=state({status:'in-review'});enqueue(r,[state()],[review],cause(),cfg);
  cfg.statusTransitions['none->in-review']=false;
  const off=await flush(r,cfg,{identity:async(u)=>u,send:async()=>{throw new Error('must not send');}},()=>({...review,prsKnown:false}),()=>{});
  assert.equal(off.obsolete,1);assert.equal(off.failed,0);
});
test('review classification retains last requested head across ordinary polling snapshots',()=>{
  const c=config(),s=memory();
  const pr={key:'ora-space/cloud#1',sha:'old123',state:'open' as const,url:'https://github.com/ora-space/cloud/pull/1'};
  const old=state({status:'in-review',prs:[pr]});enqueue(s,[state()],[old],cause({id:'initial'}),c);
  const current={...old,prs:[{...pr,sha:'new123'}]};enqueue(s,[old],[current],cause({id:'poll'}),c);
  enqueue(s,[current],[current],cause({id:'request',requests:['status:in-review']}),c);
  assert.equal(s.state.records.at(-1)!.candidates[0].key,'review_requested_for_new_revision');
});

test('all required author handoffs use actual handler and their own switch, including an explicit same-state request',async()=>{
  for(const previous of ['none','needs-owner','in-review','needs-author'] as const)for(const enabled of [false,true]) {
    const c=config(),s=memory(),f=fixture({labels:previous==='none'?[]:[{name:`status:${previous}`}]});
    const key=previous==='needs-author'?'author_request_updated':`${previous}->needs-author`;
    if(previous==='needs-author')c.events.author_request_updated=enabled;else c.statusTransitions[key]=enabled;
    observeHandle(event(f,'/label status:needs-author','owner'),f.gh,'ora-space/circus',s,c);
    let sends=0;const result=await flush(s,c,{identity:async(u)=>u,send:async()=>{sends++;}},()=>snapshot(f.gh,'ora-space/circus',1),()=>{});
    assert.equal(sends,enabled?1:0,`${key}:${enabled}`);assert.equal(result.failed,0);
  }
});
