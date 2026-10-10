# circus

owner 驱动 ora-space 项目开发的长期协调者：仿照 Claude Code Projects 的"协调者 + thread"模式，但把状态放在 GitHub 上，任何 agent 都能接入。

| Claude Projects | circus |
|---|---|
| 项目对话（coordinator） | 加载 `circus` skill 的任意会话，按 [AGENTS.md](AGENTS.md) 工作 |
| thread（worker） | 每次工作一个运行 issue，按 [docs/worker.md](docs/worker.md) 工作 |
| Overview 面板 | [看板](https://github.com/orgs/ora-space/projects/4)（Action 自动镜像），`bin/circus brief` |
| 项目记忆 | [memory/](memory/README.md)，经 PR 修改 |
| 项目指令 | [AGENTS.md](AGENTS.md) 和 [docs/](docs/) |

## 权限

| 谁 | 需要什么 |
|---|---|
| coordinator（owner 的会话） | circus 写权限（改 label）；安装 skill |
| worker | circus 读权限即可（开运行 issue、评论、关闭自己开的 issue），加上目标产品仓库的写权限；安装 skill |
| 只在 issue 里讨论的团队成员 | circus 读权限 |

没人需要 `project` scope：看板由 [`.github/workflows/circus.yml`](.github/workflows/circus.yml) 以 GitHub App 身份更新。这个 App 装在 ora-space 上，只授权 circus 仓库，权限是 Issues 读写和组织 Projects 读写；App ID 存在仓库变量 `CIRCUS_APP_ID`，私钥存在 secret `CIRCUS_APP_PRIVATE_KEY`。

安装 skill：`ln -s "$PWD/skills/circus" ~/.claude/skills/circus`。其他 agent 工具同理，把 `skills/circus/SKILL.md` 放进各自的 skills 目录。在本仓库内工作时，`.claude/skills/circus` 已自动提供该 skill。
