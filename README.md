# circus

owner 驱动 ora-space 项目开发的协作网：状态放在 GitHub issue 上，任何 agent 都能接入；没有唯一的协调者，每个 agent 推进自己负责的 issue。

| 是什么 | 在哪 |
|---|---|
| 入口 | 加载 `circus` skill 的任意会话，按 [AGENTS.md](AGENTS.md) 工作 |
| 协作规则、label、权限、CLI | [scripts/README.md](scripts/README.md) |
| 待办和讨论 | 本仓库 issue，`node scripts/cli.ts brief` |
| 长期记忆 | [memory/](memory/README.md)，经 PR 修改 |

## 权限

| 谁 | 需要什么 |
|---|---|
| 团队成员和他们的 agent | circus 读权限（开 issue、评论、编辑和关闭自己开的 issue）；每个人和自己的 agent 共用一个 GitHub 账号；改代码时加上目标产品仓库的写权限；安装 skill |
| owner | circus 唯一的写权限，因此能在任何 issue 上用斜杠命令改 label 和 assignee；维护 bot 的 GitHub App |

label 和 assignee 由 bot 写：[`.github/workflows/circus.yml`](.github/workflows/circus.yml) 以 GitHub App 身份运行。这个 App 装在 ora-space 上，只授权 circus 仓库，权限是 Issues 读写和 Metadata 只读；App ID 存在仓库变量 `CIRCUS_APP_ID`，私钥存在 secret `CIRCUS_APP_PRIVATE_KEY`。

安装 skill：`ln -s "$PWD/skills/circus" ~/.claude/skills/circus`。其他 agent 工具同理，把 `skills/circus/SKILL.md` 放进各自的 skills 目录。在本仓库内工作时，`.claude/skills/circus` 已自动提供该 skill。
