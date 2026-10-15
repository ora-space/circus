# 状态切换通知设置表

配套 [notifications.json](notifications.json)，每个配置路径对应一个具体转移或事件。这些字段由 circus 定义，不是 GitHub/飞书原生字段。bot 已接入配置与语义判断；生产默认直接发送，允许少量失败，不要求共享存储、不跨运行补发。总开关仍默认关闭，可通过 Actions Variable `CIRCUS_NOTIFICATIONS_ENABLED` 控制部署。应用私聊、本地持久验证和生产启用边界见 [notify 使用说明](../../notify/README.md)。

## 设置方式

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | false | 总开关 |
| `transport` | feishu-app | 应用私聊；不实现群 webhook |
| `ownerRecipients` | [] | 接收决策/审查通知的 owner GitHub login，不授予权限 |
| `initialStatus` | 见下表 | 创建时初始交接，独立于后续转移 |
| `statusTransitions` | 见矩阵 | open issue 具体前后状态 |
| `events` | 见事件表 | 25 个协作事件；3 个 PR 状态旧字段保留但停用 |

将单项改为 false 即关闭，缺项也关闭；不提供通配符和旧8类聚合开关。读取器须拒绝未知字段/事件/状态对、错误类型和未支持渠道；启用时验证 owner 名单、凭据及映射。设置经 PR 修改。

例如，只关闭依赖reopen，设置 `events.blocker_reopened=false`；最后依赖解除不受影响。只关闭决策转待审，设置 `statusTransitions["needs-owner->in-review"]=false`；其他来源的审查请求仍独立控制。

## 创建时初始交接

| 配置路径 | 默认 | 收件人 | 条件 |
|---|---|---|---|
| `initialStatus.needs-owner` | 开 | owner | 明确请求另一位owner决策 |
| `initialStatus.in-review` | 开 | owner；运行reviewer | 已明确交付待审 |
| `initialStatus.needs-author` | 关 | 作者 | 创建者就是作者，固定排除自通知 |

创建不另匹配none→目标状态，避免两个开关控制一次交接；初始none或分类标签静默。

## open issue 全部4×4交接转移

路径为 `statusTransitions["之前->之后"]`。none=无status。表中默认值均须再经过必要性过滤。

| 之前→之后 | none | needs-owner | in-review | needs-author |
|---|---|---|---|---|
| none | 关 | 开 | 开 | 开 |
| needs-owner | 关 | 关 | 开 | 开 |
| in-review | 关 | 开 | 关 | 开 |
| needs-author | 关 | 开 | 开 | 关 |

进入needs-owner通知owner；进入in-review通知owner及运行reviewer；进入needs-author通知作者。普通issue的assignee是参与者，运行assignee是reviewer，作者不能审自己的运行。

对角线为关闭：状态值不变时没有转移，明确的新请求由下表控制。退回none也关闭：撤标签不自动产生待办，不等于PR合并；真正恢复执行使用execution_resumed_after_handoff。当前设计中这7格不允许开启，读取器遇到true应报错；其他9格可分别控制。

状态发生变化只匹配对应状态对，不再匹配同状态请求事件，不能绕过已关闭的状态对。创建、关闭与重开使用各自事件条件，不误匹配普通交接转移。

## 具体事件逐项开关

完整路径为 `events.<键>`。“开”表示满足必要条件才通知。

| 键 | 默认 | 收件人 | 必要条件 |
|---|---|---|---|
| `owner_request_updated` | 开 | owner | needs-owner不变，明确提出新的决策请求 |
| `author_request_updated` | 开 | 作者 | needs-author不变，明确交回新的要求 |
| `review_requested_for_new_revision` | 开 | owner/reviewer | in-review不变，明确请求审查新PR/head版本 |
| `review_requested_again_same_revision` | 开 | owner/reviewer | in-review不变，同版本明确发起新一轮请求；原请求重放不算 |
| `participant_assigned` | 开 | 新增参与者 | 普通issue实际新增协作指派 |
| `reviewer_assigned_during_review` | 开 | 新增reviewer | 运行已待审时增加reviewer；预登记静默 |
| `participant_left` | 开 | 事项作者 | 参与者自行退出实际活动协作，需确认安排 |
| `reviewer_left_during_review` | 开 | 运行作者 | 活动reviewer自行退出，需确认安排；owner仍能审查 |
| `participant_removed` | 开 | 被移除参与者 | 他人移除已有活动执行待办的参与者 |
| `reviewer_removed_during_review` | 开 | 被移除reviewer | 他人移除已有活动审查待办的reviewer |
| `lgtm_added` | 开 | owner | 新增review:lgtm |
| `lgtm_withdrawn` | 开 | owner | 明确撤销lgtm；交接或关闭引起的清理不算 |
| `lgtm_invalidated_by_revision` | 开 | owner | 版本变化使已通知认可失效；不逐push催审 |
| `last_blocker_closed` | 开 | 实际等待执行者 | 最后未完成依赖合法关闭，包括运行issue |
| `last_blocker_removed` | 开 | 实际等待执行者 | 删除最后未完成依赖，包括/undepend与原生关系编辑 |
| `execution_resumed_after_handoff` | 开 | 实际等待执行者 | 依赖此前已解除，现结束交接等待后真正恢复执行 |
| `blocker_added` | 开 | 受影响active run作者 | 新增依赖改变执行前提 |
| `blocker_reopened` | 开 | 受影响active run作者 | 已完成依赖reopen影响执行 |
| `blocker_replaced` | 开 | 受影响active run作者 | 仍被阻塞时增加/更换依赖，确有新执行影响 |
| `issue_reopened` | 开 | 重新承担执行者 | 普通issue主动重开并恢复实际执行动作 |
| `run_reopened` | 开 | 重新承担执行者 | parent open，运行重开并恢复实际执行动作 |
| `parent_summary_invalidated_by_run_reopen` | 开 | parent作者 | run重开使已发收尾判断失效 |
| `run_reopened_with_closed_parent` | 开 | run作者 | parent closed，run重开需收尾 |
| `last_run_closed` | 开 | parent作者 | 最后run结束；parent open、无阻塞且无其他交接，可汇总 |
| `parent_closed_with_open_runs` | 开 | 未结束run作者 | parent合法关闭，运行需收尾 |
| `pr_merged` | 关（停用） | — | 合并人通过 issue 标签交接，不直接监听 PR 合并通知 |
| `review_pr_closed_without_merge` | 关（停用） | — | 有新处理动作时通过 issue 标签表达 |
| `review_pr_reference_removed` | 关（停用） | — | 有新处理动作时通过 issue 标签表达 |

这三个旧 PR 字段只允许 `false` 或省略，设 `true` 会报错，避免误以为开启后就有对应通知。PR/head 快照仅作为审查请求的版本证据，不因合并、关闭或编辑 PR 而直接发消息。合并后需要作者动作时，由合并人在关联 issue `/label status:needs-author`。

新版本请求、同版本新一轮请求与重放须用来源、请求标识、PR/head SHA区分，普通评论或重复命令不构成新请求。无法确认版本时不能丢弃合法明确的重新审查请求，须暴露判定限制。

last_blocker_closed与last_blocker_removed按原因互斥。仍等交接时先记录已解除依赖，结束等待后匹配execution_resumed_after_handoff。blocker_added表示无阻塞→有阻塞；已有阻塞时增加/更换依赖用blocker_replaced；因依赖重开用blocker_reopened，不叠加别的阻塞原因。

run重开可同时恢复执行及撤回parent旧收尾判断，两项分别控制。parent关闭也可能影响运行收尾和依赖执行，按不同真实动作分别匹配。先按开关过滤候选，再合并消息，不借别的事件恢复已关闭候选。

## 固定静默和过滤

不提供泛广播开关：普通创建与分类标签、普通评论及标题正文编辑、开始运行、作者兜底assign、预登记reviewer、无后续动作的完成、非最后run结束、中间依赖完成、违规关闭自动恢复、手工改动撤销、命令拒绝、看板同步。

1. 按合法成功命令及最终有效状态判断，不通知同评论中间切换。assign后unassign或移除再补回且无新动作静默；部分成功须保存可补偿结果。
2. 固定排除源业务操作者本人，bot代执行追溯到人，跨issue一样；账号与实际飞书接收身份双层去重。
3. 同人、同源、同目标issue合成一条；新增指派+进入待审只发一次审查邀请，但每个候选先分别应用开关。
4. 发送前复核，丢弃已处理/撤回/被新请求替代的待办。每次有效交接保留请求代次，即使新通知开关关闭或操作者就是收件人，也会使旧请求过时。lgtm因转needs-author、重新请求in-review或合法关闭被清理，不算明确撤销。
5. 主动重开仅恢复实际动作，不广播历史参与者。parent closed的run只收尾，不暗自重开parent。
6. 执行人员包含active run作者，没人承接时事项作者兜底；不向全部assignee泛通知，不要求停止不受影响工作。
7. 消息只含标题、原因、下一步动作、GitHub链接；评论中新任务通过status/assign明确交接，不猜测所有自然语言请求。

## 状态和送达契约

### 直接发送的覆盖边界

九种进入 needs-owner/in-review/needs-author 的不同状态转移均覆盖；对角线及退回 none 的七格固定静默。创建使用 initialStatus，不能混用 none→目标状态开关。同状态明确请求使用对应事件开关，不能把普通评论当新请求。配置仅决定是否允许通知，仍须满足真实事件、权限、角色和自通知条件。

下表列明全部 25 个事件的证据要求。直接发送只拥有本次前后快照；“需要历史”的项目不能仅因为开关 true 就保证生产触发，不为补齐表格猜测历史或广播。

| 事件键 | 直接发送的条件/边界 |
|---|---|
| owner_request_updated | 状态仍为 needs-owner，合法命令明确发起新请求 |
| author_request_updated | 状态仍为 needs-author，合法命令明确交回新请求 |
| review_requested_for_new_revision | 需要可确认的前后请求版本；无历史不能保证识别此前已推送的新版本 |
| review_requested_again_same_revision | 明确重新请求审查；无可确认的版本差异时使用此项，不声称已核实版本相同 |
| participant_assigned | 普通事项实际新增指派 |
| reviewer_assigned_during_review | 已待审执行任务实际新增 reviewer，作者不审自己 |
| participant_left | 活动协作者自行退出，提醒事项作者调整安排 |
| reviewer_left_during_review | 活动 reviewer 自行退出，提醒运行作者调整安排 |
| participant_removed | 他人撤回活动执行指派，提醒被撤回者 |
| reviewer_removed_during_review | 他人撤回活动审查指派，提醒被撤回者 |
| lgtm_added | 实际新增审查认可，提醒 owner |
| lgtm_withdrawn | 明确撤回审查认可；关闭/交接引起的自动清理静默 |
| lgtm_invalidated_by_revision | 需要此前已发认可记录和版本差异；直接模式不保证，持久模式可判定 |
| last_blocker_closed | 最后未完成依赖合法关闭，且当前无交接等待；关闭不等于工作完成 |
| last_blocker_removed | 最后未完成依赖关系移除，且当前无交接等待 |
| execution_resumed_after_handoff | 需要此前依赖等待记录；跨事件直接模式不保证，持久模式可判定 |
| blocker_added | active run 的执行前提由无依赖变为有依赖 |
| blocker_reopened | 依赖由关闭变为打开，影响 active run |
| blocker_replaced | 仍被阻塞时增加/更换依赖，影响 active run |
| issue_reopened | 普通事项合法重开且当前无交接/依赖等待，恢复实际执行 |
| run_reopened | parent open，执行任务合法重开且当前无交接/依赖等待 |
| parent_summary_invalidated_by_run_reopen | 需要此前已发收尾记录；直接模式不保证，持久模式可判定 |
| run_reopened_with_closed_parent | 执行任务重开，但 parent 已关闭；只提醒收尾 |
| last_run_closed | 最后 active run 关闭，parent open 且无交接/依赖等待；提醒汇总，不自动宣告完成 |
| parent_closed_with_open_runs | parent 合法关闭，提醒未关闭 run 的作者收尾 |

PR 合并/关闭/引用撤回的三个旧字段仍停用。不扩展第三方 Bot 或原生依赖编辑实时入口；当前生产入口是人的合法协议命令和事项生命周期事件。补发及跨运行去重不属于直接模式的可靠性承诺。

下面的持久历史、失败补发和跨事件失效判断适用于显式指定状态文件的可选持久模式。生产直接模式只处理本次真实业务事件，保留配置过滤、身份过滤、发送前复核和同次合并；没有历史时不发“撤回此前已发通知”类事件，不保证跨事件恢复/版本判断。通知失败只记日志，不影响业务。无需为直接模式另建共享存储、全仓基线或补偿任务。

保留生命周期、交接、作者/assignee、parent/运行集合及作者、未完成依赖集合、审查请求/证据及各PR状态。看板Done > status > Blocked > Running > Open只是投影，不能盖掉执行影响。依赖目标包括run，关闭/reopen也须处理直接依赖者。

持久保存来源、请求代次、最后明确请求的审查版本、有效待办和送达结果；补偿仅补缺失有效动作，不绕过关闭设置或全量广播。初始化建立基线，历史回补由owner确认。原生依赖、可信自动化结果须可靠来源或持久基线补偿；抑制自身label/comment回声。PR 交付后的通知复用正常 issue 标签交接。

应用私聊使用本地文件或后续 Actions secrets FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_RECIPIENTS_JSON（GitHub login→手机号或当前应用 open_id）；login忽略大小写。未绑定即未送达，暴露失败并支持补发，不退化群广播。已绑定操作者的身份查询失败时保留待发，不绕过同一飞书身份的自通知过滤。

通知失败不撤销业务写入，补发不重跑业务；看板失败不能丢通知。协调并发更新，凭据脱敏，检查HTTP及业务返回码。发送成功与本地记账间仍有崩溃窗口；持久记录和消息 UUID 用于尽力去重、定位失败与补发。

发送规范见[应用消息API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。
