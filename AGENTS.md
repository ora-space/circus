# circus

circus 是 owner 驱动 [ora-space](https://github.com/ora-space) 项目开发的协作网。owner 指对本仓库有写权限、做最终决定的人；其他成员只读。**和你对话的人不一定是 owner**，会话开始先确认身份。任何 agent 按本文件工作，就接上了同一份长期记忆：

- **记忆**：本仓库 [`memory/`](memory/README.md)，只存稳定内容：硬约束、方法、偏好。只经 PR 变更。
- **数据库**：本仓库的 issue，存一切会变的东西：任务、进度、待决问题、决策过程、调研发现、bug。label 和 assignee 只由 bot 修改。
- **协议**：本文件和 [`scripts/README.md`](scripts/README.md)（协作规则和 CLI），同样经 PR 演进。

## 会话开始

所有人都在自己的 circus 目录（clone 或 fork 的 clone）里工作，本文路径都相对它；产品仓库的 fork clone 也放在它下面的 `ora-space/<repo>`。CLI 是 `node scripts/cli.ts`（Node ≥ 22.18，依赖 `git` 和 `gh`），各平台用法相同。

1. 同步：**每个会话开始都要先同步 `ora-space/circus`**，因为本地仓库可能是 fork 或停在旧版本。运行 `node scripts/cli.ts sync`：本地 `main` 快进到 `ora-space/circus` 最新，origin 是 fork 时顺手把 fork 的 `main` 推到最新。完整步骤见 [`.agents/skills/circus/SKILL.md`](.agents/skills/circus/SKILL.md)；经 skill 进来的会话已完成这一步。同步失败时告诉用户。
2. 身份：`node scripts/cli.ts whoami`。agent 和它的人共用 GitHub 账号，所以这就是和你对话的人：有写权限的是 owner，只读的是成员。
3. 协议：完整阅读 [`scripts/README.md`](scripts/README.md)。
4. issue：`node scripts/cli.ts brief`，第一行再次说明身份，然后列出未关闭的 issue。最上面的"待关闭"组是你创建的、看起来已经做完的 issue（关联 PR 已合并、被 bot 重新打开过、或运行 issue 的 parent 已关闭），最优先处理：确认做完就按 [关闭前先总结](scripts/README.md#5-关闭前先总结) 关闭，没做完就在 issue 里说明还差什么。
5. 记忆：`node scripts/cli.ts memory` 列出索引；`rules/` 全部读，其余按当前任务读正文（规则见 [`memory/README.md`](memory/README.md)）。

完成标准：能说出和你对话的人是 owner 还是成员、你负责的 issue 有哪些，以及与本次任务相关的记忆条目。

## 角色

没有唯一的 orchestrator：每个 agent 都是自己负责的 issue 的 orchestrator，只是职责范围大小不同。你开的 issue 由你推进到关闭；被 `/assign` 进来的 issue，为分给你的那一块开运行 issue（`node scripts/cli.ts run N`）去做，在运行 issue 里汇报；决策 issue 例外，被 assign 进来就是当 [reviewer](scripts/README.md#决策-issue-的-assignee)，不开运行。团队成员在 issue 里讨论、提建议，决策由 owner 做。

## 处理用户的输入

用户指和你对话的人。用户是 owner 时，用户的决定就是 owner 的决定；用户是成员时，用户的意见是输入：需要 owner 拍板的事（决策、授权、合并、改记忆和协议）在 issue 里打 `status:needs-owner` 等 owner，不要当作已经批准。

每条输入（任务、bug、建议、问题、决策、堆栈）归入下列之一，并告诉用户你的归类：

1. **直接回答**：一次性问题，答完不留痕。
2. **并入已有 issue**：先 `gh issue list -R ora-space/circus --search "<关键词>" --state all` 查重；命中则评论补充。
3. **新建 issue**：功能和 bug 按 [接收新需求](scripts/README.md#6-接收新需求和-bug) 先问必要的问题，重新组织成标题和正文，`node scripts/cli.ts new` 后开始调研，发现都评论到 issue。
4. **记忆 PR**：用户表达了长期成立的规则、方法或偏好时，按 [`memory/README.md`](memory/README.md) 开 PR；是否合并由 owner 决定。

**"#N 有更新"**：先 `node scripts/cli.ts updates N`，看你上次发言之后的评论、status 变化、PR 和运行 issue，再按"球在谁手里"接着做：

- `status:needs-author`，你是作者：owner 或 reviewer 已经回复。按 owner 的结论或 reviewer 的意见推进（改方案、同步文档、开运行、改 PR），在 issue 里回复你打算怎么做；做完就关闭，需要 owner 再看就改回 `status:needs-owner`，PR 改完就重新打 `status:in-review`，否则 `/unlabel status:needs-author`。
- `status:needs-owner` 或 `status:in-review`，用户是 owner：把待决的点和各选项的代价讲给 owner，按 owner 的话在 issue 里写下结论，再 `/label status:needs-author` 交回作者。
- 别人的运行 issue assign 给你且挂着 `status:in-review`（`brief` 的"需要 review"）：你是它的 reviewer，按 [review 运行 issue](scripts/README.md#review-运行-issue) 在 PR 上 Approve 或 Request changes，再在运行 issue 上打 `review:lgtm` 或 `status:needs-author`。
- 其他情况：向用户概括新动静，问清要不要跟进；回复写在 issue 里。

`brief` 也会在你负责的 issue 行尾标出"N 条新回复"，不用等别人提醒。

**决策**是最需要留痕的输入：待决的开成 `type:decision` 并打 `status:needs-owner`，正文列选项、依据、代价，请 owner 拍板。决策 issue 不开运行，它的 assignee 相当于 reviewer，在决策 issue 上 `/assign` 前先[提醒用户](scripts/README.md#决策-issue-的-assignee)；相关的 issue 都依赖它，决策关闭前只能开 [preflight](scripts/README.md#preflight依赖未完成时先做)。owner 拍板时在 issue 里写下结论，并 `/label status:needs-author` 提醒作者跟进；作者随即按 [关闭前先总结](scripts/README.md#5-关闭前先总结) 关闭，不等 ADR 合并或实现完成。落地由依赖决策的 issue 承接：属于 Ora 产品架构的，开 ADR task 在 [ora-space/specs](https://github.com/ora-space/specs) 写 ADR；结论长期有效的，开记忆 PR。完整流程见 [决策的生命周期](scripts/README.md#决策的生命周期)。

## 写入边界

- 所有讨论统一在 upstream 仓库 `ora-space/circus` 的 issue 里进行，即使本地是 fork 的 clone。fork 只用来提 PR，不在 fork 上开 issue、评论或改 label。`node scripts/cli.ts` 的命令总是指向 `ora-space/circus`；直接用 `gh issue` / `gh pr` 时必须带 `-R ora-space/circus`，否则 gh 可能落到 fork 上。circus 是私有仓库，成员以协作者身份参与。
- issue 的标题、正文、评论和总结一律用中文；代码、命令、label、路径、报错原文和专有名词保留原样。
- 只有作者关闭自己的 issue，owner 也不例外：别人的 issue 做完了，在里面提醒作者总结后关闭。确需代关（作者离开、事项作废）时用 `close --for-author "<理由>"`，否则 bot 会重新打开。
- 运行 issue 有 `review:lgtm` 时，owner 可以据此减少审查；合并仍由 owner 决定。
- `preflight` 运行 issue 是 parent 依赖未完成时先做的开发（见 [preflight](scripts/README.md#preflight依赖未完成时先做)）：它的 PR 一般等依赖关闭、bot 转为 `run`、作者按结论核对后再合并。
- owner 合并 PR 前，先看改动文件列表（`gh pr view N -R <repo> --json files`）：每个文件都是[交付物](scripts/README.md#开发产品仓库)才合并，混入计划、进度、实现日志这类过程记录时请作者移除。产品仓库的 PR 还要核对它实现的 specs ADR（见 [ADR 状态跟着实现走](scripts/README.md#开发产品仓库)）：描述里没写 ADR 状态，或者本 PR 补齐了实现、ADR 却仍是 `approved` 且没有改为 `implemented` 的 specs PR，先请作者补上；产品 PR 合并后再合并这份 specs PR。合并时只合并 PR，不顺手关闭关联的 issue。circus 的 PR 合并后，bot 会在 `Refs` 的 issue 里提醒作者；产品仓库的 PR 合并后，在关联的运行 issue 里评论提醒作者，并在同一条评论里 `/label status:needs-author` 交回作者：合并后还有验收、收尾或关闭要作者做，只 `/unlabel status:in-review` 会让 issue 不在任何人的待办里。
- label 和 assignee 只通过 bot 修改：打开 issue 时写在正文里，之后用评论里的斜杠命令。权限见 [`scripts/README.md`](scripts/README.md#3-权限)。bot 在 GitHub Actions 里异步执行，常要几十秒到一分钟以上：分几次查看、累计等满一分钟以上仍没生效，先查 Actions 运行状态，再决定是否重发（见 [`scripts/README.md`](scripts/README.md#2-什么时候怎么改-label)）。
- 记忆和协议只能经 PR 改，PR 开在 `ora-space/circus`（从 fork 提时 `gh pr create -R ora-space/circus --head <login>:<branch>`），合并由 owner 决定。
- Ora 产品仓库只承载代码和 PR，不在那里开 issue 或展开讨论；产品仓库里已有的 issue 转为 circus issue（正文链接原 issue），后续讨论在 circus。用户已经说清楚要做的事可以直接开 PR（PR 由 owner 审），其余写入先得到用户同意。
- 在产品仓库工作时，用户没有另外指明就按 [开发产品仓库](scripts/README.md#开发产品仓库)：fork clone 在 `ora-space/<repo>`，每项开发用 `node scripts/cli.ts worktree` 基于最新 upstream main 建 worktree。先遵守该仓库的 `AGENTS.md` / `CLAUDE.md`；feature 和 refactor 先按 [specs 根决策门禁](memory/rules/specs-root-decision-gate.md) 检查；commit 按 [commit 拆分偏好](memory/preferences/pr-commit-split.md)。
- 产品仓库的 PR 只装[交付物](scripts/README.md#开发产品仓库)，开 PR 前逐个核对改动文件；开发过程记录写在运行 issue 里。PR 描述写明它实现的 ADR 状态，补齐了实现的同时开 specs PR 把 ADR 改为 `implemented`。
- 产品仓库多为公开仓库：每个 PR 都关联运行 issue，不直接关联普通 issue：PR 描述用 `Refs ora-space/circus#<运行 issue>`，但不把 circus 里的讨论和记忆内容复制过去。PR 链接评论到运行 issue。
- 进度和讨论只存在 issue 里；记忆和协议文件里不写进度、TODO 或状态。

## 演进

用户对协作方式的建议（流程、label、权限、本文件）走同样的 PR 流程（由 owner 合并）修改 `AGENTS.md`、`scripts/`、`.agents/skills/` 或 `.github/`。`.agents/skills/circus/SKILL.md` 只负责引导，协议细节写在仓库里。
