// The part of a Markdown body that renders as prose. Code (fenced, indented, inline) and
// HTML comments become blank, keeping one output line per input line, so examples and
// hidden text never act as slash commands, labels or relations.
//
// Deliberately stricter than CommonMark: a fence opens at any indent and every line
// indented four or more columns counts as code, since commands and labels are written
// at the start of a line and dropping one is safer than running one by accident.

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

export function prose(body: string | null | undefined): string {
  let fence: string | null = null;
  const state = { comment: false };
  return (body ?? '')
    .split(/\r?\n/)
    .map((line) => {
      if (fence !== null) {
        const close = FENCE.exec(line);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length && !close[2].trim()) fence = null;
        return '';
      }
      if (!state.comment) {
        const open = FENCE.exec(line);
        // A backtick fence's info string cannot contain backticks; such a line is inline code.
        if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
          fence = open[1];
          return '';
        }
        if (/^( {4}|\t)/.test(line)) return '';
      }
      return inline(line, state);
    })
    .join('\n');
}

// Drops code spans and HTML comments from one line; a comment may continue onto later lines.
function inline(line: string, state: { comment: boolean }): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.comment) {
      const end = line.indexOf('-->', i);
      if (end < 0) return out;
      state.comment = false;
      i = end + 3;
      out += ' ';
      continue;
    }
    const m = /(`+)|<!--/g;
    m.lastIndex = i;
    const hit = m.exec(line);
    if (!hit) return out + line.slice(i);
    out += line.slice(i, hit.index);
    if (!hit[1]) {
      state.comment = true;
      i = hit.index + 4;
      continue;
    }
    const run = hit[1];
    const close = new RegExp(`(?<!\`)\`{${run.length}}(?!\`)`, 'g');
    close.lastIndex = hit.index + run.length;
    const end = close.exec(line);
    if (end) {
      out += ' ';
      i = end.index + run.length;
    } else {
      out += run; // an unmatched run is literal text
      i = hit.index + run.length;
    }
  }
  return out;
}
