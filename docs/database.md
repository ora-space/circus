# 数据库 schema

circus 把 GitHub 当数据库。issue 和 label 是唯一的事实来源；[看板](https://github.com/orgs/ora-space/projects/4)由 [`.github/workflows/circus.yml`](../.github/workflows/circus.yml) 从 label 镜像过去，只读。`bin/circus` 封装常用读写，其余直接用 `gh`。

## 实体

| 实体 | 存在哪 | 用途 |
|---|---|---|
| 事项 | 没有 `run` label 的 issue | 任务、bug、决策、问题、建议；讨论都在这里 |
| 运行 | 带 `run` label 的 issue，首行 `Parent: #N`，是事项 #N 的子 issue | worker 的一次工作：认领、过程、汇报 |
| 记忆变更 | PR，label `memory` | owner 合并即确认 |
| 产品工作 | 产品仓库的 PR | 描述里 `Refs ora-space/circus#<事项>`；链接贴在运行 issue 里 |

配置（GitHub org、仓库、Project 编号）在 [`../circus.env`](../circus.env)。

## Labels

分类（建事项时选好，基本不变）：

- `type:task` 需要动手的工作；`type:bug` 缺陷；`type:decision` 等 owner 拍板的决策；`type:question` 待调研或待澄清的问题；`type:idea` 建议、想法，未决定做不做。
- `repo:<name>` 事项落在哪个 ora-space 仓库；跨仓库可打多个。

状态（每个未关闭的事项恰好一个，Action 保证互斥）：

| label | 看板 Status | 含义 | 谁推进 |
|---|---|---|---|
| `status:inbox` | Inbox | 刚记录，未分诊 | coordinator 分诊为 ready / needs-owner / 关闭 |
| `status:ready` | Ready | 定义清楚，可以开工 | worker 开运行 issue |
| `status:running` | Running | 有运行 issue 在做 | worker |
| `status:needs-owner` | Needs Owner | 等 owner 回复、决策或授权 | owner |
| `status:in-review` | In Review | PR 待 owner 审 | owner |
| （issue 已关闭） | Done | 完成或放弃 | — |

优先级：`priority:p0` 立即、`p1` 高、`p2` 中、`p3` 低。

新增 label 前先 `gh label list -R ora-space/circus`；基础集合由 `bin/circus setup` 维护。

## Action 做什么

- 新事项缺状态或优先级时补 `status:inbox`、`priority:p2`。只有读权限的人建的 issue，label 会被 GitHub 丢弃，靠这一步兜底。
- 手动打上新的 `status:*` / `priority:*` 时，移除同类旧 label。
- 运行 issue 打开：校验 #N 是未关闭的事项，打 `run`，挂为 #N 的子 issue，#N 置为 `running`。
- 运行 issue 关闭：从最后一条含 `状态：<值>` 的评论读出结论，更新 #N 并在 #N 留言指向汇报。`Done` 关闭 #N；没写结论按 `Needs Owner` 处理；#N 还有其他运行未关闭时只留言，保持 `running`。
- 事项每次变化后，同步到看板的 Status 和 Priority。运行 issue 不上看板。

## Issue 正文模板

事项：

```markdown
## 背景
为什么要做；来自 owner 的哪句话或哪个事项。

## 目标
做完是什么样子；可检查的验收条件。

## 相关
- 记忆：memory/...
- 链接：产品仓库的 issue、PR、ADR
```

`type:decision` 把"目标"换成"选项"：每个选项写依据和代价，末尾留"结论"待填。

运行（`bin/circus run N` 生成首行）：

```markdown
Parent: #N

开始处理：<会话或机器标识>
```

## 汇报评论模板

写在运行 issue 里，关闭前的最后一条：

```markdown
## 汇报 <YYYY-MM-DD>
- 结果：做了什么，产出链接（PR、commit、文档）
- 证据：跑了哪些测试或验证，哪些没验证
- 需要 owner：要决定或确认的事；没有写"无"
- 状态：In Review | Needs Owner | Ready | Done
```

`状态` 决定事项的下一步：有 PR 待审写 `In Review`，要 owner 决定写 `Needs Owner`，没做完、交还给下一次运行写 `Ready`，无需 PR 且已完成写 `Done`。coordinator 只读最近一次运行的汇报，所以汇报必须自成一体。

## 常用查询

```bash
bin/circus brief                                   # 所有未关闭的事项，按 Status 分组
bin/circus brief "Needs Owner"                     # 只看某个 Status
gh issue list -R ora-space/circus --search "label:repo:desktop -label:run"
gh issue view <n> -R ora-space/circus --comments
gh pr list -R ora-space/circus --label memory      # 待合并的记忆变更
```
