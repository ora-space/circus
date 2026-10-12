import { issueNumber, type Command } from '../lib/context.ts';
import { api, apiList } from '../lib/gh.ts';

const usage = `show N
    完整输出 issue #N：标题、作者、assignee、label、正文和全部评论（按时间顺序）。关闭 issue 前先读这个。`;

export interface Issue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  user: { login: string };
  assignees: { login: string }[];
  labels: { name: string }[];
}

export interface Comment {
  user: { login: string };
  created_at: string;
  body: string | null;
}

export function format(issue: Issue, comments: Comment[]): string {
  const at = (users: { login: string }[]) => users.map((u) => `@${u.login}`).join(' ') || '-';
  const parts = [
    `#${issue.number} ${issue.title} [${issue.state}]`,
    issue.html_url,
    `作者 @${issue.user.login} · assignee ${at(issue.assignees)} · label ${issue.labels.map((l) => l.name).join(' ') || '-'}`,
    '',
    (issue.body ?? '').trim() || '（无正文）',
  ];
  comments.forEach((c, i) => {
    parts.push('', `--- 评论 ${i + 1}/${comments.length} @${c.user.login} ${c.created_at}`, '', (c.body ?? '').trim());
  });
  return parts.join('\n');
}

export const command: Command = {
  usage,
  run(args, ctx) {
    const n = issueNumber(args[0], usage);
    const issue = api<Issue>(ctx.gh, 'GET', `repos/${ctx.repo}/issues/${n}`);
    const comments = apiList<Comment>(ctx.gh, `repos/${ctx.repo}/issues/${n}/comments?per_page=100`);
    ctx.out(format(issue, comments));
  },
};
