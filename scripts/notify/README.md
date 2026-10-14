# 本地飞书通知与 bot 接入

`bot` 在成功业务变更前后采集协作状态，按 [逐项通知设置](../bot/notifications/README.md) 生成待办并持久保存，再发送飞书应用私聊。配置开关在收件人合并之前应用；操作者及其映射到同一飞书身份的账号均排除。失败后重试通知层，不重新执行 GitHub 操作。

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

`--with-prs` 从 GitHub issue timeline 中的真实 PR 引用读取对应 PR 对象及 head；产品 PR 必须明确引用 circus 事项，不能以“已合并”普通评论当合并事实。原生依赖编辑使用 GraphQL 依赖事件，依赖合法关闭与重开按直接依赖者处理。缺少可靠操作者来源时不猜测。轮询只能观察两次检查之间的最终快照，短时间内发生又恢复的中间动作可能无法重建；准确逐源处理应使用部署后的 `bot` 源事件入口。

如果 GitHub API 临时失败，命令会退出并释放状态锁；使用同一 state 文件重新运行即可。`--watch` 长期运行需要正常停止；若进程被强行结束留下 `.lock`，确认没有进程使用该文件后再移除锁。

## 可重复的本人真实发送验证

```powershell
node scripts/notify/smoke.ts --config-file .tmp/notifications.local.json --credentials-file .tmp/feishu-test.json --recipients-file .tmp/feishu-recipients.json --recipient github-login --issue 104
```

该入口明确模拟一条 owner→作者的合法 `none→needs-author` 交接，使用真实 `handle`、配置、持久队列、手机号查询与飞书发送器。只允许映射中有唯一明确收件人。消息标题说明“模拟交接”，不修改真实 GitHub issue。还验证事件重放、自通知、关闭状态对静默；用相同状态文件再次运行不会重发已送达消息。

## 状态、补发及版本

状态文件包含事项快照、源事件标识、待发候选、投递状态与尝试次数，不包含飞书凭据、手机号或 token。原子替换与独占锁防止本地并发写；发送前保存 pending，成功后保存 sent。网络失败保留 pending，下次复核状态及开关后补发；已经处理、移除 reviewer、关闭 parent、撤销引用等使旧动作过时的变化会丢弃旧请求。

同人同来源同事项合并，多个 GitHub 账号映射到同一飞书身份时继续去重。发送使用稳定 UUID；本地 sent 记录跨重启保留。发送成功与本地记账之间仍有崩溃窗口，飞书 UUID 去重也有服务端时限，不承诺分布式严格一次送达。

明确重新 `/label status:in-review` 作为新一轮请求，区分当前 PR/head 与此前已记录的版本；无 PR/version 证据时按“同版本明确重新请求”处理，不丢弃合法请求。普通评论不构成新请求。只读观察器需要 bot 成功回应才能追溯同状态请求；部分成功且无 👍 的命令应由部署后的源事件观察入口记录。

当前阶段不部署产品仓库的额外 PR 监听；合并后的 circus 协议交接仍通过其状态变化通知。未合并关闭、撤回引用或普通 push 若缺少可验证的操作者来源，不推测最后评论者作为操作者；PR 源事件/可信补偿与历史回补策略仍须在生产启用时确认。

## 下一阶段：Actions

本地验证通过后再设置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_RECIPIENTS_JSON`，在 workflow 显式注入 env，并选择启用 `feishu-app`。本轮不上传这些值、不启用 upstream 通知。

启用 `bot` 必须指定 `CIRCUS_NOTIFICATION_STATE` 或 `--state-file`，且文件必须放在跨运行保留的存储中；GitHub hosted runner 每次清空，不能仅在 runner 上留下 JSON 就宣称生产持久化。上线还需要 owner 决定共享存储/补偿任务、workflow 串行策略及可信自动化来源。没有这些条件，保持总开关关闭。

```text
node scripts/cli.ts bot --config-file <启用配置> --credentials-file <本地凭据> --recipients-file <本地映射> --state-file <持久状态>
```

只有 `bot` 在 GitHub Action 上以 App 的真实权限执行业务写入；本地 `notify` 与 smoke 分别承担只读真实观察和模拟事件验证。
