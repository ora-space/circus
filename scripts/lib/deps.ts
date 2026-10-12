// Relations written as lines in an issue body:
//   依赖：#13 #14     blocked by #13 and #14; the bot turns it into GitHub issue dependencies
//                     when the issue opens. Later changes go through /depend and /undepend.
//   总事项：#11       part of #11; only read by brief to draw the tree, never stored elsewhere.
import { splitSummary } from './summary.ts';

const refs = (text: string) => [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

export function dependsFromBody(body: string | null | undefined): number[] {
  const out: number[] = [];
  for (const m of splitSummary(body).original.matchAll(/^\s*依赖\s*[:：]([^\n]*)$/gm)) {
    for (const n of refs(m[1])) if (!out.includes(n)) out.push(n);
  }
  return out;
}

// Also accepts prose such as "关联总事项 #11".
export function epicOf(body: string | null | undefined): number | null {
  const m = /总事项\s*[:：]?\s*#(\d+)/.exec(splitSummary(body).original);
  return m ? Number(m[1]) : null;
}

export const dependLine = (issues: number[]) => `依赖：${issues.map((n) => `#${n}`).join(' ')}`;
export const epicLine = (issue: number) => `总事项：#${issue}`;
