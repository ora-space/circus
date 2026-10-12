// Remotes of a clone whose origin may be a fork of the canonical repository.
import type { Git } from './gh.ts';

// Name of the remote pointing at the canonical repository, by https or ssh URL.
export function canonicalRemote(remotes: string, repo: string): string | undefined {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const url = new RegExp(`github\\.com[:/]${escaped}(\\.git)?/?$`, 'i');
  for (const line of remotes.split('\n')) {
    const [name, address, kind] = line.trim().split(/\s+/);
    if (kind === '(fetch)' && url.test(address)) return name;
  }
  return undefined;
}

// First line of git's error, or null on success.
export function tryGit(git: Git, args: string[]): string | null {
  try {
    git(args);
    return null;
  } catch (e) {
    return (e as Error).message.split('\n')[0];
  }
}

// `pre` selects the clone, e.g. ['-C', dir]. Adds an `upstream` remote when none points at
// the canonical repository; returns the remote's name and whether it was added.
export function ensureCanonical(git: Git, pre: string[], repo: string): { remote: string; added: boolean } {
  const found = canonicalRemote(git([...pre, 'remote', '-v']), repo);
  if (found) return { remote: found, added: false };
  git([...pre, 'remote', 'add', 'upstream', `https://github.com/${repo}.git`]);
  return { remote: 'upstream', added: true };
}

// When origin is a fork, fast-forwards its main to the fetched canonical main.
// Returns a line to report, or null when origin is the canonical repository itself.
export function pushForkMain(git: Git, pre: string[], remote: string): string | null {
  if (remote === 'origin' || !git([...pre, 'remote']).split('\n').includes('origin')) return null;
  const err = tryGit(git, [...pre, 'push', '-q', 'origin', `refs/remotes/${remote}/main:refs/heads/main`]);
  return err ? `fork 的 main 未更新：${err}` : `fork（origin）的 main 已对齐 ${remote}/main`;
}
