// A run is one attempt at an issue (its parent): opened with `Parent: #N` as the first
// line of the body. The bot labels it, links it as a sub-issue and reports its summary
// back to the parent when it closes.
import { splitSummary } from './summary.ts';

export const RUN_LABEL = 'run';

// Read from the original body, so a summary prepended on close does not hide it.
export function parentOf(body: string | null | undefined): number | null {
  const m = /^Parent:\s*#(\d+)/.exec(splitSummary(body).original);
  return m ? Number(m[1]) : null;
}

export function runBody(parent: number, text: string): string {
  return `Parent: #${parent}${text.trim() ? `\n\n${text.trim()}` : ''}`;
}
