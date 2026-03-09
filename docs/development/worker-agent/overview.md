# Worker Agent Overview

```text
+--------+     +----------+     +----------+     +--------+
| issue  | --> | 首个提交 | --> | draft PR | --> | 上锁   |
+--------+     +----------+     +----------+     +--------+
                                                        |
                                                        v
+-------------+     +-------------+     +----------------------+
| restore     | --> | 刷新PR真相  | --> | 有阻塞项?            |
+-------------+     +-------------+     +----------------------+
                                              | yes       | no
                                              v           v
                                    +----------------+  +----------------+
                                    | 回复并处理     |  | 继续开发       |
                                    +----------------+  +----------------+
                                              \           /
                                               \         /
                                                v       v
                                         +--------------------+
                                         | 同步PR body        |
                                         | 提交/推送/回传     |
                                         +--------------------+
                                                    |
                                                    v
                                         +--------------------+
                                         | 无事可做则 wait    |
                                         | 新评论可唤醒       |
                                         +--------------------+
```

## Overview

`Worker Agent` 是单 PR 深度推进执行器，不负责 approve 或 merge。

它的工作目标是围绕“当前持锁 PR”循环推进，直到：

- PR 被合并
- PR 被关闭
- 人工明确要求放弃该 PR

## Roles

- `Worker Agent`
  - 写代码
  - 修 review
  - 回复人类评论
  - 回传验证证据
- `Reviewer Agent`
  - 发 `[Codex Reviewer]`
  - approve
  - merge

## Single-PR Loop

核心规则：

1. 当前 PR 的真相源优先来自 `PR 锁系统`。
2. `Worker Agent` 只处理自己当前持锁的 PR。
3. 进入等待后，不切换别的 PR。
4. 人类普通评论也视为阻塞项。

## Prompt Cycle Overview

提示词采用循环模式：

`1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 1`

详见：

- [prompt-cycle.md](./prompt-cycle.md)
- [../../worker-agent/prompts/README.md](../../worker-agent/prompts/README.md)

## Script Entry Points

统一入口：

- `Scripts/dev/worker-agent/index.ts`

首批子命令：

- `restore`
- `lock`
- `wait-for-update`
- `render-comment`
- `render-body`
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
- [prompt.md](./prompt.md)
