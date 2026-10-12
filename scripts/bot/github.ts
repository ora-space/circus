// The slice of the GitHub API the bot uses, behind a port so handler tests run in memory.
import { api, type Gh } from '../lib/gh.ts';

export interface Issue {
  id: number;
  number: number;
  title: string;
  state: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string };
  assignees: { login: string }[];
  labels: { name: string }[];
  pull_request?: unknown;
}

export interface GitHub {
  getIssue(n: number): Issue;
  // Replaces the whole label set; avoids 404s from removing a label that is already gone.
  setLabels(n: number, labels: string[]): void;
  // Returns the assignees afterwards: GitHub silently skips users who cannot be assigned.
  addAssignees(n: number, logins: string[]): string[];
  removeAssignees(n: number, logins: string[]): void;
  comment(n: number, body: string): void;
  react(commentId: number, content: string): void;
  reopen(n: number): void;
  addSubIssue(parent: number, childId: number): void;
  // Repository permission of a user: admin, write, read or none.
  permission(login: string): string;
}

export function ghGitHub(gh: Gh, repo: string): GitHub {
  const base = `repos/${repo}/issues`;
  return {
    getIssue: (n) => api<Issue>(gh, 'GET', `${base}/${n}`),
    setLabels: (n, labels) => void api(gh, 'PUT', `${base}/${n}/labels`, { labels }),
    addAssignees: (n, logins) =>
      api<Issue>(gh, 'POST', `${base}/${n}/assignees`, { assignees: logins }).assignees.map((a) => a.login),
    removeAssignees: (n, logins) => void api(gh, 'DELETE', `${base}/${n}/assignees`, { assignees: logins }),
    comment: (n, body) => void api(gh, 'POST', `${base}/${n}/comments`, { body }),
    react: (id, content) => void api(gh, 'POST', `${base}/comments/${id}/reactions`, { content }),
    reopen: (n) => void api(gh, 'PATCH', `${base}/${n}`, { state: 'open' }),
    addSubIssue: (parent, childId) => void api(gh, 'POST', `${base}/${parent}/sub_issues`, { sub_issue_id: childId }),
    permission: (login) => api<{ permission: string }>(gh, 'GET', `repos/${repo}/collaborators/${login}/permission`).permission,
  };
}
