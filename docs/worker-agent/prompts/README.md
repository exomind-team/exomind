# Worker Agent Prompt Entry

## Single Entry Rule

用户实际循环输入的提示词只有一条：

- `docs/worker-agent/prompts/main.md`

## Reference Manual

以下文件继续保留，但仅作为参考手册，不再要求用户按顺序轮流复制：

- `1.md`
- `2.md`
- `3.md`
- `4.md`
- `5.md`
- `6.md`
- `7.md`

## Command Rule

脚本命令在 Termux / Node 环境优先使用：

`npx tsx Scripts/dev/worker-agent/index.ts ...`

若环境提供 bun，也可使用：

`bun Scripts/dev/worker-agent/index.ts ...`

## Related Docs

- `docs/development/worker-agent/overview.md`
- `docs/development/worker-agent/prompt-cycle.md`
- `docs/development/worker-agent/review-flow.md`
- `docs/development/worker-agent/waiting.md`
- `docs/development/worker-agent/message-protocol.md`
- `docs/development/worker-agent/dissent.md`
