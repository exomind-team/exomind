# Worker Agent Overview

```text
+-------------------+
| user copies       |
| prompts/main.md   |
+---------+---------+
          |
          v
+-------------------+
| next-action       |
| restore truth     |
+---------+---------+
          |
          v
+-------------------+
| do exactly one    |
| highest action    |
+---------+---------+
          |
          v
+-------------------+
| renew lock        |
| post progress     |
+---------+---------+
          |
          v
+-------------------+
| next-action again |
| or wait           |
+-------------------+
```

## Overview

`Worker Agent` 是单 PR 深度推进执行器，不负责 approve 或 merge。

它的工作目标是围绕“当前持锁 PR”循环推进，直到：

- PR 被合并
- PR 被关闭
- 人工明确要求放弃该 PR
- 或进入等待状态等待下一次 reviewer / human / CI / human-test 事件

## Runtime Model

运行模型已经从“用户手工切换 1..7 步”收敛为：

- 用户只复制一条恒定主提示词：`docs/worker-agent/prompts/main.md`
- Agent 每轮先运行 `next-action`
- `next-action` / `restore` 会返回 `context.targetLanguage`
- 每轮只做一个最高优先级动作
- 若本轮已经吸收了当前 feedback 批次，先同步 handled cursor
- 动作完成后显式续锁
- 需要时发 `[Codex Worker]` 进展评论，且语言必须跟随 `targetLanguage`
- 然后再次运行 `next-action`
- 若结果是等待，则进入 `wait-for-update`

## Priorities

状态机优先级固定为：

1. `raise-dissent`
2. `create-draft-pr` / `acquire-lock`
3. `reply-blocking-comment`
4. `handle-ci-failure`
5. `sync-pr-body`
6. `implement-next-change`
7. `commit-and-push`
8. `wait-for-update`

## Script Entry Points

统一入口：

- `Scripts/dev/worker-agent/index.ts`

当前关键子命令：

- `restore`
- `next-action`
- `pr sync`
- `cursor sync`
- `lock acquire`
- `lock renew`
- `lock release`
- `wait-for-update`
- `render-comment`
- `render-dissent-comment`
- `render-body`
- `render-dissent-issue`
- `validate-message`

## State Files Under temp/worker-agent

状态目录：

- `temp/worker-agent/state/`
- `temp/worker-agent/drafts/`
- `temp/worker-agent/watch/`
- `temp/worker-agent/lock/`

## Related Docs

- [pr-lifecycle.md](./pr-lifecycle.md)
- [review-flow.md](./review-flow.md)
- [waiting.md](./waiting.md)
- [message-protocol.md](./message-protocol.md)
- [dissent.md](./dissent.md)
- [prompt.md](./prompt.md)
- [prompt-cycle.md](./prompt-cycle.md)
