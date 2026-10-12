# 记忆

这里只放**稳定**的东西：owner 怎么判断、希望怎么协作、可复用的方法。会随进展变化的内容（TODO、进度、分工、待决问题、讨论记录）放 issue。

判断一条内容放哪：**一个月后没人改它，它还对吗？** 对 → 记忆；不一定 → issue。

## 目录

目录决定权重，冲突时靠前的优先；与 owner 当前的明确指令冲突时，指出冲突，由 owner 决定。

| 目录 | 放什么 | 用法 |
|---|---|---|
| `rules/` | 硬约束、禁忌 | 必须遵守；要违反时先停下问 owner |
| `methods/` | owner 认可的工作方法 | 任务相关时照做 |
| `preferences/` | 协作与产出的偏好 | 影响做法和形式，不覆盖事实 |

只有一级目录。产品架构决策的权威是 [ora-space/specs](https://github.com/ora-space/specs) 的 ADR，记忆只链接，不复述。

## 文件格式

```markdown
---
summary: 一句话：是什么，什么时候该读
scope: ora-space      # 适用范围：all、ora-space，或具体仓库名如 desktop
---

# 标题
正文
```

`node scripts/cli.ts memory` 从 `summary` 和 `scope` 生成索引，所以不维护 INDEX 文件。时间、作者和来由看 git 历史和 PR。

## 修改

记忆只经 circus 的 PR 修改，打 `memory` label，owner 合并即确认。一个 PR 一个主题；PR 描述写明来源（owner 的原话或相关 issue）和为什么放这个目录。过时的记忆直接删除，git 历史就是归档。
