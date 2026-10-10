# Worker 协议

Worker 每次工作开一个运行 issue，在产品仓库里完成事项，在运行 issue 里汇报后关闭它。对 circus 只需要读权限：开 issue、评论、关闭自己开的 issue；事项的状态由 Action 根据运行 issue 推进（见 [database.md](database.md#action-做什么)）。

## 步骤

1. **读事项**：`gh issue view <n> -R ora-space/circus --comments`，再读"相关"里的记忆和链接，以及之前运行的汇报（事项的子 issue）。事项不是 `Ready`（`Running` 说明别的 worker 在做）时，先问 owner。
2. **开运行**：`bin/circus run <n>`，记下输出的运行 issue 编号 `<m>`。之后的提问、进展、链接都评论在 `<m>` 里，不在事项里。
3. **检查门禁**：先遵守产品仓库自己的 `AGENTS.md` / `CLAUDE.md`；feature 和 refactor 先按 [specs 根决策门禁](../memory/rules/specs-root-decision-gate.md) 检查。目标或验收条件不清楚、或门禁要求停下时，直接跳到第 6 步，状态写 `Needs Owner`。
4. **工作区**：每次运行一份独立 clone，例如
   `git clone https://github.com/ora-space/<repo> /tmp/ora/<repo>-<m> && git -C /tmp/ora/<repo>-<m> switch -c <type>/<slug>`。
   会话可能中断，阶段性成果及时 commit 并 push 到这个分支。
5. **开 PR**：commit 按 [commit 拆分偏好](../memory/preferences/pr-commit-split.md)。PR 描述写 `Refs ora-space/circus#<n>`，但不复制 circus 里的讨论和记忆内容。把 PR 链接评论到 `<m>`。
6. **汇报并关闭**：按 [汇报模板](database.md#汇报评论模板) 在 `<m>` 评论，`状态` 一行必填；然后 `gh issue close <m> -R ora-space/circus`。

完成标准：运行 issue 已关闭，最后一条评论是自成一体的汇报，`状态` 与实际一致。

## 汇报之外

- 工作中发现的新问题另开事项（`bin/circus new`，会进 `Inbox`），在汇报里列出编号；不在当前分支顺手扩大范围。
- owner 在对话中表达的长期偏好或原则，写进汇报的"需要 owner"，由 coordinator 开记忆 PR。
