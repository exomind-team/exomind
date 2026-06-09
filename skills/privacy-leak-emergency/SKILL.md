---
name: privacy-leak-emergency
description: >
  GitHub 公开仓库隐私泄露应急处置。当发现敏感信息（真实人名、个人日程、内部战略等）
  被意外暴露在公开仓库的 issue、PR、代码文件、开发日志或 Git 历史中时使用。
  即使用户只说「删掉那条 issue」也应调用此 skill——单独删除往往不够，下游系统
  （devlog、GitHub Pages）和 Git 历史中可能同步存有副本。
  触发词：泄露、误提交、私人信息、敏感内容、清除 Git 历史、删除 issue、人名被公开、
  个人日程暴露、filter-repo、force push 清理。
---

# Privacy Leak Emergency

公开仓库中的隐私泄露往往比看起来更广：删除 issue 只消除了前端，Git 历史中的
悬空对象在 GitHub GC 前（约 90 天）仍可通过 SHA 直接访问，下游日志系统可能
已同步了完整内容。本 skill 帮你系统性地找到所有暴露面并彻底清除。

## When To Use

- 用户报告公开仓库中存在真实人名、个人日程、内部战略等敏感内容
- 用户想删除某条 issue/PR 或清除某段 Git 历史
- 用户想全面排查某仓库（或组织内所有公开库）是否有隐私泄露

## Load Order

1. **Read `references/methodology.md`** 获取完整五阶段流程和所有操作命令。
2. **Read `references/threat-model.md`** 当需要向用户解释「为什么单删不够」或评估残留风险时。
3. **Read `references/scan-keywords.md`** 在执行扩展扫描阶段，获取关键词库和过滤规则。

## Core Rules

- 先定位全部暴露面，再开始清除——避免遗漏下游副本。
- issue 必须先混淆（替换为 `?`）再删除，使缓存抓到的是无意义内容。
- Git 历史重写用 `git filter-repo --replace-text`，替换文本须保留技术语义，只去除人名/日期。
- filter-repo 执行后必须本地验证（`git log -S` + `git grep`）再 force push。
- 每次处置后输出标准化清除报告，记录各渠道状态。
- 处置完成后执行扩展扫描，以当前关键词为核心扩大排查范围。
