// Test doubles for Context: a scripted gh that records its calls, and captured output.
import type { Context } from './context.ts';

export interface Call {
  args: string[];
  input?: string;
}

// `respond` returns gh's stdout for a call; unmatched calls return "".
export function fakeContext(respond: (args: string[], input?: string) => string | undefined = () => '', extra: Partial<Context> = {}) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const ctx: Context = {
    gh: (args, input) => {
      calls.push({ args, input });
      return respond(args, input) ?? '';
    },
    git: () => {
      throw new Error('unexpected git');
    },
    repo: 'ora-space/circus',
    root: '/nonexistent',
    out: (line) => lines.push(line),
    env: {},
    read: () => {
      throw new Error('unexpected read');
    },
    ...extra,
  };
  return { ctx, calls, lines };
}

// Index of a flag's value in gh args, e.g. value(args, '--title').
export const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
