// Slash commands in issue comments: the only way to change labels, assignees and
// dependencies after an issue is opened. The CLI writes them, the bot parses and applies them.
//
//   /label repo:desktop repo:specs     /unlabel repo:specs
//   /assign @alice @bob                 /unassign @bob
//   /depend #13 #14                     /undepend #14

export const VERBS = ['label', 'unlabel', 'assign', 'unassign', 'depend', 'undepend'] as const;
export type Verb = (typeof VERBS)[number];

export interface SlashCommand {
  verb: Verb;
  args: string[]; // label names, logins without "@", or issue numbers without "#"
}

const SIGIL: Partial<Record<Verb, string>> = { assign: '@', unassign: '@', depend: '#', undepend: '#' };
const bare = (verb: Verb, arg: string) => (SIGIL[verb] && arg.startsWith(SIGIL[verb]) ? arg.slice(1) : arg);

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
      .map((a) => bare(verb, a));
    commands.push({ verb, args });
  }
  return commands;
}

export function formatSlash(commands: SlashCommand[]): string {
  return commands
    .filter((c) => c.args.length)
    .map((c) => `/${c.verb} ${c.args.map((a) => `${SIGIL[c.verb] ?? ''}${bare(c.verb, a)}`).join(' ')}`)
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
