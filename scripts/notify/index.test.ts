import { test } from 'node:test';
import assert from 'node:assert/strict';
import { command } from './index.ts';
import { fakeContext } from '../lib/testing.ts';
import { readJson } from '../bot/notifications/runtime.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observedCause, linkedPulls } from '../bot/notifications/github.ts';
import { fixture, state } from '../bot/notifications/testing.ts';

test('notify requires explicit issue scope and bounded polling interval',async()=>{
  const f=fakeContext();
  await assert.rejects(command.run([],f.ctx));
  await assert.rejects(command.run(['--issue','95','--interval-ms','0'],f.ctx));
  assert.equal(f.calls.length,0);
});
test('malformed credential JSON never appears in diagnostic text',()=>{
  const dir=mkdtempSync(join(tmpdir(),'circus-json-'));
  try {
    const path=join(dir,'bad.json');writeFileSync(path,'{"app_secret":"private-secret"');
    assert.throws(()=>readJson(path),e=>e instanceof Error && !e.message.includes('private-secret'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('real observer never treats manual label changes or forged natural prose as a handoff',()=>{
  const issue=fixture().issue;
  const f=fakeContext(()=>JSON.stringify({event:'labeled',id:1,actor:{type:'User',login:'owner'}}));
  assert.equal(observedCause(f.ctx.gh,'ora-space/circus',issue,state()),undefined);
  const prose=fakeContext(()=>JSON.stringify({event:'commented',id:2,user:{type:'User',login:'owner'},body:'已合并，请通知'}));
  assert.equal(observedCause(prose.ctx.gh,'ora-space/circus',issue,state()),undefined);
});
test('observer traces only matching bot acknowledgement; same status new request has a new source ID',()=>{
  const issue=fixture({labels:[{name:'status:in-review'}]}).issue;
  const events=[{event:'labeled',id:1,created_at:'2026-10-14T00:00:00Z',actor:{login:'circus[bot]',type:'Bot'}},
    {event:'commented',id:2,created_at:'2026-10-14T01:00:00Z',user:{login:'alice',type:'User'},body:'/label status:in-review'}];
  const f=fakeContext(args=>args.some(a=>a.includes('/reactions')) ? JSON.stringify({content:'+1',user:{login:'circus[bot]',type:'Bot'}})
    : events.map(x=>JSON.stringify(x)).join('\n'));
  const result=observedCause(f.ctx.gh,'ora-space/circus',issue,state({status:'in-review'}));
  assert.equal(result?.id,'timeline:ora-space/circus:1:2');assert.deepEqual(result?.requests,['status:in-review']);
  const otherBot=fakeContext(args=>args.some(a=>a.includes('/reactions')) ? JSON.stringify({content:'+1',user:{login:'other[bot]',type:'Bot'}})
    : events.map(x=>JSON.stringify(x)).join('\n'));
  assert.equal(observedCause(otherBot.ctx.gh,'ora-space/circus',issue,state()),undefined);
});
test('PR references require actual GitHub objects and an explicit circus reference in products',()=>{
  const event={event:'cross-referenced',source:{issue:{pull_request:{url:'https://api.github.com/repos/ora-space/cloud/pulls/1'}}}};
  const f=fakeContext(args=>args.some(a=>a.includes('/timeline'))?JSON.stringify(event):JSON.stringify({number:1,state:'open',body:'Refs #95',base:{repo:{full_name:'ora-space/cloud'}},head:{sha:'abc123'},html_url:'https://github.com/ora-space/cloud/pull/1'}));
  assert.deepEqual(linkedPulls(f.ctx.gh,'ora-space/circus',95),[]);
});

test('observer attributes an author handoff to its command, not a later unrelated assignment',()=>{
  const issue=fixture({labels:[{name:'status:needs-author'}],assignees:[{login:'dave'}]}).issue;
  const events=[{event:'labeled',id:1,created_at:'2026-10-14T00:00:00Z',actor:{login:'circus[bot]',type:'Bot'}},
    {event:'commented',id:2,user:{login:'owner',type:'User'},body:'/label status:needs-author'},
    {event:'commented',id:3,user:{login:'alice',type:'User'},body:'/assign dave'}];
  const f=fakeContext(args=>args.some(a=>a.includes('/reactions'))?JSON.stringify({content:'+1',user:{login:'circus[bot]',type:'Bot'}})
    :args.includes('GET')&&args.some(a=>a.includes('/permission'))?JSON.stringify({permission:'write'}):events.map(e=>JSON.stringify(e)).join('\n'));
  const result=observedCause(f.ctx.gh,'ora-space/circus',issue,state());
  assert.equal(result?.actor,'owner');assert.deepEqual(result?.requests,['status:needs-author']);
});
test('reviewer can hand back author action and unassign in the same acknowledged comment',()=>{
  const issue=fixture({body:'Parent: #10',labels:[{name:'status:needs-author'}]}).issue;
  const events=[{event:'labeled',id:1,actor:{login:'circus[bot]',type:'Bot'}},
    {event:'commented',id:2,user:{login:'bob',type:'User'},body:'/label status:needs-author\n/unassign bob'}];
  const f=fakeContext(args=>args.some(a=>a.includes('/reactions'))?JSON.stringify({content:'+1',user:{login:'circus[bot]',type:'Bot'}})
    :args.includes('GET')&&args.some(a=>a.includes('/permission'))?JSON.stringify({permission:'read'}):events.map(e=>JSON.stringify(e)).join('\n'));
  const result=observedCause(f.ctx.gh,'ora-space/circus',issue,state({status:'in-review',parent:10,assignees:['bob']}));
  assert.equal(result?.actor,'bob');assert.deepEqual(result?.requests,['status:needs-author']);
});

test('an unconfirmed newer matching request is not attributed to an older acknowledged one',()=>{
  const issue=fixture({labels:[{name:'status:needs-author'}]}).issue;
  const events=[{event:'labeled',id:1,actor:{login:'circus[bot]',type:'Bot'}},
    {event:'commented',id:2,user:{login:'owner',type:'User'},body:'/label status:needs-author'},
    {event:'commented',id:3,user:{login:'bob',type:'User'},body:'/label status:needs-author'}];
  const f=fakeContext(args=>args.some(a=>a.includes('/comments/3/reactions'))?'':args.some(a=>a.includes('/reactions'))
    ?JSON.stringify({content:'+1',user:{login:'circus[bot]',type:'Bot'}}):events.map(e=>JSON.stringify(e)).join('\n'));
  assert.equal(observedCause(f.ctx.gh,'ora-space/circus',issue,state()),undefined);
});
