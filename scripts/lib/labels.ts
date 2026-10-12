// The label registry. A label is `<prefix>:<value>`; only registered labels can be set
// through the bot. The set of families is still under discussion, `repo:` is a placeholder.

export interface LabelFamily {
  prefix: string;
  values: readonly string[];
  description: string;
  color: string;
  // At most one value of the family per issue; setting one replaces the other.
  exclusive: boolean;
  // May be set by writing `<prefix>:<value>` in the issue body when the issue is opened.
  fromBody: boolean;
}

export const FAMILIES: readonly LabelFamily[] = [
  {
    prefix: 'repo',
    values: ['desktop', 'specs', 'cluster', 'cloud', 'sandbox', 'marketplace'],
    description: '事项落在哪个 ora-space 仓库',
    color: 'c5def5',
    exclusive: false,
    fromBody: true,
  },
];

export function familyOf(label: string, families = FAMILIES): LabelFamily | undefined {
  const i = label.indexOf(':');
  if (i < 0) return undefined;
  const f = families.find((x) => x.prefix === label.slice(0, i));
  return f && f.values.includes(label.slice(i + 1)) ? f : undefined;
}

export const isKnown = (label: string, families = FAMILIES) => familyOf(label, families) !== undefined;

export function allLabels(families = FAMILIES) {
  return families.flatMap((f) =>
    f.values.map((v) => ({ name: `${f.prefix}:${v}`, description: f.description, color: f.color })),
  );
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
