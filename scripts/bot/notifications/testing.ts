import { readFileSync } from 'node:fs';
import { parseConfig, type NotificationConfig } from './config.ts';
import type { Snapshot } from './rules.ts';
import type { GitHub, Issue } from '../github.ts';
import { parentOf } from '../../lib/run.ts';
export const config = (): NotificationConfig => ({ ...parseConfig(JSON.parse(readFileSync(new URL('./notifications.json',import.meta.url),'utf8'))),
  enabled: true, transport: 'feishu-app', ownerRecipients: ['owner'] });
export const state = (fields: Partial<Snapshot> = {}): Snapshot => ({ number: 1, title: '测试事项', url:'https://github.com/ora-space/circus/issues/1',
  author:'alice', open:true, status:'none', assignees:[], parent:null, parentOpen:true, blockers:[], runs:[], lgtm:false, prs:[], ...fields });
export function fixture(fields: Partial<Issue> = {}) {
  const issue: Issue={id:1001,node_id:'I_1',number:1,title:'本地通知验证',state:'open',body:'',created_at:'2026-10-14T00:00:00Z',updated_at:'2026-10-14T00:00:00Z',user:{login:'alice'},assignees:[],labels:[],...fields};
  const items=new Map([[issue.number,issue]]);const dependencies=new Map<number,number[]>();
  const gh: GitHub={
    getIssue:n=>structuredClone(items.get(n)!),setLabels:(n,ls)=>{items.get(n)!.labels=ls.map(name=>({name}));},
    addAssignees:(n,us)=>{const i=items.get(n)!;i.assignees=[...new Set([...i.assignees.map(a=>a.login),...us.filter(u=>u!=='rejected')])].map(login=>({login}));return i.assignees.map(a=>a.login);},
    removeAssignees:(n,us)=>{items.get(n)!.assignees=items.get(n)!.assignees.filter(a=>!us.includes(a.login));},
    comment(){},react(){},reopen:n=>{items.get(n)!.state='open';},addSubIssue(){},
    subIssues:n=>[...items.values()].filter(i=>parentOf(i.body)===n).map(i=>structuredClone(i)),
    blockedBy:n=>(dependencies.get(n)??[]).map(k=>structuredClone(items.get(k)!)),
    blocking:n=>[...items.values()].filter(i=>dependencies.get(i.number)?.includes(n)).map(i=>structuredClone(i)),
    addBlockedBy:(n,id)=>{const i=[...items.values()].find(i=>i.id===id)!;dependencies.set(n,[...(dependencies.get(n)??[]),i.number]);},
    removeBlockedBy:(n,id)=>{const k=[...items.values()].find(i=>i.id===id)!.number;dependencies.set(n,(dependencies.get(n)??[]).filter(x=>x!==k));},
    listOpenIssues:()=>[...items.values()].filter(i=>i.state==='open').map(i=>structuredClone(i)),permission:u=>u==='owner'?'write':'read',
  };
  return {issue,gh,items,dependencies};
}
