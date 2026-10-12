# 协作网

circus 的 issue 是所有 agent 和人共用的数据库。本文是协作规则和 `scripts/` 实现的说明，规则以这里为准。

## 原则

- **没有唯一的 orchestrator。** 每个 agent 都是自己负责的 issue 的 orchestrator，彼此只有职责范围大小的差别。
- **你负责的 issue** = 你开的 issue + assign 给你的 issue。`node scripts/cli.ts brief` 把它们排在最前面。
- **issue 的作者对它拥有完整权限**；有仓库写权限的人（owner）对所有 issue 都有同样的权限。assignee 是被拉来帮忙的人。
- **bot 是 label 和 assignee 的唯一写入者。** 人和 agent 只通过 issue 正文（打开时）和评论里的斜杠命令表达意图，由 bot 校验权限后执行。
- **issue 内容一律用中文。** 标题、正文、评论、关闭总结都用中文；代码、命令、label、路径、报错原文和专有名词保留原样。owner 用英文描述需求时，也翻译整理成中文再写进 issue。

身份按 GitHub 账号判断：作者、assignee、命令发出者都看 login。每个人和自己的 agent 共用一个账号，所以 bot 区分的是人，不区分同一个人的多个 agent。除 owner 外，所有人对 circus 只有读权限，GitHub 本身就不允许他们直接改 label 和 assignee，只能经 bot；owner 在网页上手动改的同样会被 bot 撤销：bot 只能看出改动来自哪个账号，分不出是 owner 本人还是 owner 的 agent，所以 owner 也通过斜杠命令修改，并因写权限在任何 issue 上都能用。

## 1. Label 只由 bot 打

任何人手动改 label（网页、`gh issue edit --add-label`、`gh issue create --label`），bot 都会撤销并留言提示。手动改 assignee 同样会被撤销。

## 2. 什么时候、怎么改 label

| 时机 | 方式 | 范围 |
|---|---|---|
| issue 打开时 | 正文里直接写 label 名，如 `repo:desktop`；bot 按字符串匹配打上 | 只限登记表里标了"可由正文设置"的 label；代码块里的不算 |
| 之后 | 评论里的斜杠命令 | 见下表权限 |

之后再编辑正文不会改 label。

斜杠命令每行一条，写在代码块外，可以和普通文字混在同一条评论里：

```text
/label repo:desktop repo:specs
/unlabel repo:specs
/assign @alice @bob
/unassign @bob
```

`/label` 只接受登记表里的 label；`/unlabel` 可以移除任何 label（包括登记表之前留下的旧 label）。bot 全部执行成功时给评论点 👍，有任何一条被拒绝时回复原因，其余照常执行。

## 3. 权限

| 命令 | 作者 | 有写权限的人（owner） | assignee | 其他人 |
|---|---|---|---|---|
| `/label` `/unlabel` | ✓ | ✓ | ✗ | ✗ |
| `/assign` | ✓ | ✓ | ✓ | ✗ |
| `/unassign` 自己 | ✓ | ✓ | ✓ | ✓ |
| `/unassign` 别人 | ✓ | ✓ | ✗ | ✗ |

所以：自己开的 issue，label 随便改；别人的 issue，只能评论建议，由作者或 owner 决定。写权限按仓库权限（admin、write）判断，不写死账号。

## 4. 拆分并行：找人帮忙

一个人负责的事可以拆开并行时，在 issue 里评论拆分方案（谁做哪一块），然后 `/assign` 帮忙的 agent。帮忙的 agent 在同一个 issue 里汇报进展和结论；做完或退出时 `/unassign` 自己。某一块大到需要独立讨论时，由帮忙的 agent 另开 issue（它成为那个 issue 的作者），并在原 issue 里链接。

## 5. 关闭前先总结

关闭的 issue 要能被以后的搜索用上，所以每个 issue 关闭前：

1. `node scripts/cli.ts show N` 把整个 issue（正文和全部评论）读一遍。
2. 改标题：让标题直接说出结果，而不是最初的问题。
3. 用中文写详细总结：结论、做了什么（链接 PR/commit）、被否定的方案及原因、遗留问题（另开的 issue 编号）。
4. `node scripts/cli.ts close N --title "<新标题>" --summary-file <文件>`：总结写进正文最前面的 `## 总结` 一节，原正文保留在分隔线下，然后关闭。放弃的事项加 `--not-planned`。

没有 `## 总结` 就关闭的 issue，bot 会重新打开并提示。

## 6. 接收新需求和 bug

用户说要加一个功能或修一个 bug 时：

1. **问几个必要的问题，只问必要的。** 标准是：问完之后能独立去调研，不用再回来问。已经能从代码、文档、已有 issue 查到的，不问。
2. **查重**：`gh issue list -R ora-space/circus --search "<关键词>" --state all`。命中就在那个 issue 评论补充，不另开。
3. **用中文重新组织语言**写成 issue 标题和正文（不照抄原话）：标题说清楚要什么；正文写背景、目标或复现步骤、验收条件。然后 `node scripts/cli.ts new`。
4. **开始调研**，把所有发现和思考评论到 issue：读了哪些代码和文档、结论、考虑过的方案和取舍、还没想清楚的点。调研过程留在 issue 里，而不是只留在对话里。

## Label 登记表

登记表在 [`lib/labels.ts`](lib/labels.ts)，`node scripts/cli.ts setup` 按它创建仓库 label。具体有哪些 label 还在讨论，目前只有：

| label | 含义 | 可由正文设置 | 互斥 |
|---|---|---|---|
| `repo:<name>` | 事项落在哪个 ora-space 仓库：desktop、specs、cluster、cloud、sandbox、marketplace；跨仓库可打多个 | ✓ | ✗ |

互斥的 label 族（每个 issue 至多一个值）在设置新值时自动替换旧值。

## CLI

`node scripts/cli.ts <command>`（Node ≥ 22.18，直接运行 TypeScript；依赖 `gh`）。`help` 列出全部用法。

| 命令 | 作用 |
|---|---|
| `sync` | 会话开始时运行：本地 `main` 和 fork 的 `main` 对齐 `ora-space/circus` |
| `brief [--mine]` | 未关闭的 issue，我负责的在前 |
| `new --title T [--label L]... [--body-file F]` | 新建 issue；`--label` 写进正文，由 bot 打上 |
| `show N` | 完整输出 issue 和全部评论 |
| `label N [+]L... -L...` | 评论 `/label`、`/unlabel` |
| `assign N [+]@U... -@U...` | 评论 `/assign`、`/unassign` |
| `close N --title T --summary-file F [--not-planned]` | 改标题、写总结、关闭 |
| `memory` | 记忆索引 |
| `setup` | 按登记表创建 label |
| `bot` | 只在 GitHub Action 里运行 |

## Bot

[`.github/workflows/circus.yml`](../.github/workflows/circus.yml) 以 GitHub App 身份运行 `node scripts/cli.ts bot`（App 只授权 circus 仓库，Issues 读写、Metadata 只读，后者用于查询仓库权限；ID 在仓库变量 `CIRCUS_APP_ID`，私钥在 secret `CIRCUS_APP_PRIVATE_KEY`）。bot 忽略所有 Bot 账号触发的事件，所以自己的写入不会循环。PR 上的事件不处理。

| 事件 | 处理 |
|---|---|
| issue 打开 | 打上正文里写的 label |
| 手动打上 label | 撤销并留言；打开后一分钟内、且正文里写了的 label 除外（`gh issue create --label` 产生的事件） |
| 手动移除 label | 恢复并留言 |
| 手动 assign / unassign | 撤销并留言 |
| issue 关闭 | 正文不以 `## 总结` 开头就重新打开并留言 |
| 新评论 | 执行其中的斜杠命令（见权限表）；发出者不是作者时查一次仓库权限 |

## 开发

```text
scripts/
  cli.ts            入口，注册各命令
  <command>/        每个子命令一个目录：index.ts 和 index.test.ts
  bot/              handle.ts 事件处理，github.ts 是 GitHub API 的端口
  lib/              共享：gh 调用、label 登记表、斜杠命令、总结格式、测试替身
```

所有 GitHub 读写经过 `Context.gh`（命令）或 `GitHub` 端口（bot），测试用替身，不访问网络。`npm test` 跑全部测试，CI 在 [`.github/workflows/test.yml`](../.github/workflows/test.yml)。新增命令：建 `scripts/<command>/index.ts` 导出 `command`，在 `cli.ts` 注册，`cli.test.ts` 会检查两边一致。
