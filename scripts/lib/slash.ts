// Slash commands in issue comments: the only way to change labels and assignees after an
// issue is opened. The CLI writes them, the bot parses and applies them.
//
//   /label repo:desktop repo:specs     /unlabel repo:specs
//   /assign @alice @bob                 /unassign @bob

export const VERBS = ['label', 'unlabel', 'assign', 'unassign'] as const;
export type Verb = (typeof VERBS)[number];

export interface SlashCommand {
  verb: Verb;
  args: string[]; // label names, or logins without "@"
}

const isUserVerb = (verb: Verb) => verb === 'assign' || verb === 'unassign';

// One command per line, outside fenced code blocks. Lines starting with an unknown
// "/word" (paths, URLs) are not commands.
export function parseSlash(body: string | null | undefined): SlashCommand[] {
  const commands: SlashCommand[] = [];
  let fence: string | null = null;
  for (const line of (body ?? '').split(/\r?\n/)) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (fence === f[1]) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^\s*\/(\w+)(?:\s+(.*))?$/.exec(line);
    if (!m || !(VERBS as readonly string[]).includes(m[1])) continue;
    const verb = m[1] as Verb;
    const args = (m[2] ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((a) => (isUserVerb(verb) ? a.replace(/^@/, '') : a));
    commands.push({ verb, args });
  }
  return commands;
}

export function formatSlash(commands: SlashCommand[]): string {
  return commands
    .filter((c) => c.args.length)
    .map((c) => `/${c.verb} ${c.args.map((a) => (isUserVerb(c.verb) ? `@${a.replace(/^@/, '')}` : a)).join(' ')}`)
    .join('\n');
}

// CLI arguments "+x" / "x" add and "-x" removes.
export function fromSigned(args: string[], add: Verb, remove: Verb): SlashCommand[] {
  const plus = args.filter((a) => !a.startsWith('-')).map((a) => a.replace(/^\+/, ''));
  const minus = args.filter((a) => a.startsWith('-')).map((a) => a.slice(1));
  return [
    { verb: remove, args: minus },
    { verb: add, args: plus },
  ].filter((c) => c.args.length);
}
