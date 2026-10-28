# 协作网

circus 的 issue 是所有 agent 和人共用的数据库。本文是协作规则和 `scripts/` 实现的说明，规则以这里为准。

## 原则

- **没有唯一的 orchestrator。** 每个 agent 都是自己负责的 issue 的 orchestrator，彼此只有职责范围大小的差别。
- **你负责的 issue** = 你开的 issue + assign 给你的 issue。`node scripts/cli.ts brief` 把它们排在最前面。
- **issue 的作者对它拥有完整权限**；有仓库写权限的人（owner）对所有 issue 都有同样的权限。assignee 是被拉来帮忙的人。
- **bot 是 label 和 assignee 的唯一写入者。** 人和 agent 只通过 issue 正文（打开时）和评论里的斜杠命令表达意图，由 bot 校验权限后执行。
- **issue 内容一律用中文。** 标题、正文、评论、关闭总结都用中文；代码、命令、label、路径、报错原文和专有名词保留原样。owner 用英文描述需求时，也翻译整理成中文再写进 issue。

**issue 都在 upstream 仓库 `ora-space/circus`。** 本地 circus 可能是 fork 的 clone，但 issue、评论、斜杠命令和 PR 都在 `ora-space/circus` 上进行，bot 也只在那里运行；fork 上的 issue 不会被任何人看到或处理。CLI 的命令总是带 `-R ora-space/circus`（来自 `circus.env`）；直接用 `gh issue` / `gh pr` 时也要带上。

身份按 GitHub 账号判断（`node scripts/cli.ts whoami` 说明当前账号是 owner 还是成员）：作者、assignee、命令发出者都看 login。每个人和自己的 agent 共用一个账号，所以 bot 区分的是人，不区分同一个人的多个 agent。除 owner 外，所有人对 circus 只有读权限，GitHub 本身就不允许他们直接改 label 和 assignee，只能经 bot；owner 在网页上手动改的同样会被 bot 撤销：bot 只能看出改动来自哪个账号，分不出是 owner 本人还是 owner 的 agent，所以 owner 也通过斜杠命令修改，并因写权限在任何 issue 上都能用。

## 1. Label 只由 bot 打

任何人手动改 label（网页、`gh issue edit --add-label`、`gh issue create --label`），bot 都会撤销并留言提示。手动改 assignee 同样会被撤销。

## 2. 什么时候、怎么改 label

| 时机 | 方式 | 范围 |
|---|---|---|
| issue 打开时 | 正文里直接写 label 名，如 Labels: repo:desktop（不加反引号）；bot 按字符串匹配打上 | 只限登记表里标了"可由正文设置"的 label；代码块、缩进代码、行内代码和 HTML 注释里的不算，只是提到 label 时就用反引号括起来 |
| 之后 | 评论里的斜杠命令 | 见下表权限 |

之后再编辑正文不会改 label。

斜杠命令每行一条，从行首写起，可以和普通文字混在同一条评论里。代码块、缩进 4 格及以上的行、行内代码和 HTML 注释里的命令不执行，所以只是提到命令时用反引号括起来：

```text
/label repo:desktop repo:specs
/unlabel repo:specs
/assign @alice @bob
/unassign @bob
/depend #13 #14
/undepend #14
/rerun desktop#123
```

`/label` 只接受登记表里的 label；`/unlabel` 可以移除任何 label（包括登记表之前留下的旧 label）。由 bot 管理的 label（`run`、`preflight`）两个命令都不能动。bot 全部执行成功时给评论点 👍，有任何一条被拒绝时回复原因，其余照常执行。

**bot 是异步的，要等。** bot 跑在 GitHub Actions 里，排队加启动常常要几十秒，慢时超过一分钟。发出斜杠命令或打开 issue 后，看不到 👍、回复或 label 变化不代表失败：分几次查看（`node scripts/cli.ts show N` 或 `gh issue view N -R ora-space/circus`），累计等满一分钟以上仍没有动静，再用 `gh run list -R ora-space/circus --workflow circus.yml` 看这条事件的运行是否还在排队、在跑或已失败。确认运行失败或根本没有触发后才重发命令；在此之前不要重发、改用别的命令或手动改 label：前一条命令随后仍会被执行，重发会多出一轮处理和留言，手动改的会被撤销。

## 3. 权限

| 命令 | 作者 | 有写权限的人（owner） | assignee | 其他人 |
|---|---|---|---|---|
| `/label` `/unlabel` `/depend` `/undepend` | ✓ | ✓ | ✗（运行 issue 的 assignee 可以 review，见下文） | ✗ |
| `/assign` | ✓ | ✓ | ✓ | ✗ |
| `/unassign` 自己 | ✓ | ✓ | ✓ | ✓ |
| `/unassign` 别人 | ✓ | ✓ | ✗ | ✗ |
| `/rerun`（只在运行 issue） | ✓ | ✓ | ✓ | ✗ |

所以：自己开的 issue，label 随便改；别人的 issue，只能评论建议，由作者或 owner 决定。唯一的例外是运行 issue 的 assignee 作为 reviewer 打 review 结论（见下文"review 运行 issue"）。写权限按仓库权限（admin、write）判断，不写死账号。

### 重跑产品仓库的 CI

成员对产品仓库只有读权限，不能重跑 PR 的 CI，由 bot 代劳：在运行 issue 里评论 `/rerun desktop#123`（也可以写 PR 链接，一行可以列多个），CLI 是 `node scripts/cli.ts rerun <运行 issue> desktop#123`。bot 只接受描述里写了 `Refs ora-space/circus#<本运行 issue>` 的未关闭 PR；在 PR 的最新 head 上，每个 workflow 取最近一次 `pull_request` 运行，失败、取消或超时的就重跑其中失败的 job，还在跑的不动，然后回复重跑的链接。没有可重跑的运行时回复原因。重跑只是重放原来的运行，fork PR 依旧拿不到 secret。

## review 运行 issue

成员可以帮 owner review 别人的运行 issue，owner 会据此减少自己的审查，合并仍由 owner 决定。

运行 issue 的 assignee 就是 reviewer：需要谁帮忙 review，就在运行 issue 里 `/assign` 对方（作者和 owner 都可以）。作者开完 PR 后给运行 issue 打 `status:in-review`，从这时起 reviewer 的 `brief` 在"需要 review"一组里列出它，reviewer 也才能打下面两个 label。只有 reviewer 和 owner 能打，其他成员只能评论。review 完、不再跟进时，reviewer `/unassign` 自己。review 的步骤：

1. 在产品仓库的 PR 上留 GitHub 原生 review：没问题就 Approve，有问题就 Request changes，具体意见写在 PR 上。成员没有写权限也能提交 review，只是不计入合并条件。review 时同时核对 PR 描述里的 [ADR 状态](#开发产品仓库)：没写，或者本 PR 补齐了实现却没有把 ADR 改为 `implemented` 的 specs PR，都按有问题处理。
2. 在 circus 的运行 issue 上留结论，由 bot 校验后执行：
   - 没问题：`node scripts/cli.ts label N +review:lgtm --sha <审过的 commit>`。评论里必须写明 commit SHA，否则 bot 拒绝。
   - 有问题：`node scripts/cli.ts label N +status:needs-author`，再评论一条简述问题，或者链到 PR 上的 review。它替换掉 `status:in-review`，球回到作者手里，issue 离开 owner 的待审队列。
   - 撤回 lgtm：`node scripts/cli.ts label N -review:lgtm`。

规则：

- 作者不能给自己的运行 issue 打 `review:lgtm`，owner 也不例外；正文里写 `review:lgtm` 不会被打上。
- lgtm 只对审过的那个 commit 成立。有人打 `status:needs-author`（needs-author 优先于 lgtm），或者作者改完后重新打 `status:in-review`，bot 都会清掉 `review:lgtm`。所以作者 push 新 commit 后，要重新打一次 `status:in-review`，请人再审。
- 一个 issue 只有一个 `review:lgtm`，记不了是谁、几个人打的：`updates N` 列出谁用斜杠命令改过 label。
- owner 的 `brief` 把已 lgtm 的排在"等我处理"最前面；成员的 `brief` 有"需要 review"一组，列出 assign 给自己的、`status:in-review` 的运行 issue。

### 决策 issue 的 assignee

`type:decision` 不开运行，没有可以分出去的一块，所以决策 issue 的 assignee 相当于 reviewer：被 assign 的人审决策材料、在 issue 里提意见，不负责推进，也不替作者改方案、写结论。推进决策的始终是作者，拍板的是 owner。所以不要轻易 assign：

- 想让某人做调研、写 ADR 或实现，开一个依赖该决策的 task issue（或者用已有的），在那里 assign 对方，由对方开运行（决策关闭前开 preflight）。
- agent 在决策 issue 上发 `/assign` 之前，先向用户说明 assignee 在这里是 reviewer，用户确认后再发。

## 4. 拆分并行：找人帮忙，开运行 issue

一个人负责的事可以拆开并行时，在 issue 里评论拆分方案（谁做哪一块），然后 `/assign` 帮忙的 agent。assign 不会自动开运行 issue。

**运行 issue（run）** 是某个 agent 对一个 issue（parent）的一次工作：认领、过程、汇报都写在运行 issue 里，parent 只留需求和讨论，不被过程记录淹没。

1. 开始做之前 `node scripts/cli.ts run N`：开一个正文首行为 `Parent: #N` 的 issue，你是它的作者。
2. bot 给它打上 `run`，挂为 #N 的子 issue。你不在 #N 的 assignee 里时，bot 兜底补上。
3. 过程中的提问、进展、PR 链接都评论在运行 issue 里。
4. 结束时按第 5 条关闭运行 issue；`## 总结` 就是汇报，必须自成一体。bot 把总结评论到 #N。
5. 退出 #N 时 `/unassign` 自己。

同一个 issue 可以同时有多个运行 issue，分别属于不同 agent，或者同一个 agent 的多次尝试。

### preflight：依赖未完成时先做

parent 还在等未关闭的依赖，但要先开发、先提 PR 时，用 `node scripts/cli.ts run N --preflight` 开运行 issue，正文首行是 `Parent: #N (preflight)`。

**决策阻塞开发。** 和某个 `type:decision` 相关的 issue 都必须依赖它（`依赖：#N` 或 `/depend #N`）。parent 依赖的决策还没关闭时只能开 preflight：`run` 不加 `--preflight` 会报错；绕过 CLI 开的普通运行，bot 也会打成 `preflight`。依赖的是普通 issue 时，普通运行和 preflight 都可以。

- bot 打 `preflight`，不打 `run`，两者互斥；其余和普通运行 issue 一样（子 issue、assignee、review）。parent 没有未关闭的依赖时，bot 按普通运行打 `run`。
- 可以开发、提 PR、请人 review；owner 的 `brief` 标出 parent 还在等哪些依赖，看板上 parent 显示为 Preflight 而不是 Blocked。合并仍由 owner 判断，一般等依赖关闭。
- parent 的依赖全部关闭（或被 `/undepend` 移除）时，bot 在同一次处理里把 `preflight` 换成 `run`（漏掉的由每天的定时同步补上），提醒作者对照结论核对 PR：有出入先改，改完重新打 `status:in-review`。
- 不要在 preflight 里替依赖做决定：它只是先把实现做出来，决策照样在依赖的 issue 里由 owner 拍板。parent 必须是未关闭的普通 issue，不能是另一个运行 issue，也不能是 `type:decision`（决策由 owner 在 issue 里拍板，不开运行）；不合法时 bot 在运行 issue 里提示，不打 label、不挂子 issue。parent 的 label 仍由 parent 的作者或 owner 决定，运行 issue 的作者只在自己的运行 issue 里汇报。

## 依赖和总事项

两种关系，用法不同：

| 关系 | 含义 | 怎么写 | 存在哪 |
|---|---|---|---|
| 依赖 | 本 issue 要等 #13 完成才能做完 | 打开时正文写一行 `依赖：#13 #14`；之后用 `/depend #13`、`/undepend #13` | GitHub 原生的 issue 依赖（Relationships 里的 blocked by） |
| 总事项 | 本 issue 是 #11 的一部分 | 正文写一行 `总事项：#11`（也认"关联总事项 #11"这样的写法），随时可以编辑正文修改 | 只在正文里，`brief` 读它画树 |

- **依赖**：网页上手动改依赖不会被撤销，以 GitHub 上的为准。被阻塞不打 label：有未关闭的依赖就是被阻塞，`brief` 在行尾标"等待 #13 #14"，看板显示 Blocked。依赖关闭（带总结）时，bot 在每个依赖它、还没关闭的 issue 下评论，说明剩下还在等谁，或者"依赖都已完成，可以开始"。在被阻塞的 issue 上开运行 issue 不会被拦，bot 会在运行 issue 里提醒还有哪些依赖没完成；要在依赖未决时先做整块开发，开 preflight（见第 4 条）。
- **总事项**：`brief` 把子事项挂在总事项下面，运行 issue 挂在它的 parent 下面，画成树；只在同一组里挂，所属的 issue 在别的组时，在行尾标出"总事项 #11"或"运行 → #11"。总事项不用 sub-issue 表达，sub-issue 只用来挂运行 issue。
- **拆分**和这两者不同：一件事分给多人做，用 `/assign` 和运行 issue（第 4 条）。

## 决策的生命周期

决策 issue 只负责把决定做出来、记下来。落地（ADR、记忆 PR、实现）都由依赖它的 task 承接，决策 issue 不等它们完成。

1. **提出**：作者开 `type:decision`，打 `status:needs-owner`，正文列选项、依据、代价。讨论和调研都评论在决策 issue 里。
2. **拍板**：owner 在 issue 里写下结论，`/label status:needs-author` 交回作者。owner 需要先看 ADR 草稿再拍板时，草稿由依赖本决策的 ADR task 在 preflight 里起草（见下表）。
3. **关闭**：结论写下后，作者按第 5 条写总结并关闭，不等 ADR 合并，也不等实现完成。总结写明结论、理由、被否定的方案，以及承接落地的 issue 编号；需要承接、但还没有对应 issue 的，关闭前先开好，让它依赖本决策。
4. **转入落地**：决策关闭后，bot 在依赖它的 issue 下提醒，并把依赖都已关闭的 parent 下的 `preflight` 运行换成 `run`。各运行的作者对照结论核对已有的草稿和 PR，有出入先改，再重新打 `status:in-review`。

承接的 issue 都依赖决策（`依赖：#N` 或 `/depend #N`），决策关闭前它们的运行都是 preflight，关闭后转为 run：

| 承接方 | 决策关闭前（preflight） | 决策关闭后（run） |
|---|---|---|
| ADR task（`repo:specs`），落地属于 Ora 产品架构的结论 | 起草 ADR，开 specs PR 供 owner 拍板参考；PR 不合并 | 按结论修改 ADR，标为 `approved`，review 后由 owner 合并 |
| 实现 task | 先开发、提 PR、请人 review；PR 一般不合并 | 对照结论（和已合并的 ADR）核对 PR，review 后由 owner 合并 |

- 实现要以 ADR 为准时，实现 task 同时 `/depend` ADR task，ADR 合并、ADR task 关闭后实现的运行才转为 run。ADR 和实现属于同一个 task 时，不拆成两个 task，按[三个运行](#开发产品仓库)在同一个 parent 下推进。
- 不要反过来让决策依赖 ADR task 或实现 task，也不要等 ADR 合并再关闭决策：ADR task 依赖决策，决策又等 ADR 合并，两边会互相卡住。
- 结论长期成立、属于协作方式的，开记忆 PR，链接写进决策的总结。

## 5. 关闭前先总结

关闭的 issue 要能被以后的搜索用上，所以每个 issue 关闭前：

1. `node scripts/cli.ts show N` 把整个 issue（正文和全部评论）读一遍。
2. 改标题：让标题直接说出结果，而不是最初的问题。
3. 用中文写详细总结：结论、做了什么（链接 PR/commit）、被否定的方案及原因、遗留问题（另开的 issue 编号）。
4. `node scripts/cli.ts close N --title "<新标题>" --summary-file <文件>`：总结写进正文最前面的 `## 总结` 一节，原正文保留在分隔线下，然后关闭。放弃的事项加 `--not-planned`。`--body-file` / `--summary-file` 读 UTF-8；在 Windows PowerShell 上不要用管道把中文喂给 `-`（会变成 `?`），见 `memory/preferences/powershell-utf8-gh.md`。
5. 关闭后 `close` 自动清理你为这个 issue 做的本地工作（`--keep-local` 跳过；`cleanup N --dry-run` 可以先预览）。只清理同时满足下列条件的：
   - 引用这个 issue 的 PR，由你的 fork 提出，已合并或已关闭；别人的 PR 不看也不碰；
   - 本地有同名分支，分支上的提交全部在 PR 的 head 里（没推上去的提交会被保留）；
   - 它的 worktree 在 `.worktrees/` 下，没有未提交的改动或未跟踪的文件；分支不在主目录检出。

   删除 worktree 和本地分支，不动 fork 上的远程分支。任何一条不满足就保留并说明原因，由你自己判断。

没有 `## 总结` 就关闭的 issue，bot 会重新打开并提示。

**只有作者关闭自己的 issue**，owner 也不例外：别人的 issue 做完了（比如它的 PR 已合并），在 issue 里提醒作者收尾。`brief` 最上面的"待关闭"组就是在提醒作者收尾。确需代关时（作者离开、事项作废），用 `close --for-author "<理由>"`，总结第一行会记下"由 @你 代作者 @作者 关闭：理由"。不是作者关闭、总结第一行又没有这一句的，bot 会重新打开并 @ 作者。

## 6. 接收新需求和 bug

用户说要加一个功能或修一个 bug 时：

1. **问几个必要的问题，只问必要的。** 标准是：问完之后能独立去调研，不用再回来问。已经能从代码、文档、已有 issue 查到的，不问。
2. **查重**：`gh issue list -R ora-space/circus --search "<关键词>" --state all`。命中就在那个 issue 评论补充，不另开。
3. **用中文重新组织语言**写成 issue 标题和正文（不照抄原话）：标题说清楚要什么；正文写背景、目标或复现步骤、验收条件。然后 `node scripts/cli.ts new`。
4. **开始调研**，把所有发现和思考评论到 issue：读了哪些代码和文档、结论、考虑过的方案和取舍、还没想清楚的点。调研过程留在 issue 里，而不是只留在对话里。

## 查阅前同步

每个会话首次查阅某个 `ora-space/<repo>` 的代码或文档前，先同步该仓库；跨仓库调研时逐个执行，specs 也一样。收到 PR 更新或要依据最新代码重新判断时，再次拉取并确认版本。

1. **确定目标版本**：默认查 upstream 最新 `main`；用户指定 PR、分支、tag 或 commit 时，查指定版本。先检查仓库的 remote、当前分支、HEAD 和工作区状态，确认 upstream 指向 `ora-space/<repo>`（remote 名可以不同）。仓库尚未 clone 时，从对应 upstream 获取代码。
2. **拉取目标**：默认执行 `git -C ora-space/<repo> fetch upstream main`；指定其他版本时拉取对应 ref，PR 用其最新 head。`node scripts/cli.ts sync` 只更新 circus；`worktree` 命令会拉取产品仓库 upstream/main，但不会把母库本地 main 的工作目录更新到最新。
3. **从已确认的版本读取**：默认以刚拉取的 `upstream/main` 为准。可以用 `git show upstream/main:<path>` 读取；需要目录搜索时，在干净的本地 main 上执行 `git merge --ff-only upstream/main` 后读取，或使用指向目标 commit 的独立 worktree。fetch 成功不代表当前工作目录已经更新；从工作目录读取前核对实际 HEAD 与目标 commit；用 `git show` 时核对所用 ref 的 commit。指定 PR 时以最新 head SHA 为准，历史 tag/commit 保持用户指定的版本。
4. **保留本地工作**：已有开发分支和未提交改动保持原样，不为查阅执行 reset、clean、自动 stash 或强制切换。需要分析本地改动时，将它们与 upstream 基线区分。无法快进或工作区不干净时，改用 `git show` 或独立 worktree 读取目标版本。
5. **交代依据**：结论中注明所依据的仓库、ref 和 commit SHA；跨仓库分别注明。拉取失败时告诉用户原因和当前可用的本地版本，将结论标为基于本地快照，不能把它表述为最新代码。

完成标准：目标 ref 已成功拉取，且实际读取的内容对应已确认的 commit；同步失败时，已明确说明版本限制。

## 开发产品仓库

owner 没有另外指明时，按下面的方式工作。

**运行 issue**：产品仓库的每个 PR 都关联一个运行 issue，不直接关联普通 issue，自己负责的 issue 也一样。开发前先 `node scripts/cli.ts run N` 开运行 issue（第 4 条）；分支、`Refs`、PR 链接都用运行 issue 的编号。这样关联 PR 合并后 `brief` 提醒、关闭运行 issue 时 `close` 清理分支，都能找到这个 PR。

**目录**：产品仓库的 fork clone 放在 circus 目录下的 `ora-space/<repo>`（已在 `.gitignore` 里），origin 是自己的 fork，upstream 是 `ora-space/<repo>`。每项开发一个 worktree，放在 `ora-space/<repo>/.worktrees/` 下；这个目录写进 clone 的 `.git/info/exclude`，不改产品仓库的 `.gitignore`。

```text
circus/
  ora-space/
    desktop/                       fork clone，停在 main，不在这里直接开发
      .worktrees/
        42-startup-crash/          分支 fix/42-startup-crash
        43-tray-menu/              分支 feat/43-tray-menu
```

**命名**：

| 什么 | 规则 | 例子 |
|---|---|---|
| 分支 | `<type>/<issue>-<slug>` | `fix/42-startup-crash` |
| type | 和 commit 类型一致：feat、fix、refactor、perf、docs、test、chore、build、ci | |
| issue | 运行 issue 的编号，不是 parent | `42` |
| slug | 小写英文、数字，用 `-` 连接，2–5 个词，说清楚做什么 | `startup-crash` |
| worktree 目录 | 分支名去掉 `<type>/` | `.worktrees/42-startup-crash` |

同一个 issue 拆给多个 agent 时，每人有自己的运行 issue，分支编号自然不同。

**PR 只装交付物**：代码、测试、迁移，以及仓库约定长期维护的文档（specs 的 ADR、核心用例、领域词汇；各仓库 `docs/` 下的正式说明）。开发过程中的计划、进度、实现日志、调研笔记和验收流水账属于过程记录，写在运行 issue 里；它们一旦合入 main 就会和实现脱节，又被后来的人和 agent 当成依据。跨会话、跨人接力需要的笔记同样写在运行 issue 里，功能分支上也只提交交付物；这一条优先于产品仓库自己的约定（例如 cloud `plans/README.md` 允许在功能分支提交过程笔记）。

**ADR 状态跟着实现走**：specs 的 ADR 按 `proposed` → `approved` → `implemented` 推进（规则见 specs 的 `AGENTS.md`）。实现合并了 ADR 还停在 `approved`，后来的人和 agent 就分不清它是已经兑现的系统承诺，还是还没做的计划。所以产品仓库的 PR 描述要写明它和 ADR 的关系：

- 列出本 PR 实现的 ADR（specs 里的路径），逐份写明本 PR 合并后是否已全部实现。
- 全部实现的：产品 PR 合并前，由落地运行（见下文"三个运行"）在 specs 开 PR，把 ADR 改为 `implemented`，按最终实现同步正文（偏离 approved 决策的先在正文写明实际采用的决策和原因），链接写进产品 PR 描述和实现运行。一份 ADR 由多个 PR 或多个仓库实现时，由补齐最后一块的 PR 带上这份 specs PR。
- 只实现了一部分的：写明 ADR 仍为 `approved`、还差哪些、由哪个 issue 承接。
- 依据的 ADR 还是 `proposed`：决策没定，PR 先不合并，等 ADR 改为 `approved`。
- 不涉及 ADR 的，写一句"不涉及 ADR"，让 reviewer 和 owner 知道已经查过。

**三个运行**：一个 task 既要写或改 ADR、又要改产品仓库时，在同一个 parent 下按顺序开三个运行 issue，每个运行只带一类 PR：

| 运行 | PR | 合并时机 |
|---|---|---|
| 1. ADR | specs PR：ADR 从 `proposed` 评审到 `approved`，同时补核心测试用例 | owner 批准后合并 |
| 2. 实现 | 产品仓库 PR，描述写明 ADR 状态 | ADR 已合并为 `approved` 之后；开发可以和运行 1 并行 |
| 3. 落地 | specs PR：ADR 从 `approved` 改为 `implemented`，按最终实现同步正文和用例证据 | 运行 2 的 PR review 通过后开，产品 PR 合并后合并 |

每个运行的 PR 合并后，`brief` 分别提醒它的作者关闭；ADR 评审、实现 review 和落地同步各自留痕。运行 1 的 specs PR 只装 ADR 和核心用例：引用未合并代码的用例证据留到运行 3。

**步骤**：

1. 开运行 issue：`node scripts/cli.ts run N`。
2. 建 worktree：`node scripts/cli.ts worktree <repo> <branch>`。`ora-space/<repo>` 不存在时先 fork 并 clone；然后拉取 upstream 最新的 main，顺手把 fork 的 main 推到最新，再基于 `upstream/main` 建分支和 worktree。
3. 在 worktree 里开发、commit，阶段性成果及时 push 到 fork：`git push -u origin <branch>`。
4. 核对改动文件：`git diff --name-only upstream/main...HEAD` 列出的每个文件都是交付物；过程记录移到运行 issue 后从分支删除。
5. 开 PR 到 upstream：`gh pr create -R ora-space/<repo> --head <自己的 login>:<branch>`，描述写 `Refs ora-space/circus#<运行 issue>` 和 ADR 状态（见上文"ADR 状态跟着实现走"），PR 链接评论到运行 issue。补齐了实现的，review 通过后开落地运行，由它开把 ADR 改为 `implemented` 的 specs PR。
   PR 的 CI 失败时先看日志：代码的问题就修了再 push；超时、偶发失败这类和改动无关的，用 `node scripts/cli.ts rerun <运行 issue> <repo>#<PR>` 让 bot 重跑失败的 job（成员没有权限自己重跑，见"重跑产品仓库的 CI"），不要推空 commit 来触发。
6. 关闭实现运行前，确认 ADR 已经是该有的状态：要转 `implemented` 的，落地运行的 specs PR 已经开出；没转的在总结里写明由哪个 issue 承接。
7. PR 合并或关闭后，关闭运行 issue 时 `close` 会自动清理对应的 worktree 和本地分支（规则见"关闭前先总结"）；也可以单独运行 `node scripts/cli.ts cleanup <运行 issue>`。不要手动 `branch -D`，除非确认分支上没有没推上去的工作。

不在 `ora-space/<repo>` 的主目录里开发：它只停在 main，作为 worktree 的母库。

### demo

`ora-space/demo` 是为演示临时开发的小型 demo，和其余 ora-space 开发互不干扰。demo 相关的事项都挂 `demo` label，用 `repo:demo` 标明仓库：

- **label**：开 issue 时 `node scripts/cli.ts new --label demo --label repo:demo ...`（正文里 `demo` 只在 `Labels:` 行上才算），之后用 `/label demo`。运行 issue 不用自己打：bot 打开运行 issue 时从 parent 继承 `demo`；parent 后来 `/label demo` 或 `/unlabel demo`，bot 同步到它未关闭的运行 issue。正文写了"总事项：#N"、#N 挂着 `demo` 的 issue，打开时 bot 同样打上 `demo`。
- **标题**：demo 事项的标题一律写成 `[demo] xxxx`，运行 issue 写成 `运行：[demo] xxxx`。`run` 默认取"运行：<parent 标题>"，parent 标题带上前缀就自动符合；用 `run --title` 自拟标题，或关闭时用 `close --title` 改成结果标题，都要保留这个格式。
- **范围**：demo 只改 `ora-space/demo`。需要改 cloud、desktop 等产品仓库的，不放在 demo 事项下，按正常流程另开 issue。
- **不走 specs 流程**：不做 [specs 根决策门禁](../memory/rules/specs-root-decision-gate.md)，不写 ADR，不分三个运行；PR 描述写"demo，不涉及 specs"代替 ADR 状态。其余照旧：运行 issue、worktree、`Refs ora-space/circus#<运行 issue>`、PR 只装交付物、review 和合并。
- **送审附截图**：demo 运行打 `status:in-review` 时，同一条评论里必须附上界面截图，否则 bot 拒绝；push 新 commit 后重新送审，也要附上新 commit 的截图。reviewer 和 owner 对照截图检视，`review:lgtm` 照旧写明审过的 commit。截图写成 Markdown 图片（`![说明](https://...)`）或网页拖拽上传生成的图片：
  - 人在网页上拖拽上传，同一条评论写上 `/label status:in-review`；
  - agent 无法经 API 上传图片：把截图提交到自己 fork 上的独立分支（如 `screenshots/<运行 issue>`，不进 PR），用 `https://raw.githubusercontent.com/<login>/demo/<commit>/<文件>` 引用，再 `node scripts/cli.ts label <运行 issue> +status:in-review --body-file <写了图片的文件>`。

## Label 登记表

登记表在 [`lib/labels.ts`](lib/labels.ts)，`node scripts/cli.ts setup` 按它创建仓库 label。

| label | 含义 | 可由正文设置 | 互斥 |
|---|---|---|---|
| `type:task` `type:bug` `type:decision` `type:question` `type:idea` | 类型：需要动手的工作、缺陷、等 owner 拍板的决策、待调研或待澄清的问题、未决定做不做的建议 | ✓ | ✓ |
| `status:needs-owner` | 等 owner 回复、决策或授权 | ✓ | ✓ |
| `status:in-review` | PR 待 owner 审 | ✓ | ✓ |
| `status:needs-author` | owner 或 reviewer 已回复、决定或提出要求，等作者跟进 | ✓ | ✓ |
| `review:lgtm` | 别人审过运行 issue 的 PR，认为可以合并（见"review 运行 issue"）；作者重新打 `status:in-review` 或有人打 `status:needs-author` 时清除 | ✗ | ✓ |
| `priority:p0`–`p3` | 优先级：立即、高、中、低；不设就是没有优先级 | ✓ | ✓ |
| `repo:<name>` | 事项落在哪个 ora-space 仓库：desktop、specs、cluster、cloud、sandbox、marketplace、demo；跨仓库可打多个 | ✓ | ✗ |
| `demo` | 临时 demo 开发（见"[demo](#demo)"）：运行 issue 随 parent 继承，不走 specs 流程，送审要附界面截图 | 只在 `Labels:` 行 | ✗ |
| `run` | 运行 issue（正文首行 `Parent: #N`）。由 bot 管理：只在打开运行 issue 时由 bot 打上，命令不能增删 | ✗ | 与 `preflight` 互斥 |
| `preflight` | parent 依赖未完成时先做的运行 issue（正文首行 `Parent: #N (preflight)`）。由 bot 管理：打开时打上，parent 的依赖都关闭后换成 `run` | ✗ | 与 `run` 互斥 |

互斥的 label 族（每个 issue 至多一个值）在设置新值时自动替换旧值。

- **`type:decision` 有长期价值。** 决策 issue 关闭后，标题和 `## 总结` 写明结论和理由，以后要查"当初为什么这么定"，用 `gh issue list -R ora-space/circus --state closed --label type:decision --search "<关键词>"` 就能找到。所以凡是要 owner 拍板的，都开成 `type:decision`：正文列选项、依据、代价，同时打 `status:needs-owner`。决策 issue 不开运行；owner 写下结论后作者就关闭，ADR 和实现由依赖它的 issue 承接，这些 issue 在决策关闭前只能开 preflight（见"决策的生命周期"）。
- **status 只表示"球在谁手里"。** 其余状态不用 label：在做 = 有未关闭的运行 issue，完成 = issue 已关闭。issue 关闭时 bot 移除它的 `status:*` 和 `review:*`。
  - 等 owner 的事，作者给自己的 issue 打 `status:needs-owner`（PR 待审打 `status:in-review`）；运行 issue 的作者改不了 parent，就打在自己的运行 issue 上。
  - owner 回复、拍板或提出要求后，打 `/label status:needs-author`（reviewer 在别人的运行 issue 上也可以，见"review 运行 issue"），它会替换掉 `needs-owner` 或 `in-review`，作者的 `brief` 会把这个 issue 放进"等我跟进"。只是顺手评论、不需要作者动作时，直接 `/unlabel status:needs-owner`。
  - 作者跟进后 `/unlabel status:needs-author`，或者需要 owner 再看时改回 `status:needs-owner`。
  - 球传过来时，用 `node scripts/cli.ts updates N` 看对方上次之后说了什么：它以你上次发言为界，列出之后的评论、谁用斜杠命令改了状态、status 的完整轨迹。`brief` 在你负责的 issue 行尾标出"N 条新回复"（不算 bot 和纯斜杠命令）。

## CLI

`node scripts/cli.ts <command>`（Node ≥ 22.18，直接运行 TypeScript；依赖 `gh`）。`help` 列出全部用法。

| 命令 | 作用 |
|---|---|
| `sync` | 会话开始时运行：本地 `main` 和 fork 的 `main` 对齐 `ora-space/circus` |
| `whoami` | 当前账号是 owner 还是成员，也就是和 agent 对话的人 |
| `brief [--mine]` | 先说明身份，再列未关闭的 issue，分组，空组不显示：待关闭（我创建的，关联 PR 已合并、被 bot 重新打开过、或 parent 已关闭的运行 issue，最优先处理）；等我跟进（我创建的 `status:needs-author`）；等 owner 的（owner 看到所有人的 `status:needs-owner` 和 `status:in-review`，已 `review:lgtm` 的在前；成员只看到自己创建的 `status:needs-owner`）；需要 review（只有成员有：assign 给我的、`status:in-review` 的运行 issue）；其余我负责的；其他。每组画成树（总事项、运行 issue），按优先级排序，标出等待的依赖 |
| `new --title T [--label L]... [--depend N]... [--epic N] [--body-file F]` | 新建 issue；`--label`、`--depend` 写进正文，由 bot 打上、设为依赖；`--epic` 写"总事项：#N" |
| `run N [--preflight] [--title T] [--body-file F]` | 为 #N 开运行 issue；`--preflight` 在 #N 依赖未完成时先做。#N 是 `type:decision` 时拒绝，#N 依赖未关闭的决策时必须加 `--preflight` |
| `updates N [--all]` | 你上次发言之后的动静：别人的评论、斜杠命令、status 轨迹、引用的 PR、关闭和重新打开、有更新的运行 issue |
| `show N` | 完整输出 issue 和全部评论 |
| `label N [+]L... -L... [--sha C] [--body-file F]` | 评论 `/label`、`/unlabel`；`--sha` 在评论里写明审过的 commit，打 `review:lgtm` 时要带；`--body-file` 的内容写在同一条评论里，demo 运行送审时用它附截图 |
| `assign N [+]@U... -@U...` | 评论 `/assign`、`/unassign` |
| `depend N [+]#M... -#M...` | 评论 `/depend`、`/undepend` |
| `rerun N <repo>#<PR>...` | 在运行 issue 评论 `/rerun`，由 bot 重跑 PR 上失败的 CI（见"重跑产品仓库的 CI"） |
| `close N --title T --summary-file F [--not-planned] [--for-author R] [--keep-local]` | 改标题、写总结、关闭；只限作者，代关要写理由；关闭后清理本地工作 |
| `cleanup N [--dry-run]` | 清理为 #N 做的本地 worktree 和分支：只限自己 fork 提出、已结束、没有额外提交、worktree 干净的 PR 分支 |
| `worktree <repo> <type>/[<issue>-]<slug>` | 产品仓库：按需 fork 并 clone，基于最新 upstream main 建分支和 worktree |
| `memory` | 记忆索引 |
| `setup` | owner 用：按登记表创建 label |
| `bot` | 只在 GitHub Action 里运行 |
| `notify` | 本地只读观察指定 issue 状态并发送应用私聊；显式加载本地配置与凭据，首次建基线，不回补历史。见 [`notify/README.md`](notify/README.md) |

## 看板

[看板](https://github.com/orgs/ora-space/projects/4)（org Project，编号在 `circus.env` 的 `CIRCUS_PROJECT`）是 issue 的只读镜像，偶尔看看全局用，完全由 bot 维护，不需要人参与：bot 自己校正 Status 选项、创建 Priority 字段，每天定时全量同步一次所有未关闭的 issue。手动改的值不会写回 issue，下次同步时会被覆盖。运行 issue 不上看板。

| 看板 Status | 来自 |
|---|---|
| Done | issue 已关闭 |
| Needs Owner / In Review / Needs Author | `status:needs-owner` / `status:in-review` / `status:needs-author` |
| Blocked | 有未关闭的依赖 |
| Preflight | 有未关闭的依赖，同时有 preflight 运行在做 |
| Running | 有未关闭的运行 issue |
| Open | 其余 |

Priority 字段来自 `priority:*`。owner 的 `brief` 已经列出所有人在等 owner 的 issue（"等我处理"一组）；成员的 `brief` 只列自己创建的，全局情况看看板的 Needs Owner 和 In Review 两列。

## Bot

状态切换通知的配置键、默认设置、接收角色与完整转移条件见 [通知设置表](bot/notifications/README.md)，机器可读设置见 [notifications.json](bot/notifications/notifications.json)。通知模块接入后按该表判断必要动作；开启前完成渠道和人员映射验证。

[`.github/workflows/circus.yml`](../.github/workflows/circus.yml) 以 GitHub App 身份运行 `node scripts/cli.ts bot`（App 授权 circus 和有 PR CI 的产品仓库 desktop、cloud、marketplace，权限为 Issues 读写、Metadata 只读（查询仓库权限）、组织 Projects 读写（同步看板），以及 Actions 读写、Pull requests 只读（`/rerun`）；ID 在仓库变量 `CIRCUS_APP_ID`，私钥在 secret `CIRCUS_APP_PRIVATE_KEY`）。每次运行生成两个 token：处理事件的只限 circus；新评论时另生成一个只限上述产品仓库、只有 Actions 和 Pull requests 权限的，只用于 `/rerun`。产品仓库新增 PR CI 时，要把它加进 App 的安装范围和 workflow 里的 `repositories`。bot 忽略所有 Bot 账号触发的事件，所以自己的写入不会循环。PR 上的事件不处理。

| 事件 | 处理 |
|---|---|
| issue 打开 | 打上正文里写的 label、设上 `依赖：` 行里的依赖，总事项挂着 `demo` 时打上 `demo`，同步看板；运行 issue 另打 `run`，parent 挂着 `demo` 时也打 `demo`（parent 依赖未关闭的决策，或有未完成的依赖且首行标了 `(preflight)` 时打 `preflight`；parent 是 `type:decision` 时只留言、不打 label 不挂子 issue）、挂为 parent 的子 issue、作者不在 parent 的 assignee 里时补上，parent 还有未完成的依赖时提醒 |
| 手动打上 label | 撤销并留言；打开后一分钟内、且正文里写了的 label 除外（`gh issue create --label` 产生的事件），运行 issue 上与首行相符的 `run` 或 `preflight` 除外 |
| 手动移除 label | 恢复并留言 |
| 手动 assign / unassign | 撤销并留言 |
| issue 关闭 | 正文不以 `## 总结` 开头，或不是作者关闭、总结第一行又没写代关理由，就重新打开并留言；有总结时移除 `status:*` 和 `review:*`、同步看板为 Done，通知依赖它的 issue 并重新同步它们，依赖都已关闭的 issue 下的 `preflight` 换成 `run`；运行 issue 把总结评论到 parent，并重新同步 parent |
| issue 重新打开 | 同步看板，连同依赖它的 issue（运行 issue 同步它的 parent） |
| 每天定时 / 在 Actions 页面手动触发 | 遍历所有未关闭的 issue：依赖都已关闭的，把其下未关闭的 `preflight` 换成 `run`（补上事件处理时漏掉的）；再全量同步到看板 |
| 新评论 | 执行其中的斜杠命令（见权限表、"review 运行 issue"和"重跑产品仓库的 CI"）：parent 增删 `demo` 时同步到它未关闭的运行 issue，demo 运行打 `status:in-review` 时检查同一条评论里有没有截图；同步看板；发出者不是作者时查一次仓库权限 |

## 开发

```text
scripts/
  cli.ts            入口，注册各命令
  <command>/        每个子命令一个目录：index.ts 和 index.test.ts
  bot/              handle.ts 事件处理，github.ts 是 GitHub API 的端口
  lib/              共享：gh/git 调用、label 登记表、斜杠命令、总结格式、运行 issue、看板、测试替身
```

所有 GitHub 读写经过 `Context.gh`（命令）或 `GitHub` 端口（bot），测试用替身，不访问网络。`npm test` 跑全部测试，CI 在 [`.github/workflows/test.yml`](../.github/workflows/test.yml)。新增命令：建 `scripts/<command>/index.ts` 导出 `command`，在 `cli.ts` 注册，`cli.test.ts` 会检查两边一致。
