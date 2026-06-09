---
name: human-ui-verification-page
description: Generate a human-facing HTML verification page with checkboxes, step-by-step UI acceptance instructions, evidence fields, notes, progress tracking, and local persistence. Use when the user asks to create a manual verification page,验收页,人工验收清单,可勾选HTML检查页, or wants a systematic human UI workflow to verify implementation against a plan, issue batch, or feature set.
---

# Human UI Verification Page

生成“给人类手动验收用”的 HTML 页面，而不是纯文档摘要。

## Core Workflow

1. 提取验收范围。
2. 把范围拆成“准备项 / 分组验收项 / 专项反馈项”。
3. 为每个验收项写出：
   - 人类操作步骤
   - 期望结果
   - 证据输入框
   - 备注区
   - “已验证”复选框
4. 生成带本地持久化的 HTML 验收页。
5. 将文件写入项目内 `temp/`，再在浏览器中打开。

## Do This First

先阅读 [references/verification-page-charter.md](./references/verification-page-charter.md)。

如果用户还要求“参考现有页面风格”或“沿用之前的验收页结构”，再读取：

- [assets/verification-page-template.html](./assets/verification-page-template.html)

## Output Rules

- 默认输出单文件 HTML。
- 默认写到 `temp/` 下，文件名应直观，例如：
  - `temp/human-ui-verification-checklist.html`
  - `temp/issue-640-manual-checklist.html`
- 页面标题必须直接体现“这是给人类手动核实实现程度的验收页”。
- 页面内容必须偏“可执行操作清单”，不要写成只可阅读、不可操作的说明书。
- 页面至少包含：
  - 总标题
  - 使用方式说明
  - 复选框
  - 证据输入区
  - 备注区
  - 自动保存
  - 进度统计

## Constraints

- 不要只给 Markdown 清单，除非用户明确不要 HTML。
- 不要假设用户记得上下文；若上下文不足，先从当前计划文档、相关 issue 文档、当前对话中恢复验收目标。
- 不要把页面做成开发者调试面板；它服务的是“人类人工验收”。
- 不要省略“期望结果”，否则人类无法判断是否通过。

## Final Check

交付前确认：

1. HTML 可以离线打开。
2. 所有复选框和输入框都可操作。
3. 状态会写入 `localStorage`。
4. 页面文案能让一个“没有聊天上下文的 Agent 或人”看懂如何验收。
