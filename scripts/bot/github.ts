// The slice of the GitHub API the bot uses, behind a port so handler tests run in memory.
import { api, apiList, type Gh } from '../lib/gh.ts';

export interface Issue {
  id: number;
  node_id: string;
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
  // blocked_by counts open dependencies.
  issue_dependencies_summary?: { blocked_by: number };
}

// A pull request in a product repository of the same organization.
export interface Pull {
  state: string;
  body: string | null;
  head: { sha: string };
}

// A workflow run; conclusion is null until it completes.
export interface WorkflowRun {
  id: number;
  name: string;
  workflow_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
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
  subIssues(parent: number): Issue[];
  // GitHub issue dependencies: the issues n is blocked by, and the issues n blocks.
  blockedBy(n: number): Issue[];
  blocking(n: number): Issue[];
  addBlockedBy(n: number, blockerId: number): void;
  removeBlockedBy(n: number, blockerId: number): void;
  // Open issues and pull requests (pull_request set) of the repository.
  listOpenIssues(): Issue[];
  // Repository permission of a user: admin, write, read or none.
  permission(login: string): string;
  // Product repositories (bare names, in the circus organization): a pull request, the
  // pull_request workflow runs of a commit, and re-running a run's failed jobs.
  getPull(repo: string, n: number): Pull;
  pullRuns(repo: string, sha: string): WorkflowRun[];
  rerunFailedJobs(repo: string, runId: number): void;
}

// products is gh with the token scoped to the product repositories; without it the product
// calls fail, so only /rerun is affected.
export function ghGitHub(gh: Gh, repo: string, products?: Gh): GitHub {
  const base = `repos/${repo}/issues`;
  const org = repo.split('/')[0];
  const product = () => {
    if (!products) throw new Error('bot 没有产品仓库的 token');
    return products;
  };
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
    subIssues: (parent) => apiList<Issue>(gh, `${base}/${parent}/sub_issues?per_page=100`),
    blockedBy: (n) => apiList<Issue>(gh, `${base}/${n}/dependencies/blocked_by?per_page=100`),
    blocking: (n) => apiList<Issue>(gh, `${base}/${n}/dependencies/blocking?per_page=100`),
    addBlockedBy: (n, id) => void api(gh, 'POST', `${base}/${n}/dependencies/blocked_by`, { issue_id: id }),
    removeBlockedBy: (n, id) => void api(gh, 'DELETE', `${base}/${n}/dependencies/blocked_by/${id}`),
    listOpenIssues: () => apiList<Issue>(gh, `${base}?state=open&per_page=100`),
    permission: (login) => api<{ permission: string }>(gh, 'GET', `repos/${repo}/collaborators/${login}/permission`).permission,
    getPull: (name, n) => api<Pull>(product(), 'GET', `repos/${org}/${name}/pulls/${n}`),
    pullRuns: (name, sha) =>
      api<{ workflow_runs: WorkflowRun[] }>(product(), 'GET', `repos/${org}/${name}/actions/runs?event=pull_request&head_sha=${sha}&per_page=100`)
        .workflow_runs,
    rerunFailedJobs: (name, id) => void api(product(), 'POST', `repos/${org}/${name}/actions/runs/${id}/rerun-failed-jobs`),
  };
}
