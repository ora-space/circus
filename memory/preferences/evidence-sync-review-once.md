---
summary: 证据同步类 task（持续把验收证据补进 specs 核心用例的 PR）不按批送审，彻底做完后一次性打 status:in-review。
scope: ora-space
---

# 证据同步类 task 做完再一次性送审

持续把验收证据同步到 specs 核心用例的 task（例如 #504），证据都补进同一个 PR，不每补一批就打 `status:in-review`。

满足以下两条后再一次性送审：

- "尚缺"的每一项要么有了直接证据，要么已明确写为剩余缺口，并写清由谁承接、不再等本 task 补。
- PR 描述和用例同步到最终状态，head 固定。

在此之前不打 `status:in-review` / `status:needs-owner`。需要 owner 拍板的事单独在 issue 里提，不和送审混在一起。
