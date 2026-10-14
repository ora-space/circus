import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { UsageError, type Command } from '../lib/context.ts';
import { ghGitHub } from '../bot/github.ts';
import { snapshot, reconcile } from '../bot/notifications/observe.ts';
import { observedCause, linkedPulls, changeCause } from '../bot/notifications/github.ts';
import { runtime } from '../bot/notifications/runtime.ts';
import { fileStore, flush } from '../bot/notifications/store.ts';
import { parentOf } from '../lib/run.ts';
import { hash, type Cause, type Snapshot } from '../bot/notifications/rules.ts';

const usage = `notify --issue N [--issue N] --config-file F --credentials-file F --recipients-file F [--state-file F] [--watch] [--interval-ms N] [--with-prs]
    本地只读观察真实 issue 状态并发送飞书私聊。首次建立基线，不广播历史待办。
    使用已被 Git 忽略的本地凭据、映射、启用配置和持久状态；默认单次检查，--watch 每隔一段时间检查。
    不执行斜杠命令、不改 GitHub 状态。失败后再次运行只补发仍有效通知。`;
export const command: Command = {
  usage,
  async run(args, ctx) {
    const { values, positionals } = parseArgs({ args, options: {
      issue: { type: 'string', multiple: true }, 'config-file': { type: 'string' }, 'credentials-file': { type: 'string' },
      'recipients-file': { type: 'string' }, 'state-file': { type: 'string' }, watch: { type: 'boolean' },
      'interval-ms': { type: 'string' }, 'with-prs': { type: 'boolean' },
    } });
    if (positionals.length || !values.issue?.length || values.issue.some(n=>!/^\d+$/.test(n))) throw new UsageError(usage);
    const interval = Number(values['interval-ms'] ?? 10_000);
    if (!Number.isFinite(interval) || interval < 1000 || interval > 60_000) throw new UsageError('interval-ms: 1000–60000');
    const { config, sender } = runtime(ctx, { config: values['config-file'], credentials: values['credentials-file'], recipients: values['recipients-file'] });
    if (!config.enabled) { ctx.out('通知总开关关闭，未查询或发送'); return; }
    const store = fileStore(resolve(ctx.root, values['state-file'] ?? '.tmp/notification-state.json'));
    const gh = ghGitHub(ctx.gh, ctx.repo);
    const prs = values['with-prs'] ? (n: number)=>linkedPulls(ctx.gh,ctx.repo,n) : undefined;
    const read = (n: number) => snapshot(gh,ctx.repo,n,prs);
    try {
      do {
        const ns=new Set(values.issue.map(Number));
        for(const n of [...ns]) {
          const parent=parentOf(gh.getIssue(n).body);if(parent!==null)ns.add(parent);
          for(const child of gh.subIssues(n))ns.add(child.number);
          for(const dependent of gh.blocking(n))ns.add(dependent.number);
          for(const blocker of gh.blockedBy(n))ns.add(blocker.number);
        }
        const changes=new Map<string,{cause:Cause,snapshots:Snapshot[]}>();
        for (const n of ns) {
          const current = read(n);
          const prior = store.state.snapshots[n];
          if (!prior) {
            const initial = observedCause(ctx.gh,ctx.repo,gh.getIssue(n),undefined);
            if (initial) store.state.sources.push(initial.id);
            store.state.snapshots[n] = current; store.save(); ctx.out(`#${n} 已建立基线，历史待办不回补`); continue;
          }
          const cause = changeCause(ctx.gh,gh,ctx.repo,prior,current,store.state.snapshots);
          if (!cause) {
            const {waitingForExecution: _waiting,...previous}=prior;
            if(hash(previous)!==hash(current))ctx.out(`#${n} 无法确认变更操作者，保留基线待重试`);
            continue;
          }
          const group=changes.get(cause.id)??{cause,snapshots:[]};group.snapshots.push(current);changes.set(cause.id,group);
        }
        for(const group of changes.values())reconcile(store,group.snapshots,group.cause,config);
        const result = await flush(store,config,sender!,read,ctx.out);
        ctx.out(`通知检查：发送 ${result.sent}，未送达 ${result.failed}，已过时 ${result.obsolete}`);
        if (!values.watch) { if (result.failed) throw new Error('存在未送达通知，已保留待发记录'); break; }
        await sleep(interval);
      } while (true);
    } finally { store.close(); }
  },
};
