import { readFileSync } from 'node:fs';
import type { Gh, Git } from './gh.ts';

// What a command needs from the outside world; tests pass fakes.
export interface Context {
  gh: Gh;
  git: Git; // runs in root
  repo: string; // owner/name of the circus repository
  project: number; // board: Project number in the repository owner's org
  root: string; // checkout root
  out: (line: string) => void;
  env: Record<string, string | undefined>;
  // Contents of a file argument; "-" reads stdin.
  read: (path: string) => string;
}

export interface Command {
  usage: string; // first line is the synopsis shown by `cli.ts help`
  run: (args: string[], ctx: Context) => void | Promise<void>;
}

export const readInput = (path: string) => readFileSync(path === '-' ? 0 : path, 'utf8');

export class UsageError extends Error {}

// Issue number argument, accepting "12" and "#12".
export function issueNumber(arg: string | undefined, usage: string): number {
  const m = /^#?(\d+)$/.exec(arg ?? '');
  if (!m) throw new UsageError(usage);
  return Number(m[1]);
}
