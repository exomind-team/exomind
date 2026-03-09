# Worker Agent Prompt Cycle

```text
1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 1
```

## How To Use

1. 启动一个 Codex 会话。
2. 打开本目录中的 `1.md`。
3. 复制其内容发送给 Codex。
4. 该步完成后，继续复制 `2.md`。
5. 如此循环到 `7.md`。
6. `7.md` 被唤醒后，再回到 `1.md`。

## Command Rule

脚本命令在 Termux / Node 环境优先使用：

`npx tsx Scripts/dev/worker-agent/index.ts ...`

若环境提供 bun，也可使用：

`bun Scripts/dev/worker-agent/index.ts ...`

## Related Docs

- `docs/development/worker-agent/overview.md`
- `docs/development/worker-agent/review-flow.md`
- `docs/development/worker-agent/waiting.md`
- `docs/development/worker-agent/message-protocol.md`
