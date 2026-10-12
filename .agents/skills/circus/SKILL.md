---
name: circus
description: ora-space 的协作网：同步 ora-space/circus，加载长期记忆、协作规则和 issue 数据库。每个 ora-space 相关会话开始时先使用；owner 提到 circus、issue、记下来、找人帮忙、决策或"做 #N"时使用。
---

# circus

协议和记忆都在 `ora-space/circus` 仓库里，并随仓库演进；本 skill 只负责同步并交接。所有人都在自己的 circus 目录（clone 或 fork 的 clone）里工作，下面的命令在该目录下执行。本地是 fork 时，issue 也一律在 upstream `ora-space/circus` 上进行，不在 fork 上开。产品仓库的 fork clone 在它下面的 `ora-space/<repo>`，开发用 `node scripts/cli.ts worktree` 建的 worktree，规则见 `scripts/README.md` 的"开发产品仓库"。

1. 同步。每个会话开始都要执行：本地仓库可能是 fork，或者停在旧版本。

   ```bash
   node scripts/cli.ts sync
   ```

   它找到（或添加）指向 `ora-space/circus` 的 remote 并拉取 `main`：在 `main` 上时快进本地 `main`；在其他分支上时只更新本地 `main`、不动当前分支，并报告当前分支领先和落后的提交数；origin 是 fork 时，把 fork 的 `main` 也推到最新。只做快进，不覆盖本地改动。

   同步失败（无网络、无权限、本地 `main` 无法快进）时告诉 owner，并说明接下来用的是本地旧版本。

2. 完整阅读 `AGENTS.md`，从它的"会话开始"一节接着执行。

完成标准：`sync` 报告 `main` 已对齐，已运行 `node scripts/cli.ts brief`，知道和你对话的人是 owner 还是成员、本次会话负责哪些 issue。
