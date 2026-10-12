#!/usr/bin/env node
// circus CLI: node scripts/cli.ts <command> [args]. Each command lives in scripts/<command>/.
import { circusConfig, ROOT } from './lib/config.ts';
import { readInput, UsageError, type Command, type Context } from './lib/context.ts';
import { gh, git } from './lib/gh.ts';
import { command as assign } from './assign/index.ts';
import { command as bot } from './bot/index.ts';
import { command as brief } from './brief/index.ts';
import { command as close } from './close/index.ts';
import { command as label } from './label/index.ts';
import { command as memory } from './memory/index.ts';
import { command as create } from './new/index.ts';
import { command as setup } from './setup/index.ts';
import { command as run } from './run/index.ts';
import { command as show } from './show/index.ts';
import { command as sync } from './sync/index.ts';

export const COMMANDS: Record<string, Command> = { sync, brief, new: create, run, show, label, assign, close, memory, setup, bot };

export function help(): string {
  const lines = Object.values(COMMANDS).map((c) => '  ' + c.usage.split('\n').join('\n  '));
  return ['usage: node scripts/cli.ts <command>', '', ...lines].join('\n');
}

async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv;
  if (!name || name === 'help' || name === '-h' || name === '--help') {
    console.log(help());
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    console.error(help());
    return 1;
  }
  const ctx: Context = {
    gh,
    git: git(ROOT),
    ...circusConfig(),
    root: ROOT,
    out: (line) => console.log(line),
    env: process.env,
    read: readInput,
  };
  try {
    await command.run(args, ctx);
    return 0;
  } catch (e) {
    console.error(e instanceof UsageError ? `usage: ${e.message}` : `circus: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
