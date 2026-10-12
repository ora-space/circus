// A closed issue starts its body with a summary section, so search results and
// `gh issue view` show the outcome first. The original body is kept below a rule.
export const SUMMARY_HEADING = '## 总结';
const SEPARATOR = '\n\n---\n\n';

export const hasSummary = (body: string | null | undefined) => (body ?? '').trimStart().startsWith(SUMMARY_HEADING);

// A body split into its summary (empty when there is none) and the original text below it.
export function splitSummary(body: string | null | undefined): { summary: string; original: string } {
  const text = (body ?? '').trim();
  if (!hasSummary(text)) return { summary: '', original: text };
  const i = text.indexOf(SEPARATOR);
  const head = i < 0 ? text : text.slice(0, i);
  return {
    summary: head.slice(SUMMARY_HEADING.length).trim(),
    original: i < 0 ? '' : text.slice(i + SEPARATOR.length).trim(),
  };
}

// Replaces an existing summary rather than stacking a second one on reclose.
export function withSummary(body: string | null | undefined, summary: string): string {
  const { original } = splitSummary(body);
  const head = `${SUMMARY_HEADING}\n\n${summary.trim()}`;
  return original ? head + SEPARATOR + original : head;
}
