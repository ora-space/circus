// A closed issue starts its body with a summary section, so search results and
// `gh issue view` show the outcome first. The original body is kept below a rule.
export const SUMMARY_HEADING = '## 总结';
const SEPARATOR = '\n\n---\n\n';

export const hasSummary = (body: string | null | undefined) => (body ?? '').trimStart().startsWith(SUMMARY_HEADING);

// Replaces an existing summary rather than stacking a second one on reclose.
export function withSummary(body: string | null | undefined, summary: string): string {
  let original = (body ?? '').trim();
  if (hasSummary(original)) {
    const i = original.indexOf(SEPARATOR);
    original = i < 0 ? '' : original.slice(i + SEPARATOR.length).trim();
  }
  const head = `${SUMMARY_HEADING}\n\n${summary.trim()}`;
  return original ? head + SEPARATOR + original : head;
}
