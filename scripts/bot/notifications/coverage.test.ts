import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, stillValid, type Snapshot, type Cause } from './rules.ts';
import { config, state, fixture } from './testing.ts';
import { EVENTS, PR_STATE_EVENTS, STATUSES, type EventKey } from './config.ts';
import { formatMessage } from './message.ts';
import { deliverEvent } from './deliver.ts';

interface Scenario { key: EventKey; before: Snapshot; after: Snapshot; actor?: string; kind?: Cause['kind']; requests?: string[]; recipients: string[] }
const run = (fields: Partial<Snapshot> = {}) => state({ parent: 10, status: 'in-review', assignees: ['bob'], ...fields });
const worker = { number: 4, author: 'worker', open: true };
const pr = { key: 'ora-space/cloud#1', sha: 'old', state: 'open' as const, url: 'https://github.com/ora-space/cloud/pull/1' };
const review = state({ status: 'in-review', prs: [pr] });
const reviewedRun = run({ prs: [pr] });
const scenarios: Scenario[] = [
  { key:'owner_request_updated', before:state({status:'needs-owner'}), after:state({status:'needs-owner'}), requests:['status:needs-owner'], recipients:['owner'] },
  { key:'author_request_updated', before:state({status:'needs-author'}), after:state({status:'needs-author'}), requests:['status:needs-author'], recipients:['alice'] },
  { key:'review_requested_for_new_revision', before:review, after:{...review,prs:[{...pr,sha:'new'}]}, requests:['status:in-review'], recipients:['owner'] },
  { key:'review_requested_again_same_revision', before:review, after:review, requests:['status:in-review'], recipients:['owner'] },
  { key:'participant_assigned', before:state(), after:state({assignees:['bob']}), recipients:['bob'] },
  { key:'reviewer_assigned_during_review', before:run({assignees:[]}), after:run(), recipients:['bob'] },
  { key:'participant_left', before:state({assignees:['bob']}), after:state(), actor:'bob', recipients:['alice'] },
  { key:'reviewer_left_during_review', before:run(), after:run({assignees:[]}), actor:'bob', recipients:['alice'] },
  { key:'participant_removed', before:state({assignees:['bob']}), after:state(), recipients:['bob'] },
  { key:'reviewer_removed_during_review', before:run(), after:run({assignees:[]}), recipients:['bob'] },
  { key:'lgtm_added', before:reviewedRun, after:{...reviewedRun,lgtm:true}, actor:'bob', recipients:['alice'] },
  { key:'lgtm_withdrawn', before:{...reviewedRun,lgtm:true}, after:reviewedRun, actor:'bob', recipients:['alice'] },
  { key:'lgtm_invalidated_by_revision', before:{...reviewedRun,lgtm:true}, after:{...reviewedRun,prs:[{...pr,sha:'new'}]}, actor:'alice', requests:['status:in-review'], recipients:['bob'] },
  { key:'preflight_promoted', before:run({status:'none',preflight:true}), after:run({status:'none'}), kind:'closed', recipients:['alice'] },
  { key:'last_blocker_closed', before:state({blockers:[2],runs:[worker]}), after:state({runs:[worker]}), kind:'closed', recipients:['worker'] },
  { key:'last_blocker_removed', before:state({blockers:[2],runs:[worker]}), after:state({runs:[worker]}), recipients:['worker'] },
  { key:'execution_resumed_after_handoff', before:{...state({status:'needs-owner',runs:[worker]}),waitingForExecution:true} as Snapshot, after:state({runs:[worker]}), recipients:['worker'] },
  { key:'blocker_added', before:state({runs:[worker]}), after:state({blockers:[2],runs:[worker]}), recipients:['worker'] },
  { key:'blocker_reopened', before:state({runs:[worker]}), after:state({blockers:[2],runs:[worker]}), kind:'reopened', recipients:['worker'] },
  { key:'blocker_replaced', before:state({blockers:[2],runs:[worker]}), after:state({blockers:[3],runs:[worker]}), recipients:['worker'] },
  { key:'issue_reopened', before:state({open:false}), after:state(), kind:'reopened', recipients:['alice'] },
  { key:'run_reopened', before:run({open:false,status:'none'}), after:run({status:'none'}), kind:'reopened', recipients:['alice'] },
  { key:'parent_summary_invalidated_by_run_reopen', before:state({runs:[{...worker,open:false}]}), after:state({runs:[worker]}), kind:'reopened', recipients:['alice'] },
  { key:'run_reopened_with_closed_parent', before:run({open:false,parentOpen:false}), after:run({parentOpen:false}), kind:'reopened', recipients:['alice'] },
  { key:'last_run_closed', before:state({runs:[worker]}), after:state({runs:[{...worker,open:false}]}), kind:'closed', recipients:['alice'] },
  { key:'parent_closed_with_open_runs', before:run(), after:run({parentOpen:false}), kind:'closed', recipients:['alice'] },
];

test('every active event has a real scenario, exact recipient, independent switch and concrete message', () => {
  assert.deepEqual(scenarios.map(s=>s.key).sort(), EVENTS.filter(k=>!PR_STATE_EVENTS.includes(k)).sort());
  for (const s of scenarios) {
    const c = config(), cause: Cause = { id:'coverage',actor:s.actor??'carol',kind:s.kind??'command',requests:s.requests };
    const found = candidates(s.before,s.after,cause,c).filter(n=>n.key===s.key);
    assert.deepEqual(found.map(n=>n.recipient).sort(),s.recipients.sort(),s.key);
    const text = formatMessage(s.after,found);
    assert.match(text,/发生了什么[\s\S]+你需要做/,s.key);
    assert.doesNotMatch(text,/发起人：|查看事项和相关记录，确认下一步处理/,s.key);
    c.events[s.key] = false;
    assert.equal(candidates(s.before,s.after,cause,c).some(n=>n.key===s.key),false,s.key);
  }
});

test('all nine production status handoffs reach the real handler and obey their own disabled switch', async () => {
  for (const before of STATUSES) for (const after of ['needs-owner','in-review','needs-author'] as const) {
    if (before===after) continue;
    for (const enabled of [true,false]) {
      const f=fixture({labels:before==='none'?[]:[{name:`status:${before}`}]}),c=config();
      c.statusTransitions[`${before}->${after}`]=enabled;
      const actor=after==='needs-author'?'owner':'alice',sent:{to:string,text:string}[]=[];
      await deliverEvent({name:'issue_comment',payload:{action:'created',issue:f.issue,sender:{login:actor,type:'User'},
        comment:{id:20,body:`/label status:${after}`}}}, f.gh,'ora-space/circus',c,
        {hasRecipient:()=>true,identity:async u=>u,send:async(to,text)=>{sent.push({to,text});}},()=>{});
      assert.equal(sent.length,enabled?1:0,`${before}->${after}:${enabled}`);
      if(enabled) {assert.equal(sent[0].to,after==='needs-author'?'alice':'owner');assert.match(sent[0].text,/状态由「.+」变为「.+」/);}
    }
  }
});

test('reopened work with handoff or dependencies never invites immediate execution, including send-time recheck', () => {
  const cause:Cause={id:'reopen',actor:'owner',kind:'reopened'};
  for(const parent of [null,10]) for(const status of STATUSES) for(const blockers of [[],[2]]) {
    const before=state({open:false,parent,status,blockers}),after={...before,open:true};
    const found=candidates(before,after,cause,config()).filter(c=>['issue_reopened','run_reopened'].includes(c.key));
    assert.equal(found.length,status==='none'&&!blockers.length?1:0);
    if(found.length) {
      assert.equal(stillValid(found[0],{...after,status:'needs-owner'}),false);
      assert.equal(stillValid(found[0],{...after,blockers:[2]}),false);
    }
  }
});

test('initial decision/review requests obey initial switches and never leak through normal transition switches', async () => {
  for(const target of ['needs-owner','in-review'] as const) for(const enabled of [true,false]) {
    const f=fixture({body:`status:${target}`}),c=config(),sent:string[]=[];
    c.initialStatus[target]=enabled;
    c.statusTransitions[`none->${target}`]=!enabled;
    await deliverEvent({name:'issues',payload:{action:'opened',issue:f.issue,sender:{login:'alice',type:'User'}}},
      f.gh,'ora-space/circus',c,{hasRecipient:()=>true,identity:async u=>u,send:async(_to,text)=>{sent.push(text);}},()=>{});
    assert.equal(sent.length,enabled?1:0,`initial:${target}:${enabled}`);
    if(enabled) {assert.match(sent[0],/创建时将状态设为/);assert.doesNotMatch(sent[0],/状态由/);}
  }
});
