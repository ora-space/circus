// Every GitHub read and write goes through `gh`, so commands and the bot share one seam
// that tests replace with a fake.
import { execFileSync } from 'node:child_process';

// execFileSync defaults to a 1 MiB stdout buffer and fails with ENOBUFS beyond it;
// listing every open issue with comments already exceeds that.
const maxBuffer = 256 * 1024 * 1024;

export type Gh = (args: string[], input?: string) => string;

export const gh: Gh = (args, input) =>
  execFileSync('gh', args, { encoding: 'utf8', input: input ?? '', maxBuffer, stdio: ['pipe', 'pipe', 'inherit'] });

// git in a given directory; a failure throws with git's stderr as the message.
export type Git = (args: string[]) => string;

export const git =
  (cwd: string): Git =>
  (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim();
      throw new Error(stderr || (e as Error).message);
    }
  };

// REST call through `gh api`; the body goes in as JSON on stdin.
export function api<T = unknown>(run: Gh, method: string, path: string, body?: unknown): T {
  const args = ['api', '-X', method, path];
  if (body !== undefined) args.push('--input', '-');
  const out = run(args, body === undefined ? undefined : JSON.stringify(body));
  return (out.trim() ? JSON.parse(out) : undefined) as T;
}

export function graphql<T>(run: Gh, query: string, variables: Record<string, unknown>): T {
  const res = api<{ data: T; errors?: { message: string }[] }>(run, 'POST', 'graphql', { query, variables });
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
  return res.data;
}

// Every element of a paginated list endpoint. gh 2.46 has no --slurp, so pages are
// flattened to one JSON document per line.
export function apiList<T>(run: Gh, path: string): T[] {
  const out = run(['api', '--paginate', path, '--jq', '.[] | @json']);
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}
