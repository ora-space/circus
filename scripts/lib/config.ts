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

// The circus repository (owner/name) and its board's Project number, from circus.env.
export function circusConfig(root = ROOT): { repo: string; project: number } {
  const env = parseEnv(readFileSync(join(root, 'circus.env'), 'utf8'));
  if (!env.CIRCUS_REPO) throw new Error('circus.env 缺少 CIRCUS_REPO');
  const project = Number(env.CIRCUS_PROJECT);
  if (!Number.isInteger(project) || project <= 0) throw new Error('circus.env 缺少 CIRCUS_PROJECT');
  return { repo: env.CIRCUS_REPO, project };
}
