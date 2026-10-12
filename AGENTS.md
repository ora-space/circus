# circus

circus 是 owner 驱动 [ora-space](https://github.com/ora-space) 项目开发的协作网。owner 指本仓库的所有者，也就是做最终决定的人。任何 agent 按本文件工作，就接上了同一份长期记忆：

- **记忆**：本仓库 [`memory/`](memory/README.md)，只存稳定内容：硬约束、方法、偏好。只经 PR 变更。
- **数据库**：本仓库的 issue，存一切会变的东西：任务、进度、待决问题、决策过程、调研发现、bug。label 和 assignee 只由 bot 修改。
- **协议**：本文件和 [`scripts/README.md`](scripts/README.md)（协作规则和 CLI），同样经 PR 演进。

## 会话开始

所有人都在自己的 circus 目录（clone 或 fork 的 clone）里工作，本文路径都相对它；产品仓库的 fork clone 也放在它下面的 `ora-space/<repo>`。CLI 是 `node scripts/cli.ts`（Node ≥ 22.18，依赖 `git` 和 `gh`），各平台用法相同。

1. 同步：**每个会话开始都要先同步 `ora-space/circus`**，因为本地仓库可能是 fork 或停在旧版本。运行 `node scripts/cli.ts sync`：本地 `main` 快进到 `ora-space/circus` 最新，origin 是 fork 时顺手把 fork 的 `main` 推到最新。完整步骤见 [`skills/circus/SKILL.md`](skills/circus/SKILL.md)；经 skill 进来的会话已完成这一步。同步失败时告诉 owner。
2. 协议：完整阅读 [`scripts/README.md`](scripts/README.md)。
3. issue：`node scripts/cli.ts brief`，列出未关闭的 issue，你负责的（你是作者或 assignee）在前。
4. 记忆：`node scripts/cli.ts memory` 列出索引；`rules/` 全部读，其余按当前任务读正文（规则见 [`memory/README.md`](memory/README.md)）。

完成标准：能说出你负责的 issue 有哪些，以及与本次任务相关的记忆条目。

## 角色

没有唯一的 orchestrator：每个 agent 都是自己负责的 issue 的 orchestrator，只是职责范围大小不同。你开的 issue 由你推进到关闭；被 `/assign` 进来的 issue，为分给你的那一块开运行 issue（`node scripts/cli.ts run N`）去做，在运行 issue 里汇报。团队成员在 issue 里讨论、提建议，决策由 owner 做。

## 处理 owner 的输入

每条输入（任务、bug、建议、问题、决策、堆栈）归入下列之一，并告诉 owner 你的归类：

1. **直接回答**：一次性问题，答完不留痕。
2. **并入已有 issue**：先 `gh issue list -R ora-space/circus --search "<关键词>" --state all` 查重；命中则评论补充。
3. **新建 issue**：功能和 bug 按 [接收新需求](scripts/README.md#6-接收新需求和-bug) 先问必要的问题，重新组织成标题和正文，`node scripts/cli.ts new` 后开始调研，发现都评论到 issue。
4. **记忆 PR**：owner 表达了长期成立的规则、方法或偏好时，按 [`memory/README.md`](memory/README.md) 开 PR。

**决策**是最需要留痕的输入：待决的开成 `type:decision` 并打 `status:needs-owner`，正文列选项、依据、代价，请 owner 拍板；拍板后按 [关闭前先总结](scripts/README.md#5-关闭前先总结) 关闭。结论长期有效时，再开记忆 PR；属于 Ora 产品架构的，提议在 [ora-space/specs](https://github.com/ora-space/specs) 写 ADR。

## 写入边界

- 所有讨论统一在 circus 的 issue 里进行。circus 是私有仓库，成员以协作者身份参与。
- issue 的标题、正文、评论和总结一律用中文；代码、命令、label、路径、报错原文和专有名词保留原样。
- label 和 assignee 只通过 bot 修改：打开 issue 时写在正文里，之后用评论里的斜杠命令。权限见 [`scripts/README.md`](scripts/README.md#3-权限)。
- 记忆和协议只能经 PR 改，合并由 owner 决定。
- Ora 产品仓库只承载代码和 PR，不在那里开 issue 或展开讨论；产品仓库里已有的 issue 转为 circus issue（正文链接原 issue），后续讨论在 circus。owner 已经说清楚要做的事可以直接开 PR，其余写入先得到 owner 同意。
- 在产品仓库工作时，owner 没有另外指明就按 [开发产品仓库](scripts/README.md#开发产品仓库)：fork clone 在 `ora-space/<repo>`，每项开发用 `node scripts/cli.ts worktree` 基于最新 upstream main 建 worktree。先遵守该仓库的 `AGENTS.md` / `CLAUDE.md`；feature 和 refactor 先按 [specs 根决策门禁](memory/rules/specs-root-decision-gate.md) 检查；commit 按 [commit 拆分偏好](memory/preferences/pr-commit-split.md)。
- 产品仓库多为公开仓库：PR 描述用 `Refs ora-space/circus#<n>` 关联 issue，但不把 circus 里的讨论和记忆内容复制过去。PR 链接评论到 issue。
- 进度和讨论只存在 issue 里；记忆和协议文件里不写进度、TODO 或状态。

## 演进

owner 对协作方式的建议（流程、label、权限、本文件）走同样的 PR 流程修改 `AGENTS.md`、`scripts/` 或 `.github/`。`skills/circus/SKILL.md` 只负责引导，协议细节写在仓库里。
