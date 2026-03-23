# 时间块结束 → Agent 自动反馈

> Issue #323 | PR #324 | 2026-03-04

## 概述

用户结束时间块后，系统自动触发 AI 反馈：分析专注情况，给出鼓励和改进建议。

## 信号流

```
用户点击「结束时间块」
    ↓
endBlock() → HTTP POST timeblock.completed → RT (port 1949)
    ↓
RT 路由 → Reviewer Agent (SSE 订阅)
    ↓
Reviewer Agent → Claude CLI → 生成 JSON 反馈
    ↓
Reviewer Agent → HTTP POST review.completed → RT
    ↓
RT → SSE → 前端 useSignalStream hook
    ↓
hook → EventStorage.addEvent(type: "agent_feedback")
    ↓
ChatPage 自动刷新 → 紫色 AI 反馈气泡
```

## 启动步骤（可复现）

### 前提

- Rust toolchain (`cargo`)
- Bun (`bun`)
- Claude CLI (`claude`) 已登录

### 1. 启动 RT

```bash
cd D:\project\exomind
cargo run --manifest-path crates/exomind-runtime/Cargo.toml --bin exomind-rt
```

验证：

```bash
curl http://localhost:1949/health
# → {"status":"ok","version":"0.1.0"}
```

### 2. 确认路由表包含 timeblock.completed

```bash
curl -s http://localhost:1949/signal-routes | python -m json.tool
```

应包含：

```json
{ "topic": "timeblock.completed", "target_type": "agent", "target_ref": "reviewer" }
```

如果缺失（RT 用了旧配置），手动添加：

```bash
curl -X POST http://localhost:1949/signal-routes \
  -H "Content-Type: application/json" \
  -d '{"topic":"timeblock.completed","target_type":"agent","target_ref":"reviewer","enabled":true}'
```

### 3. 启动 Agents

```bash
bash scripts/start-agents.sh
```

应看到：

```
[Classifier] starting — rt=http://localhost:1949
[Reviewer] starting — rt=http://localhost:1949
[SignalListener] connected to ...
```

### 4. 启动前端

```bash
bun dev
```

### 5. 测试流程

1. 打开浏览器访问前端地址（如 `http://localhost:1420`）
2. 开始一个时间块（任意名称 + 计时模式）
3. 等几秒，点击「结束」
4. 填写反馈（可选），提交
5. 等待 30-60 秒（Reviewer Agent 调用 Claude CLI）
6. ChatPage 出现紫色 AI 反馈气泡

### 6. 手动验证信号链路

发布测试信号：

```bash
curl -X POST http://localhost:1949/signals/publish \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "timeblock.completed",
    "source": "manual-test",
    "payload": {
      "block": {"id":"test-1","name":"测试","startTime":1772549000000,"endTime":1772549200000},
      "feedbackReport": "## 测试\n\n- 专注节奏：连续专注\n- 反馈状态：已填写\n\n---\n\n测试反馈内容",
      "recentEvents": [{"text":"开始测试","ts":1772549000000}]
    }
  }'
```

查看结果：

```bash
# 等待 30-60 秒后
curl -s http://localhost:1949/signals/history?limit=3 | python -m json.tool
# 应看到 topic: "review.completed", review_type: "timeblock"
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/services/timeblock.service.ts` | endBlock() 发布 timeblock.completed |
| `config/signal-routes.default.json` | RT 启动时加载的默认路由表 |
| `packages/ts-agent-cli/agents/reviewer/index.ts` | 处理 timeblock.completed，调用 Claude CLI |
| `packages/ts-agent-cli/agents/reviewer/prompt.ts` | 时间块反馈专用 prompt |
| `src/lib/services/signal-handlers.ts` | 前端信号分发器 |
| `src/ui/hooks/useSignalStream.ts` | SSE → signal-handlers → EventStorage |
| `src/App.tsx` | 挂载 useSignalStream |
| `src/components/Chat/ChatPage.tsx` | 渲染 agent_feedback 事件 |
| `src/lib/types/event.ts` | SYSTEM_TAGS.AGENT_FEEDBACK |
| `scripts/start-agents.sh` | 一键启动 classifier + reviewer |

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 没有收到反馈 | RT 路由表缺 timeblock.completed | 见上方「确认路由表」 |
| Agent 日志 "nested session" | CLAUDECODE 环境变量干扰 | 确保用独立终端启动 agents，不在 Claude Code 内 |
| 前端无紫色气泡 | SSE 未连接 | 检查浏览器控制台 `[SignalStream] SSE connection started` |
| Agent 日志无 "received" | Agent SSE 断连 | 重启 `scripts/start-agents.sh` |
| review.completed 到了但没气泡 | EventStorage 写入或 ChatPage 刷新问题 | 刷新页面，检查 IndexedDB |
