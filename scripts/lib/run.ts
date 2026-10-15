// A run is one attempt at an issue (its parent): opened with `Parent: #N` as the first
// line of the body. The bot labels it, links it as a sub-issue and reports its summary
// back to the parent when it closes.
//
// A preflight is a run opened with `Parent: #N (preflight)` while #N still waits on open
// dependencies, typically an undecided decision: work starts early, merging waits. It
// carries `preflight` instead of `run`; once #N has no open dependencies the bot swaps the
// label to `run`. The two labels are mutually exclusive.
import { splitSummary } from './summary.ts';

export const RUN_LABEL = 'run';
export const PREFLIGHT_LABEL = 'preflight';

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
