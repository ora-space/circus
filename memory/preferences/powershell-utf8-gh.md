---
summary: Windows PowerShell 下用 gh 写中文时，先写 UTF-8 文件再 --body-file，不要用管道喂 stdin。
scope: all
---

# Windows 上 gh 写中文

在 Windows PowerShell 里，把含中文的正文经管道交给 `gh`（例如 `@'...'@ | gh issue comment --body-file -`）时，管道默认编码不是 UTF-8，非 ASCII 会变成 `?`。

做法：用编辑器或工具写成 UTF-8 文件，再 `gh ... --body-file <路径>`（或 CLI 的 `--body-file` / `--summary-file`）。不要用管道把中文喂给 stdin。
