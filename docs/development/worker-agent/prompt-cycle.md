# Worker Agent Prompt Cycle

```text
main prompt
  -> next-action
  -> do one action
  -> renew lock
  -> progress comment if needed
  -> next-action
  -> ...
  -> wait-for-update
  -> wake
  -> next-action
```

## Why This Changed

旧设计要求用户轮流复制 `1.md -> 7.md`，这会把“当前该做什么”的判断压力放在用户身上。

新设计把判断权收敛到脚本状态机：

- 用户输入恒定主提示词
- 脚本给出当前唯一最高优先级动作
- Agent 只执行这一轮动作
- 然后重新判断

## Internal Step Mapping

旧的 `1.md` 到 `7.md` 仍保留，但它们现在只是参考手册，用来解释：

1. 恢复上下文
2. 建 PR 与上锁
3. 刷新 PR 真相
4. 处理阻塞项
5. 推进当前开发
6. 验证/提交/推送/回传
7. 进入等待

用户不再需要手工判断当前应该输入哪一条。

## State Machine Boundary

每轮动作完成后：

- 必须重新运行 `next-action`
- 必须显式 `lock renew`
- 不允许把“发评论”当成续锁手段

## Wait Boundary

只有当 `next-action` 返回 `wait-for-update` 时，工作 Agent 才进入等待。

被以下事件唤醒后，工作 Agent 不需要新的提示词变体，而是继续回到同一主提示词流程：

- reviewer 评论
- 人类评论
- `REQUEST_CHANGES`
- `🙋needs-human-test`
- CI failure
