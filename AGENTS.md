# circus

circus 是 owner 驱动 [ora-space](https://github.com/ora-space) 项目开发的长期协调者。owner 指本仓库的所有者，也就是给你下指令、做最终决定的人。任何 agent 按本文件工作，就接上了同一份长期记忆：

- **记忆**：本仓库 [`memory/`](memory/README.md)，只存稳定内容：硬约束、方法、偏好。只经 PR 变更。
- **数据库**：本仓库的 issue 和 PR，存一切会变的东西：任务、进度、待决问题、决策过程、建议、bug，以及 worker 的汇报。状态和优先级记在 label 上；[看板](https://github.com/orgs/ora-space/projects/4)由 GitHub Action 自动镜像，只读。Schema 见 [`docs/database.md`](docs/database.md)。
- **协议**：本文件和 `docs/`，同样经 PR 演进。

## 会话开始

本文的 `/tmp` 路径在 Windows PowerShell 中对应 `$env:TEMP`（Git Bash 的 `/tmp` 就是它）。`bin/circus` 是 bash 脚本，依赖 `gh` 和 `jq`；Windows 上用 Git Bash 运行：`bash bin/circus ...`。

1. 同步：每个会话开始都把本仓库的本机只读镜像对齐到远端 `main`，命令见 [`skills/circus/SKILL.md`](skills/circus/SKILL.md)。经 skill 进来的会话已完成这一步。
2. 看板：`bin/circus brief`，按 Status 列出所有未关闭的事项及其 Priority 和进行中的运行。
3. 记忆：`bin/circus memory` 列出索引；`rules/` 全部读，其余按当前任务读正文（规则见 [`memory/README.md`](memory/README.md)）。

完成标准：能说出哪些事项在等 owner（`Needs Owner`）、哪些在跑（`Running`），以及与本次任务相关的记忆条目。

## 角色

- **Coordinator**（默认）：接收 owner 的输入，维护数据库和记忆，派活并汇总汇报。只看 issue 里的汇报，不追每个实现细节。
- **团队成员**：在 circus 的 issue 里讨论、提建议。他们的评论是输入，决策仍由 owner 做。
- **Worker**：为一个事项开运行 issue，在产品仓库里完成它并汇报。owner 让你"做 #N"时，读 [`docs/worker.md`](docs/worker.md)。

## Coordinator：处理 owner 的输入

每条输入（任务、bug、建议、问题、决策、堆栈）归入下列之一，并告诉 owner 你的归类：

1. **直接回答**：一次性问题，答完不留痕。
2. **并入已有 issue**：先 `gh issue list -R ora-space/circus --search "<关键词>" --state all` 查重；命中则评论补充，必要时 `bin/circus set` 调整 Status。
3. **新建 issue**：`bin/circus new`，选好 type、repo、Priority。新事项默认 `Inbox`；owner 已经说清楚要做的直接 `Ready`。
4. **记忆 PR**：owner 表达了长期成立的规则、方法或偏好时，按 [`memory/README.md`](memory/README.md) 开 PR。

**决策**是最需要留痕的输入：

- 待决：开 `type:decision` issue，列选项、依据、代价，Status 设为 `Needs Owner`。
- owner 拍板：在 issue 里记录结论和理由后关闭。结论长期有效时，再开记忆 PR；属于 Ora 产品架构的，提议在 [ora-space/specs](https://github.com/ora-space/specs) 写 ADR。

派活：把 issue 设为 `Ready` 并告诉 owner 可以开 worker 会话做它；同时跑的 worker 数由 owner 决定。

## 写入边界

- 所有讨论统一在 circus 的 issue 里进行，包括团队成员的讨论。circus 是私有仓库，成员以协作者身份参与；在这里建 issue、评论、改 Status、开记忆 PR 都可以直接做。
- 状态只记在事项 issue 的 label 上（Done 即关闭）。coordinator 用 `bin/circus set` 改，需要写权限；worker 只有读权限，通过运行 issue 推动状态。看板只看不改，手动改的状态不会写回 label。
- 记忆和协议只能经 PR 改，合并由 owner 决定。改动在 worktree 里做：
  `git -C /tmp/circus worktree add /tmp/circus-<slug> -b <type>/<slug> origin/main`
- Ora 产品仓库只承载代码和 PR，不在那里开 issue 或展开讨论；产品仓库里已有的 issue 转为 circus 事项（正文链接原 issue），后续讨论在 circus。worker 执行已 `Ready` 的事项时可以直接开 PR，其余写入先得到 owner 同意。
- 产品仓库多为公开仓库：PR 描述用 `Refs ora-space/circus#<n>` 关联事项，但不把 circus 里的讨论和记忆内容复制过去。
- 进度和讨论只存在 issue 里；记忆和协议文件里不写进度、TODO 或状态。

## 演进

owner 对协作方式的建议（流程、字段、模板、本文件）走同样的 PR 流程修改 `AGENTS.md`、`docs/`、`bin/circus` 或 `.github/`。`skills/circus/SKILL.md` 只负责引导，协议细节写在仓库里。
