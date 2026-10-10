---
summary: 在 Ora 做 feature 或 refactor 前检查所属模块的 specs 根决策；模块完全没有根决策时停下并提醒 owner。
scope: ora-space
---

# 缺少模块根决策时暂停 feature/refactor

在 Ora 进行 feature 或 refactor 工作前，检查工作所属模块在 [specs](https://github.com/ora-space/specs) 中是否已有根决策。

模块没有任何根决策时，停下当前实现，提醒 owner，由 owner 决定先补根决策还是另作处理。specs 暂时缺失不代表模块不需要根决策，不得据此绕过检查。

本规则只针对"没有任何根决策"的模块；已有根决策但是否足以支撑当前工作，结合具体任务和现有 specs 分析。

背景：specs 机制是项目中途引入的，各模块的根决策仍在逐步补齐。
