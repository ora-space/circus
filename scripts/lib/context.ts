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

export class UsageError extends Error {}

// PowerShell pipes often replace non-ASCII with ASCII '?'; circus issue text is Chinese,
// so consecutive '?' with no CJK is almost always corruption, not prose.
const CJK = /[\u4e00-\u9fff]/;
const QUESTION_RUN = /\?{2,}/;

export function decodeUtf8(buf: Buffer, source: string): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new UsageError(
      `${source}: 不是合法 UTF-8。请保存为 UTF-8 后重试；Windows PowerShell 不要用管道喂中文 stdin，改传文件路径。`,
    );
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (QUESTION_RUN.test(text) && !CJK.test(text)) {
    throw new UsageError(
      `${source}: 内容疑似编码损坏（有连续 ?、无中文）。Windows PowerShell 管道常把非 ASCII 弄成 ?：写成 UTF-8 文件后传入路径，不要用 --body-file - / --summary-file - 接管道。`,
    );
  }
  return text;
}

export const readInput = (path: string) => decodeUtf8(readFileSync(path === '-' ? 0 : path), path === '-' ? 'stdin' : path);

// Issue number argument, accepting "12" and "#12".
export function issueNumber(arg: string | undefined, usage: string): number {
  const m = /^#?(\d+)$/.exec(arg ?? '');
  if (!m) throw new UsageError(usage);
  return Number(m[1]);
}
