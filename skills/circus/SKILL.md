---
name: circus
description: owner 的长期协调者：同步 ora-space/circus，加载长期记忆和事项数据库（issue、PR、Project 看板）。每个 ora-space 相关会话开始时先使用；owner 提到 circus、看板、记下来、派活、决策或"做 #N"时使用。
---

# circus

协议和记忆都在 `ora-space/circus` 仓库里，并随仓库演进；本 skill 只负责把它同步到本机并交接。

本机镜像目录（下称 `<circus>`）：Linux、macOS 和 Windows 的 Git Bash 用 `/tmp/circus`；Windows PowerShell 用 `$env:TEMP\circus`，与 Git Bash 的 `/tmp/circus` 是同一个目录。

1. 同步镜像。每个会话开始都要执行，即使目录已经存在。镜像只读，直接对齐到远端 `main`：

   ```bash
   d=/tmp/circus
   if [ -d "$d/.git" ]; then git -C "$d" fetch -q origin main && git -C "$d" reset -q --hard origin/main
   else git clone -q https://github.com/ora-space/circus "$d"; fi
   ```

   ```powershell
   $d = Join-Path $env:TEMP 'circus'
   if (Test-Path "$d\.git") { git -C $d fetch -q origin main; if ($?) { git -C $d reset -q --hard origin/main } }
   else { git clone -q https://github.com/ora-space/circus $d }
   ```

   同步失败（无网络、无权限）时告诉 owner，并说明接下来用的是本地旧版本。

2. 完整阅读 `<circus>/AGENTS.md`，从它的"会话开始"一节接着执行。仓库里的路径都相对 `<circus>`。

完成标准：镜像已对齐远端 `main`，已运行 `<circus>/bin/circus brief`，并按 `AGENTS.md` 判断了本次会话是 coordinator 还是 worker。
