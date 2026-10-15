// The board: an org Project that mirrors issues read-only, maintained by the bot alone.
// Runs are not on it; an issue with open runs shows as Running unless a status label says
// otherwise, and one with open dependencies as Blocked, or Preflight when a preflight run is
// already working on it. The bot also keeps the Status options and the Priority field in shape.
import { graphql, type Gh } from './gh.ts';

export const STATUS_OPTIONS = [
  { name: 'Open', color: 'GRAY', description: '未关闭，没有运行在做' },
  { name: 'Blocked', color: 'ORANGE', description: '有未完成的依赖' },
  { name: 'Preflight', color: 'PINK', description: '有未完成的依赖，preflight 运行在先做' },
  { name: 'Running', color: 'YELLOW', description: '有运行 issue 在做' },
  { name: 'Needs Owner', color: 'RED', description: '等 owner 回复、决策或授权' },
  { name: 'In Review', color: 'PURPLE', description: 'PR 待 owner 审' },
  { name: 'Needs Author', color: 'BLUE', description: 'owner 已回复，等作者跟进' },
  { name: 'Done', color: 'GREEN', description: '已关闭' },
] as const;
export const PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3'] as const;

const STATUS_BY_LABEL: Record<string, string> = {
  'status:needs-owner': 'Needs Owner',
  'status:in-review': 'In Review',
  'status:needs-author': 'Needs Author',
};

export type BoardValues = { Status: string; Priority?: string };

// Done > status label > Preflight (open dependencies, open preflight runs) > Blocked (open
// dependencies) > Running (open runs) > Open.
export function boardValues(
  issue: { state: string; labels: { name: string }[] },
  openRuns: number,
  openBlockers = 0,
  openPreflights = 0,
): BoardValues {
  const names = issue.labels.map((l) => l.name);
  const labelled = names.map((l) => STATUS_BY_LABEL[l]).find(Boolean);
  const derived = openBlockers > 0 ? (openPreflights > 0 ? 'Preflight' : 'Blocked') : openRuns > 0 ? 'Running' : 'Open';
  const status = issue.state === 'closed' ? 'Done' : (labelled ?? derived);
  const priority = names.find((l) => l.startsWith('priority:'))?.slice('priority:'.length).toUpperCase();
  return priority ? { Status: status, Priority: priority } : { Status: status };
}

export interface Board {
  // Puts the issue (by GraphQL node id) on the board and sets its fields. The first call
  // also fixes the Status options and creates the Priority field when they differ.
  sync(contentId: string, values: BoardValues): void;
}

interface Field {
  id: string;
  name: string;
  options?: { id: string; name: string }[];
}

export function ghBoard(gh: Gh, org: string, number: number, warn: (msg: string) => void = console.warn): Board {
  type Meta = { id: string; fields: Record<string, Field> };
  let meta: Meta | undefined;
  const fetch = (): Meta => {
    const data = graphql<{ organization: { projectV2: { id: string; fields: { nodes: Field[] } } } }>(
      gh,
      `query($o: String!, $n: Int!) { organization(login: $o) { projectV2(number: $n) {
        id fields(first: 50) { nodes { ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { options { id name } } } } } } }`,
      { o: org, n: number },
    );
    const p = data.organization.projectV2;
    return { id: p.id, fields: Object.fromEntries(p.fields.nodes.filter((f) => f.name).map((f) => [f.name, f])) };
  };
  const load = (): Meta => {
    if (meta) return meta;
    meta = fetch();
    if (ensureFields(meta)) meta = fetch();
    return meta;
  };

  // Whether the fields had to be changed. Rewriting Status options clears values set with
  // old options; the scheduled resync fills them in again.
  function ensureFields(p: Meta): boolean {
    let changed = false;
    const status = p.fields.Status;
    if (!status) throw new Error('看板没有内置的 Status 字段');
    const wanted = STATUS_OPTIONS.map((o) => o.name);
    if ((status.options ?? []).map((o) => o.name).join('\n') !== wanted.join('\n')) {
      graphql(
        gh,
        `mutation($f: ID!, $o: [ProjectV2SingleSelectFieldOptionInput!]) {
          updateProjectV2Field(input: {fieldId: $f, singleSelectOptions: $o}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`,
        { f: status.id, o: STATUS_OPTIONS },
      );
      warn(`看板 Status 选项已设为：${wanted.join(', ')}`);
      changed = true;
    }
    if (!p.fields.Priority) {
      graphql(
        gh,
        `mutation($p: ID!, $o: [ProjectV2SingleSelectFieldOptionInput!]!) {
          createProjectV2Field(input: {projectId: $p, dataType: SINGLE_SELECT, name: "Priority", singleSelectOptions: $o}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`,
        { p: p.id, o: PRIORITY_OPTIONS.map((name) => ({ name, color: 'GRAY', description: '' })) },
      );
      warn('看板已创建 Priority 字段');
      changed = true;
    }
    return changed;
  }

  // Concurrent events can race to add the same issue; fall back to the item that exists.
  function itemId(projectId: string, contentId: string): string {
    try {
      return graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
        gh,
        `mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: {projectId: $p, contentId: $c}) { item { id } } }`,
        { p: projectId, c: contentId },
      ).addProjectV2ItemById.item.id;
    } catch (e) {
      if (!/already exists/i.test((e as Error).message)) throw e;
      const data = graphql<{ node: { projectItems: { nodes: { id: string; project: { id: string } }[] } } }>(
        gh,
        `query($c: ID!) { node(id: $c) { ... on Issue { projectItems(first: 50) { nodes { id project { id } } } } } }`,
        { c: contentId },
      );
      const found = data.node.projectItems.nodes.find((n) => n.project.id === projectId);
      if (!found) throw e;
      return found.id;
    }
  }

  return {
    sync(contentId, values) {
      const p = load();
      const item = itemId(p.id, contentId);
      for (const [name, value] of Object.entries(values)) {
        const field = p.fields[name];
        const option = field?.options?.find((o) => o.name === value);
        if (!field || !option) {
          warn(`看板缺少字段 ${name} 或选项 ${value}`);
          continue;
        }
        graphql(
          gh,
          `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input:
            {projectId: $p, itemId: $i, fieldId: $f, value: {singleSelectOptionId: $o}}) { projectV2Item { id } } }`,
          { p: p.id, i: item, f: field.id, o: option.id },
        );
      }
    },
  };
}
