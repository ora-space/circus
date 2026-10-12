import { parseArgs } from 'node:util';
import { issueNumber, type Command } from '../lib/context.ts';
import { api, apiList } from '../lib/gh.ts';
import { whoami } from '../lib/identity.ts';
import { parentOf } from '../lib/run.ts';
import { parseSlash } from '../lib/slash.ts';

const usage = `updates N [--all]
    #N 上自你上次发言之后的动静：别人的评论全文、斜杠命令（谁改了状态）、status 变化、引用它的 PR、
    关闭和重新打开、有更新的运行 issue；开头列出 status 的完整轨迹。没发过言就从头列。--all 列出全部。
    用户说"#N 有更新"时先跑这个。`;

export interface TimelineEvent {
  event: string;
  created_at?: string;
  actor?: { login: string; type: string } | null;
  user?: { login: string; type: string } | null;
  body?: string | null;
  label?: { name: string };
  state_reason?: string | null;
  source?: {
    issue?: { number: number; title: string; state: string; pull_request?: { merged_at: string | null }; repository?: { full_name: string } };
  };
}

export interface IssueInfo {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  labels: { name: string }[];
}

export interface RunInfo {
  number: number;
  title: string;
  state: string;
  updated_at: string;
  body: string | null;
}

const time = (iso?: string) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');
const isSlashOnly = (body: string) => {
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  return lines.length > 0 && parseSlash(body).length === lines.length;
};

export function buildUpdates(issue: IssueInfo, timeline: TimelineEvent[], runs: RunInfo[], me: string, all: boolean, repo: string): string[] {
  const status = issue.labels.map((l) => l.name).filter((l) => l.startsWith('status:'));
  const out = [
    `#${issue.number} ${issue.title} [${issue.state}] 作者 @${issue.user.login} · 当前 status：${status.join(' ') || '无'}`,
  ];

  const changes = timeline.filter((e) => (e.event === 'labeled' || e.event === 'unlabeled') && e.label?.name.startsWith('status:'));
  if (changes.length) {
    out.push('', 'status 轨迹：');
    for (const e of changes) out.push(`  ${time(e.created_at)} ${e.event === 'labeled' ? '+' : '-'} ${e.label!.name}`);
  }

  const mine = timeline.filter((e) => e.event === 'commented' && e.user?.login === me);
  const since = all ? undefined : mine.at(-1)?.created_at;
  const after = (iso?: string) => !since || (iso ?? '') > since;
  out.push('', all ? '全部动静：' : since ? `自你上次发言（${time(since)}）之后：` : '你还没在这里发过言，从头列出：');

  const lines: string[] = [];
  for (const e of timeline) {
    if (!after(e.created_at)) continue;
    const at = time(e.created_at);
    if (e.event === 'commented') {
      const who = `@${e.user?.login}`;
      const body = (e.body ?? '').trim();
      if (isSlashOnly(body)) lines.push(`- ${at} ${who}：${body.split(/\r?\n/).filter((l) => l.trim()).join('；')}`);
      else lines.push(`--- ${at} ${who}${e.user?.type === 'Bot' ? '（bot）' : ''}`, '', body, '');
    } else if ((e.event === 'labeled' || e.event === 'unlabeled') && e.label?.name.startsWith('status:')) {
      lines.push(`- ${at} status ${e.event === 'labeled' ? '+' : '-'} ${e.label.name}`);
    } else if (e.event === 'cross-referenced' && e.source?.issue?.pull_request) {
      const s = e.source.issue;
      const ref = s.repository?.full_name === repo ? `#${s.number}` : `${s.repository?.full_name}#${s.number}`;
      const state = s.pull_request!.merged_at ? '已合并' : s.state === 'open' ? '开着' : '已关闭';
      lines.push(`- ${at} PR ${ref} 引用了本 issue（${state}）：${s.title}`);
    } else if (e.event === 'closed' || e.event === 'reopened') {
      lines.push(`- ${at} @${e.actor?.login} ${e.event === 'closed' ? `关闭（${e.state_reason ?? 'completed'}）` : '重新打开'}`);
    }
  }
  const touched = runs.filter((r) => parentOf(r.body) === issue.number && after(r.updated_at));
  for (const r of touched) lines.push(`- 运行 #${r.number}（${r.state === 'open' ? '进行中' : '已结束'}）有更新：${r.title}；用 show ${r.number} 查看`);
  out.push(...(lines.length ? lines : ['（没有新动静）']));
  return out;
}

export const command: Command = {
  usage,
  run(args, ctx) {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { all: { type: 'boolean', default: false } } });
    const n = issueNumber(positionals[0], usage);
    const base = `repos/${ctx.repo}/issues/${n}`;
    const issue = api<IssueInfo>(ctx.gh, 'GET', base);
    const timeline = apiList<TimelineEvent>(ctx.gh, `${base}/timeline?per_page=100`);
    const runs = apiList<RunInfo>(ctx.gh, `${base}/sub_issues?per_page=100`);
    for (const line of buildUpdates(issue, timeline, runs, whoami(ctx).login, values.all, ctx.repo)) ctx.out(line);
  },
};
