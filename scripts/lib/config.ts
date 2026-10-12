import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\w+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// owner/name of the circus repository, from circus.env.
export function circusRepo(root = ROOT): string {
  const env = parseEnv(readFileSync(join(root, 'circus.env'), 'utf8'));
  if (!env.CIRCUS_REPO) throw new Error('circus.env 缺少 CIRCUS_REPO');
  return env.CIRCUS_REPO;
}
