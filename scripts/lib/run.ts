// A run is one attempt at an issue (its parent): opened with `Parent: #N` as the first
// line of the body. The bot labels it, links it as a sub-issue and reports its summary
// back to the parent when it closes.
//
// A preflight is a run opened with `Parent: #N (preflight)` while #N still waits on open
// dependencies: work starts early, merging waits. It carries `preflight` instead of `run`;
// once #N has no open dependencies the bot swaps the label to `run`. The two labels are
// mutually exclusive.
//
// Decisions are made by the owner in the decision issue, not in a run: a type:decision issue
// has no runs, and while an issue depends on an open decision its runs can only be preflights.
import { splitSummary } from './summary.ts';

export const RUN_LABEL = 'run';
export const PREFLIGHT_LABEL = 'preflight';
export const DECISION_LABEL = 'type:decision';

// Read from the original body, so a summary prepended on close does not hide it.
export function parentOf(body: string | null | undefined): number | null {
  const m = /^Parent:\s*#(\d+)/.exec(splitSummary(body).original);
  return m ? Number(m[1]) : null;
}

export const isPreflightBody = (body: string | null | undefined) =>
  /^Parent:\s*#\d+[ \t]*\(preflight\)/.test(splitSummary(body).original);

export function runBody(parent: number, text: string, preflight = false): string {
  return `Parent: #${parent}${preflight ? ' (preflight)' : ''}${text.trim() ? `\n\n${text.trim()}` : ''}`;
}

interface Item {
  number: number;
  state: string; // REST: open or closed
  labels: { name: string }[];
}

const isDecision = (i: Item) => i.labels.some((l) => l.name === DECISION_LABEL);

export type RunKind =
  | { refused: string }
  // decisions: the open decisions that made a plain run a preflight.
  | { label: typeof RUN_LABEL | typeof PREFLIGHT_LABEL; decisions: number[] };

// What a run asked as a preflight or not becomes under `parent`, given the issues it is blocked by.
export function runKind(parent: Item, blockers: Item[], preflight: boolean): RunKind {
  if (isDecision(parent)) {
    return { refused: `#${parent.number} 是 ${DECISION_LABEL}，不能开运行 issue：决策由 owner 在 issue 里拍板。要实现结论，在依赖 #${parent.number} 的 issue 上开运行。` };
  }
  const open = blockers.filter((b) => b.state === 'open');
  const decisions = open.filter(isDecision).map((b) => b.number);
  if (decisions.length) return { label: PREFLIGHT_LABEL, decisions: preflight ? [] : decisions };
  return { label: preflight && open.length ? PREFLIGHT_LABEL : RUN_LABEL, decisions: [] };
}
