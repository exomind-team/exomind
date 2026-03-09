# Worker Agent Prompt Cycle

```text
1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 1
```

## Why Prompt Cycling

循环提示词的目标是：

- 让用户可以稳定重复驱动同一个 Codex 会话
- 让每一步只承担一个明确目标
- 把机械动作交给脚本
- 把长解释交给文档

## Step Index

1. 恢复上下文
2. 建立或校验 draft PR + 上锁
3. 刷新 PR 真相与 review 增量
4. 处理阻塞项
5. 继续开发
6. 验证、提交、推送、评论
7. 进入等待并在被唤醒后回到 1

## When To Advance

- 当前步完成且产出已落盘后，进入下一步。
- 若当前步发现阻塞，则先解决阻塞，再判断是否回到上一步或进入下一步。

## When To Restart At 1

以下情况默认回到 `1`：

- `wait-for-update` 被唤醒
- 新评论/新 review 到来
- 当前 PR 的 `head SHA` 发生变化

## Failure / Blocked Cases

- 人测阻塞时，不切任务池，保持当前 PR 锁。
- 若锁校验失败，必须停下并重新确认当前 PR。

## How Prompts Use Docs

- 默认先看 [overview.md](./overview.md)
- 需要细节时按专题文档深入
- 用户复制的循环提示词位于 `docs/worker-agent/prompts/`
