# 本地飞书通知与 bot 接入

`bot` 在业务变更前后采集协作状态，按 [逐项通知设置](../bot/notifications/README.md) 生成通知并发送飞书应用私聊。生产默认采用直接发送：只在当前 Action 内暂存候选，不要求共享存储，允许少量通知失败，不跨运行补发。配置开关在收件人合并之前应用；操作者及其映射到同一飞书身份的账号均排除。通知配置、状态采集或发送失败记录日志，不阻止正常 GitHub 业务操作；业务操作本身失败仍使 Action 失败。

`notify` 是本地只读观察器：在 upstream circus 已运行的 bot 改完真实状态之后，比较本地基线，验证操作者来源，再使用相同规则、队列和发送器。它不执行评论里的斜杠命令，不改 label，不模拟 owner 权限。生产 `bot` 路径使用源事件中的真实 sender；本地观察器使用 GitHub timeline 与同一 bot 的 👍 回应追溯合法命令，不能确认来源时保留基线并提示重试。

## 本地配置

全部放到已被 Git 忽略的 `.tmp`。仓库默认配置保持 `enabled:false`，不要为本地测试修改它。

- `feishu-test.json`：`app_id`、`app_secret`。已有本地测试中的其他字段不影响凭据读取。
- `feishu-recipients.json`：GitHub login 到手机号或 open_id 的映射，忽略 login 大小写，每人只选择一种标识。
- `notifications.local.json`：复制仓库 `notifications.json`，改 `enabled:true`、`transport:"feishu-app"`。按需要填写真实 owner 的 `ownerRecipients`；此名单只控制通知，不改变权限。名单为空时没有 owner 收件人，作者和协作者路由仍可验证。

```json
{
  "github-login": { "mobile": "+8613800000000" }
}
```

手机号查询需要已发布的 `contact:user.id:readonly`，发送需要 `im:message:send_as_bot` 和有效的应用可用范围。open_id 必须属于当前应用。人员查询只发生在本次实际需要通知的人员上，同次运行复用查询结果和 token。查询失败是未送达，不降级群广播；错误只输出阶段及错误码，不输出请求、服务端原始响应、手机号或凭据。

## 观察真实状态

```powershell
node scripts/cli.ts notify --issue 95 --issue 104 --config-file .tmp/notifications.local.json --credentials-file .tmp/feishu-test.json --recipients-file .tmp/feishu-recipients.json --state-file .tmp/notification-live-state.json --watch
```

省略 `--watch` 只检查一次。首次建立基线，不回补历史待办；重复运行同一来源事件不重复发送。观察范围包含指定事项的 parent、子运行和直接依赖者。运行开始后请通过另一位有权限的人的正常协议操作产生交接；自己操作依然不会通知自己。不要为了测试关闭此过滤。

`--with-prs` 仅读取真实 PR 引用和 head 以区分审查请求版本，不根据 PR 状态直接发通知。合并人通过关联 issue 标签交回作者即可。原生依赖编辑使用 GraphQL 依赖事件，依赖合法关闭与重开按直接依赖者处理。缺少可靠操作者来源时不猜测；状态交接只选择与该变化对应且被 bot 确认的评论，不使用后续无关评论。轮询只能观察两次检查之间的最终快照，短时间内发生又恢复的中间动作可能无法重建；准确逐源处理应使用部署后的 `bot` 源事件入口。

如果 GitHub API 临时失败，命令会退出并释放状态锁；使用同一 state 文件重新运行即可。`--watch` 长期运行需要正常停止；若进程被强行结束留下 `.lock`，确认没有进程使用该文件后再移除锁。

## 可重复的本人真实发送验证

```powershell
node scripts/notify/smoke.ts --config-file .tmp/notifications.local.json --credentials-file .tmp/feishu-test.json --recipients-file .tmp/feishu-recipients.json --recipient github-login --issue 104
```

该入口明确模拟一条 owner→作者的合法 `none→needs-author` 交接，使用真实 `handle`、配置、持久队列、手机号查询与飞书发送器。只允许映射中有唯一明确收件人。消息标题说明“模拟交接”，不修改真实 GitHub issue。还验证事件重放、自通知、关闭状态对静默；用相同状态文件再次运行不会重发已送达消息。

## 状态、补发及版本

状态文件包含事项快照、源事件标识、交接请求代次、最后明确请求的审查版本、待发候选、投递状态与尝试次数，不包含飞书凭据、手机号或 token。状态格式升级到 v2，旧 v1 文件自动迁移并保留送达历史。原子替换与独占锁防止本地并发写；发送前保存 pending，成功后保存 sent。网络失败保留 pending，下次复核状态、请求代次、收件人路由和开关后补发；新请求替代旧请求、移除 reviewer、关闭 parent 等使旧动作过时的变化会丢弃旧请求。

作者/owner 的交接请求不依赖 PR head；不会因无关 PR 变化而丢弃。待审消息的已记录版本无法复核时保留待发，不把查询失败当作版本失效。开关关闭、角色移除或请求已被替代时优先丢弃，不因 PR 查询失败而阻止取消。操作者已有人员映射但查询暂时失败时同样保留待发，不能跳过同一飞书身份过滤。

同人同来源同事项合并，多个 GitHub 账号映射到同一飞书身份时继续去重。发送使用稳定 UUID；本地 sent 记录跨重启保留。发送成功与本地记账之间仍有崩溃窗口，飞书 UUID 去重也有服务端时限，不承诺分布式严格一次送达。

明确重新 `/label status:in-review` 作为新一轮请求，区分当前 PR/head 与此前已记录的版本；无 PR/version 证据时按“同版本明确重新请求”处理，不丢弃合法请求。普通评论不构成新请求。只读观察器需要 bot 成功回应才能追溯同状态请求；部分成功且无 👍 的命令应由部署后的源事件观察入口记录。

不部署产品仓库额外 PR 监听，不根据 PR 合并/关闭/引用撤回发送通知。所有 PR 后续动作通过 circus 协议的状态交接表达。普通 push 不自动催审，新审查通过明确请求表达，并与最后一次请求版本比较；历史回补策略仍须在生产启用时确认。

## Actions 上线：直接发送

### 私聊消息

消息使用现有文本 API，无需增加飞书权限或改机器人配置。按“提醒类型、事项与当前状态、发生了什么、你需要做什么、事项/交接链接”排版；状态变更按实际前后状态说明“等待审查→等待作者跟进”等交接，正文直接说明谁需要你 review、决策或跟进，不单列发起人。初始创建说明初始状态，同状态明确请求说明“状态仍为…，发起新一轮请求”，不虚构状态转移。执行任务用中文名称，不展示内部 label、规则键或状态代号；具体修改要求仍以 GitHub 交接记录为准。

例如作者交接：

```text
【需要你跟进】Circus
事项：#95 飞书通知
当前状态：等待作者跟进

发生了什么
• 状态由「等待审查」变为「等待作者跟进」；@github-login需要你继续处理此事项。

你需要做
• 查看本轮审查意见，处理需要修改或回复的内容，并反馈结果。

查看事项：
https://github.com/ora-space/circus/issues/95
查看相关交接：
https://github.com/ora-space/circus/issues/95#issuecomment-...
```

同次合并消息会去重描述和动作；参与邀请与审查请求同时发生时只保留审查动作。依赖完成与仅移除依赖关系用不同措辞，不把“解除依赖”写成“工作完成”。

### 上线设置

仓库 [circus workflow](../../.github/workflows/circus.yml) 注入下面三个 Repository Secrets；不需要额外存储或 self-hosted runner。

| 名称 | 值 |
|---|---|
| `FEISHU_APP_ID` | 飞书 App ID 原文，不包 JSON、不加引号 |
| `FEISHU_APP_SECRET` | 飞书 App Secret 原文，不包 JSON、不加引号 |
| `FEISHU_RECIPIENTS_JSON` | 上述 GitHub login → mobile/open_id 映射的完整 JSON 对象 |

这些值与 GitHub App 的 `CIRCUS_APP_ID`、`CIRCUS_APP_PRIVATE_KEY` 不同；不保存 tenant_access_token。设置入口为 upstream 仓库 Settings → Secrets and variables → Actions。

合并代码并填好 Secrets 后，在 Repository Variables 设置 `CIRCUS_NOTIFICATIONS_ENABLED=true` 开启生产通知，`false` 立即关闭后续运行。这个部署开关覆盖 JSON 的 enabled；未设置或为空时使用 JSON 值。其他逐项开关、渠道、ownerRecipients 仍按仓库配置，不从事件 payload 接受覆盖。ownerRecipients 是实际要接收 owner 通知的 GitHub login；个人映射不授予权限，名单为空时仍能发送作者/协作者通知。

正常入口仅接受现有协议中的人发出的 issue 评论命令、创建、合法关闭及重开。使用 GitHub Actions 的真实事件和现有授权判断，无需新接 webhook。Bot 回声、手工改 label 的撤销和普通评论不触发飞书。PR 合并后由合并人在 issue 发 `/label status:needs-author`，不直接发 PR 通知。

验收请另一位有权限的 owner/reviewer 给映射中的作者交接，确认只收到必要私聊；本人操作仍固定排除。失败在 Action 日志中可见，不保证送达，不定期扫描/回补历史，不因通知失败重新执行斜杠命令。不要重跑整个 Action 作为补发方式。

workflow 使用相同 concurrency group 串行执行业务，并设置 `queue:max` 保留最多 100 个待运行任务；超过上限的事件或平台未投递的事件可能漏通知。稳定消息 UUID 保留，但无跨运行账本，不承诺消除所有重复。运行之间发生的撤回无法取消已经发出的聊天消息。

没有持久历史时，依赖“此前已发收尾/认可”的撤回事件不发；跨事件延后恢复执行、与上次明确审查版本比较等历史判定也不保证。原生依赖编辑和第三方自动化没有新增实时入口；需要此类变更时使用 `/depend`、`/undepend` 及人的协议交接。当前直接模式保障的是现有真实业务事件可判定的即时动作，尤其是作者重新被需要的状态交接。

## 可选：本地持久观察/补发

以上本地 `notify` 和 smoke 仍使用文件状态以方便验证。`bot` 若显式传 `--state-file` 或 `CIRCUS_NOTIFICATION_STATE`，仍使用文件持久队列及失败重试模式；这是可选能力，不是直接发送上线前提。只有选择该模式才需要跨运行持久存储。前面“状态、补发及版本”一节的跨运行保证仅适用于持久模式。

只有 `bot` 在 GitHub Action 上以 App 的真实权限执行业务写入；本地 `notify` 与 smoke 分别承担只读真实观察和模拟事件验证。
