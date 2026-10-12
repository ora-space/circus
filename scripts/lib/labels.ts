// The label registry. A label is `<prefix>:<value>`; only registered labels can be set
// through the bot.

export interface LabelFamily {
  prefix: string;
  values: readonly string[];
  description: string;
  // Per-value description; falls back to `description`.
  descriptions?: Readonly<Record<string, string>>;
  color: string;
  // At most one value of the family per issue; setting one replaces the other.
  exclusive: boolean;
  // May be set by writing `<prefix>:<value>` in the issue body when the issue is opened.
  fromBody: boolean;
}

export const FAMILIES: readonly LabelFamily[] = [
  {
    prefix: 'type',
    values: ['task', 'bug', 'decision', 'question', 'idea'],
    description: '事项类型',
    descriptions: {
      task: '需要动手的工作',
      bug: '缺陷',
      decision: '等 owner 拍板的决策；关闭后是查"为什么这么定"的入口',
      question: '待调研或待澄清的问题',
      idea: '建议、想法，未决定做不做',
    },
    color: '1d76db',
    exclusive: true,
    fromBody: true,
  },
  {
    prefix: 'status',
    values: ['needs-owner', 'in-review'],
    description: '等 owner',
    descriptions: { 'needs-owner': '等 owner 回复、决策或授权', 'in-review': 'PR 待 owner 审' },
    color: 'fbca04',
    exclusive: true,
    fromBody: true,
  },
  {
    prefix: 'priority',
    values: ['p0', 'p1', 'p2', 'p3'],
    description: '优先级',
    descriptions: { p0: '立即', p1: '高', p2: '中', p3: '低' },
    color: 'd93f0b',
    exclusive: true,
    fromBody: true,
  },
  {
    prefix: 'repo',
    values: ['desktop', 'specs', 'cluster', 'cloud', 'sandbox', 'marketplace'],
    description: '事项落在哪个 ora-space 仓库',
    color: 'c5def5',
    exclusive: false,
    fromBody: true,
  },
];

// Labels without a value that only the bot sets and removes; no command can change them.
export const BOT_LABELS = [{ name: 'run', description: '一次运行：正文首行 Parent: #N', color: '5319e7' }] as const;

export const isBotLabel = (label: string) => BOT_LABELS.some((l) => l.name === label);

export function familyOf(label: string, families = FAMILIES): LabelFamily | undefined {
  const i = label.indexOf(':');
  if (i < 0) return undefined;
  const f = families.find((x) => x.prefix === label.slice(0, i));
  return f && f.values.includes(label.slice(i + 1)) ? f : undefined;
}

export const isKnown = (label: string, families = FAMILIES) => familyOf(label, families) !== undefined;

export function allLabels(families = FAMILIES): { name: string; description: string; color: string }[] {
  return [
    ...families.flatMap((f) => f.values.map((v) => ({ name: `${f.prefix}:${v}`, description: f.descriptions?.[v] ?? f.description, color: f.color }))),
    ...BOT_LABELS,
  ];
}

// Text outside fenced code blocks, so examples in code do not set labels.
function prose(body: string): string {
  return body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
}

// Registered labels of body-settable families written literally in the body,
// in order of appearance; an exclusive family keeps its first match.
export function labelsFromBody(body: string | null | undefined, families = FAMILIES): string[] {
  const text = prose(body ?? '');
  const found: string[] = [];
  for (const m of text.matchAll(/(?<![\w:/.-])([a-z][\w-]*):([\w.-]+)/g)) {
    const label = `${m[1]}:${m[2]}`;
    const f = familyOf(label, families);
    if (!f || !f.fromBody || found.includes(label)) continue;
    if (f.exclusive && found.some((l) => familyOf(l, families) === f)) continue;
    found.push(label);
  }
  return found;
}

// The label set after removing then adding; adding to an exclusive family replaces its value.
// Labels outside the registry are kept untouched.
export function applyLabels(current: string[], add: string[], remove: string[], families = FAMILIES): string[] {
  let next = current.filter((l) => !remove.includes(l));
  for (const label of add) {
    const f = familyOf(label, families);
    if (f?.exclusive) next = next.filter((l) => familyOf(l, families) !== f);
    if (!next.includes(label)) next.push(label);
  }
  return next;
}
