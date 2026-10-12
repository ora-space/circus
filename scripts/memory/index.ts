import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from '../lib/context.ts';

const usage = `memory
    从 memory/ 各文件的 frontmatter（summary、scope）生成记忆索引。`;

const DIRS = ['rules', 'methods', 'preferences'];

export function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of m ? m[1].split(/\r?\n/) : []) {
    const kv = /^(\w+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (kv) fields[kv[1]] = kv[2];
  }
  return fields;
}

export const command: Command = {
  usage,
  run(_args, ctx) {
    const sections = DIRS.map((dir) => {
      const path = join(ctx.root, 'memory', dir);
      const files = existsSync(path) ? readdirSync(path).filter((f) => f.endsWith('.md')).sort() : [];
      const lines = files.map((f) => {
        const { summary = '', scope = '' } = frontmatter(readFileSync(join(path, f), 'utf8'));
        return `- memory/${dir}/${f} [${scope}] ${summary}`;
      });
      return [`## ${dir}`, ...lines, ''].join('\n');
    });
    ctx.out(sections.join('\n').trimEnd());
  },
};
