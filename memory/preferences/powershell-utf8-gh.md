---
summary: Windows PowerShell 下用 gh/CLI 写中文时，先写 UTF-8 文件再传路径；不要用管道喂 stdin。CLI 会拒绝疑似乱码输入。
scope: all
---

# Windows 上 gh 写中文

在 Windows PowerShell 里，把含中文的正文经管道交给 `gh` 或 circus CLI（例如 `@'...'@ | gh issue comment --body-file -`）时，管道默认编码不是 UTF-8，非 ASCII 会变成 `?`。

做法：用编辑器或工具写成 UTF-8 文件，再 `gh ... --body-file <路径>`（或 CLI 的 `--body-file` / `--summary-file <路径>`）。不要用管道把中文喂给 stdin。

`node scripts/cli.ts` 的 `readInput` 会拒绝非法 UTF-8，以及「有连续 `?`、无中文」的疑似损坏内容，避免把乱码写进 issue。
