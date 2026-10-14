# 状态切换通知设置表

本表定义通知配置键、接收角色和必要条件，供通知实现与后续配置使用。[notifications.json](notifications.json) 保存机器可读默认设置。当前 bot 尚未读取此配置；接通模块后，须完成渠道、人员映射与发送验证才能启用。

## 设置方式

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `false` | 总开关，准备好渠道与人员映射后开启 |
| `transport` | `feishu-webhook` | 群机器人 webhook；其他渠道须先实现对应发送器 |
| `ownerRecipients` | `[]` | 接收决策/审查通知的 owner GitHub login；不赋予协作权限 |
| `rules.<事件名>` | 见下表 | `true` 开启该类必要消息，`false` 关闭；未声明事件关闭 |

读取器应拒绝未知字段、事件、渠道和错误类型；开启时检查 owner 名单、渠道凭据及人员映射。路由按下表固定计算，开关不能绕过必要性和自通知过滤。配置通过 PR 修改。

## 必要通知设置表

分类默认值在总开关开启后生效。

| 配置键 | 默认 | 必要动作 | 接收人 | 限制 |
|---|---|---|---|---|
| `owner_action_requested` | 开 | 决策、回复、授权请求 | 配置的 owner | 初始或进入 needs-owner；同状态确有新请求 |
| `author_action_requested` | 开 | 跟进结论、修改；活动协作者退出需重新安排；待审 PR 未合并撤回需处理 | 对应 issue 作者 | 只针对实际待办，撤标签不等同新任务 |
| `review_requested` | 开 | 请求/重新请求审查；已待审运行新增 reviewer | owner；运行的 reviewer | 记录请求标识与 PR/head SHA；预登记 reviewer 等进入待审才通知；已待审新增只通知新增者 |
| `collaboration_requested` | 开 | 普通 issue 新增实际协作任务 | 新增参与者 | 仅 API 接受的新增指派，带阶段/依赖上下文，不误称立即开工 |
| `review_evidence_changed` | 开 | lgtm 新增、明确撤销；版本变化使已通知认可失效 | owner | 转作者修改/重新请求审查时合并消息；关闭清理静默 |
| `execution_readiness_changed` | 开 | 最后依赖解除、执行前提重新阻塞、重开恢复执行 | 受影响执行人员，包括 active run 作者；无人承接时事项作者兜底 | 只通知实际恢复或需检查前提的人，不广播历史参与者，不自动停止无关工作 |
| `summary_required` | 开 | PR 合并需检查交付并总结；最后运行结束需汇总；parent 关闭但运行未收尾 | 关联 issue 作者、parent 作者或未结束 run 作者 | 部分合并不代表全部完成；最后运行结束仅在 parent open、无阻塞、无其他交接时催汇总 |
| `active_work_withdrawn` | 开 | 撤销活动协作/审查任务；run 重开使已发收尾判断失效 | 原待办接收人 | 仅真实活动待办或必须撤回的已发判断；预登记移除与普通清理静默 |

普通 issue assignee 是参与者，运行 issue assignee 是 reviewer；作者不能审自己的运行。owner 名单只影响通知路由，权限仍按协作协议校验。

## 交接状态的全部 4×4 转移

仅针对 open issue。N=无 status，O=needs-owner，R=in-review，A=needs-author。矩阵生成候选动作，还须过滤与合并。

| 之前→之后 | N | O | R | A |
|---|---|---|---|---|
| N | 静默 | owner 决策 | owner/reviewer 审查 | 作者跟进 |
| O | 静默 | 无新请求静默 | 决策转审查 | 作者跟进结论 |
| R | 静默 | 决策/授权 | 新版本或明确重新审查；无新请求静默 | 作者修改 |
| A | 静默 | 再次决策 | 交回审查 | 无新请求静默 |

O→N 不意味着作者有新任务，R→N 不意味着 PR 合并。同状态可能是新审查或要求：来源事件、请求标识和 PR/head SHA 用于区分新请求与重放，不能只比较标签。无法确认版本时，不能静默丢弃合法明确的重新审查请求。

## 生命周期和协作关系转移

| 变化 | 判定 |
|---|---|
| 创建 N、普通分类标签 | 静默；初始 O/R/A 按交接矩阵，再排除创建者 |
| 合法关闭 | 不广播完成；只检查依赖影响和未结束运行收尾 |
| 违规关闭自动恢复、手工操作撤销、拒绝命令 | GitHub 保留校验反馈，不生成成功交接通知 |
| 主动重开 | 仅恢复真实执行/收尾动作，不通知全部历史参与者 |
| 第一个运行开始、作者兜底 assign | 静默 |
| 某运行结束，其他仍在做 | 默认静默，GitHub 汇报保留；新决策/审查通过状态表达 |
| 最后运行结束 | parent 可汇总时 summary_required，不宣称全部完成、不自动关闭 |
| parent 关闭、运行仍 open | 对 run 作者 summary_required，不继续催审这些运行 |
| run 重开、parent open | 恢复实际动作；已发 parent 收尾判断失效时 active_work_withdrawn |
| run 重开、parent closed | 仅 run 收尾，不暗自重开 parent |
| 普通事项新增指派 | collaboration_requested；运行预登记 reviewer 静默，进入 R 才 review_requested |
| 自己退出协作 | 不通知退出者；确有活动协作时通知作者确认剩余安排。最后 reviewer 退出不妨碍 owner 审查 |
| 移除他人 | 对实际执行/审查待办发 active_work_withdrawn；预登记移除静默 |
| 新增/明确撤销 lgtm | review_evidence_changed；转 A/重新 R 合并，关闭清理静默 |
| PR 合并 | summary_required，只说明当前合并项，不将多 PR 部分合并视为全部完成 |
| 未合并关闭 PR、撤回待审引用 | 作者需处理时 author_action_requested；撤销已发审查请求时 active_work_withdrawn |
| PR head 更新 | 已通知认可失效时 review_evidence_changed；新审查须明确请求，不逐 push 催审 |

## 依赖子状态机

保留未完成依赖集合、运行集合及作者。看板 `Done > status > Blocked > Running > Open` 只是投影，status 不能盖掉真实执行影响。

| 未完成依赖变化 | 判定 |
|---|---|
| 多个→仍有 | 中间完成默认静默 |
| 最后一个→无 | 实际恢复执行时通知；覆盖合法关闭、/undepend、原生依赖编辑 |
| 无→有，包括依赖 reopen | 存在受影响 active run 时提醒作者检查前提，不自动停止所有工作 |
| 有→有，增加/替换 | 默认静默，仅新增真实执行影响时通知 |
| 添加已关闭依赖、重复删除 | 无实际阻塞变化，静默 |
| 违规关闭后自动恢复 | 不先发「可以开始」，等合法结果 |
| 被阻塞事项 closed | 不催恢复；parent closed 的 run 只走收尾 |

O/R/A 仍生效时，解除依赖通常只更新上下文；交接结束并确实恢复执行后再判定。依赖目标包含运行 issue，关闭/reopen 都要处理直接依赖者。

## 固定过滤与送达要求

1. 按执行前状态、成功命令和最终有效状态计算动作，不通知同评论中间状态；部分成功也要保留可补偿结果。
2. 排除源业务操作者本人，bot 代执行追溯到人，跨 issue 一样；自己创建、标记、认领、合并及完成依赖不回发。
3. GitHub 账号与飞书接收身份双层去重；同人、同源、同目标 issue 合成一条。新增指派+R 只发一次审查邀请。
4. 同评论 assign 后 unassign、移除再补回且无新动作，静默。普通评论、标题正文编辑、type/repo/priority、运行开始、看板同步不广播。
5. 发送前复核动作，丢弃已处理/撤回的过时请求；仅继续执行有成本或风险时补撤销提示。
6. 持久记录来源、请求版本、有效待办及送达状态，补偿只补缺失有效动作。初始化建立基线；历史待办回补由 owner 确认。
7. 未绑定人员属于未送达，要暴露失败并支持补发，不假装 @ 成功、不退化成 @all。通知失败不撤销业务写入，补发不重跑业务；看板失败不能丢通知。

消息包含标题、原因、下一步动作和 GitHub 链接。普通评论的新任务必须用 status/assign 明确交接，不推断所有自然语言请求。

## 渠道和实现接口

群 webhook 使用 Actions secrets `FEISHU_WEBHOOK_URL`、`FEISHU_SIGNING_SECRET`、`FEISHU_RECIPIENTS_JSON`（GitHub login→飞书 ID，注明类型）；login 匹配忽略大小写，外部群使用有效 open_id。应用私聊需接入对应发送器、权限/可用范围、凭据和 token 管理。

通知判断器输入包括生命周期、交接、作者/assignee、parent/运行、未完成依赖、审查请求/证据和各关联 PR 状态；输出带来源与请求版本的人员动作。产品 PR 和原生依赖变更须有完整事件来源或持久基线补偿。只抑制自身 label/comment 回声，可信其他自动化的真实业务结果也要覆盖。

协调并发状态更新和共享 webhook 限速，密钥脱敏，同时检查 HTTP 与业务返回码，配置错误不盲目重试。webhook 超时可能已发送成功，不能保证严格一次送达；持久记录用于尽力去重、定位失败和补发。

飞书能力与发送规范见[自定义机器人指南](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)及[应用消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。
