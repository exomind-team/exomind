# Worker Agent Implementation Plan

## Goal

落地目录化的 `worker-agent` 文档、循环提示词、脚本骨架与 temp 状态结构。

## Architecture

```text
+------------------------------+
| docs/development/worker-agent|
+------------------------------+
               |
               v
+------------------------------+
| docs/worker-agent/prompts    |
+------------------------------+
               |
               v
+------------------------------+
| Scripts/dev/worker-agent     |
+------------------------------+
               |
               v
+------------------------------+
| temp/worker-agent            |
+------------------------------+
```

## Task Breakdown

1. 建立目录化文档。
2. 建立循环提示词。
3. 建立脚本入口与核心库。
4. 建立等待更新逻辑。
5. 建立协议校验与模板渲染。
6. 建立最小单测。

## Command Contract

- `restore`
- `lock`
- `wait-for-update`
- `render-comment`
- `render-body`
- `validate-message`

## Temp State Contract

- `state/current.json`
- `state/handled-review-cursor.json`
- `state/waiting.json`
- `drafts/comment.md`
- `drafts/pr-body.md`
- `watch/last-wake.json`
- `lock/current-lock.json`

## Test Matrix

- 协议测试
- 唤醒分类测试
- 状态恢复测试
- CLI 基础验证
