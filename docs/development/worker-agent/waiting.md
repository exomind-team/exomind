# Worker Agent Waiting Model

## Why Wait

当前设计选择“单 PR 深度推进”，所以当 PR 暂时没有可继续动作时，工作 Agent 进入阻塞等待，而不是切走别的任务。

## Wake Events

等待脚本只监听当前持锁 PR，且以下事件会唤醒它：

- 新的 `[Codex Reviewer]` 评论
- 新的 `REQUEST_CHANGES`
- 新的人类普通评论
- `[Codex Reviewer] ❤️ 需要人类测试`
- `🙋needs-human-test` 标签变化
- CI failure

## Heartbeat Output

等待期间每 `60s` 打一次心跳，输出：

- `waiting_on`
- `pr`
- `since`

## waiting_on Vocabulary

默认细分为：

- `reviewer`
- `human-comment`
- `human-test`
- `ci-failure`

## Pre-Wait Checklist

进入等待前，必须满足：

- 工作区干净，或修改已明确提交
- 该推送的提交已经推送
- PR body 已同步
- 本轮应发评论已发送
- `temp/worker-agent/state/` 已更新
