# SignalPool + Agent-as-Process Architecture

> **Status**: Draft v0.1 (2026-03-02)
> **Origin**: Starlin + Claude 架构对话，基于 SignalPool MVP 计划的迭代
> **前序文档**: `docs/plans/2026-03-01-signal-pool-sse-runtimehost-mvp-mlp-plan.md`

---

## 0. 核心理念

**Agent 是独立进程，不是函数调用。RT 是傻管道。**

```
Agent = 持续运行的进程 + JSON 流式通信 + 心跳 + 可被监督重启
RT    = SignalBus + SSE broadcast + RouteTable + Journal
```

这与 ExoMind 生命判据对齐：
- **过程性存在** → Agent 是持续运行的 daemon
- **失败不可回滚** → 崩溃日志留下不可抹平的痕迹
- **环境裁决** → supervisor 决定重启策略
- **边界归因** → 每个 Agent 进程有独立的边界和责任

---

## 1. 系统拓扑

```
                    exomind-rt (Rust, Axum)
                    ┌──────────────────────────┐
                    │  SignalBus               │
                    │  ┌────────────────────┐  │
 POST /signals/ ──→ │  │ RouteTable         │  │
   publish          │  │ WindowCache (1000) │  │
                    │  │ Journal            │  │
                    │  └────────┬───────────┘  │
                    │           │ fanout        │
                    └───────────┼───────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     SSE stream          SSE stream          SSE stream
     + heartbeat         + heartbeat         + heartbeat
              │                 │                  │
    ┌─────────▼──────┐  ┌──────▼───────┐  ┌──────▼──────┐
    │ Agent Process A │  │ Agent Proc B │  │  Frontend   │
    │ (Claude CLI)    │  │ (Python/Bun) │  │  (Browser)  │
    │                 │  │              │  │             │
    │ 订阅: asr.*     │  │ 订阅: task.* │  │ 订阅: *     │
    │ 产出: interact.*│  │ 产出: task.* │  │ 只读观测    │
    └────────┬────────┘  └──────┬───────┘  └─────────────┘
             │                  │
             └──── POST /signals/publish ────┘
```

### 1.1 两条通信通道

| 方向 | 协议 | 端点 | 说明 |
|------|------|------|------|
| **下行** (RT → Agent) | SSE | `GET /signals/stream?topics=xxx&agent_id=xxx` | JSON 流式接收信号 + 心跳 |
| **上行** (Agent → RT) | HTTP POST | `POST /signals/publish` | JSON 发布响应信号 |

### 1.2 RT 的职责边界

RT 只做四件事，不碰业务逻辑：
1. **接收信号** (POST /signals/publish)
2. **路由分发** (查 RouteTable → SSE fanout)
3. **缓存窗口** (WindowCache 1000 条 Ring Buffer，支持 Last-Event-ID 重放)
4. **审计日志** (Journal 记录投递轨迹)

### 1.3 Agent 的职责边界

Agent 只做三件事：
1. **订阅信号** (连接 SSE，声明感兴趣的 topics)
2. **处理信号** (内部逻辑，对 RT 透明)
3. **发布信号** (POST 结果回 RT)

---

## 2. 数据契约

### 2.1 SignalEvent

```ts
interface SignalEvent<T = unknown> {
  schemaVersion: 1;     // 协议版本
  id: string;           // 信号ID (nanoid/uuid)
  topic: string;        // 主题 (如 "asr.transcript.completed")
  ts: number;           // 事件时间戳 (ms)
  source: string;       // 来源 (如 "ui", "agent:claude", "port:asr")
  originHostId: string; // 源主机ID
  hop: number;          // 中继跳数
  traceId?: string;     // 追踪ID (同一链路共享)
  payload: T;           // 负载
}
```

### 2.2 SignalRoute

```ts
interface SignalRoute {
  id: string;
  enabled: boolean;
  topic: string;           // 匹配主题 (精确匹配，MVP 不做通配)
  targetType: 'agent-local' | 'agent-remote' | 'actor-local' | 'port';
  targetRef: string;       // 目标引用 (如 agent_id)
  createdAt: string;
  updatedAt: string;
}
```

### 2.3 DeliveryRecord (Journal)

```ts
interface DeliveryRecord {
  eventId: string;
  routeId: string;
  targetRef: string;
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  startedAt: string;
  finishedAt: string;
}
```

---

## 3. SSE 协议

### 3.1 下行事件类型

```
event: signal
id: sig_abc123
data: {"schemaVersion":1,"id":"sig_abc123","topic":"asr.transcript.completed","ts":1709366400000,"source":"port:asr","payload":{"text":"今天感觉不错"}}

event: heartbeat
data: {"ts":1709366405000}

event: delivery
data: {"eventId":"sig_abc123","routeId":"r1","targetRef":"agent:claude","status":"sent"}
```

### 3.2 连接参数

```
GET /signals/stream?topics=asr.*,interaction.*&agent_id=claude-main&heartbeat_interval=30
```

| 参数 | 说明 |
|------|------|
| `topics` | 订阅的 topic 列表（逗号分隔，MVP 精确匹配） |
| `agent_id` | 自报身份（用于 RT 注册和状态监控） |
| `heartbeat_interval` | 心跳间隔（秒），默认 30 |

### 3.3 重放支持

- 客户端断线重连时带 `Last-Event-ID` 请求头
- RT 从 WindowCache (1000条) 中查找该 ID 之后的事件重放
- 超出窗口范围的不重放（at-most-once 语义）

---

## 4. Agent 存活检测

| 状态 | 判定条件 |
|------|---------|
| `running` | SSE 连接存活，最近有信号处理 |
| `idle` | SSE 连接存活，但无新投递 |
| `warning` | SSE 连接存活，但最近有投递失败 |
| `offline` | SSE 连接断开，或超过 2 个心跳周期无响应 |

RT 通过 SSE 连接状态天然监控 Agent 存活：
- 连接建立 → 注册（running/idle）
- 连接断开 → 标记 offline
- 心跳超时 → 标记 warning → offline

---

## 5. Agent 进程示例

### 5.1 最简 Agent (bash + curl)

```bash
#!/bin/bash
RT_URL="http://127.0.0.1:1949"

handle_signal() {
  local payload="$1"
  local topic=$(echo "$payload" | jq -r '.topic')
  local text=$(echo "$payload" | jq -r '.payload.text // empty')

  curl -s -X POST "$RT_URL/signals/publish" \
    -H "Content-Type: application/json" \
    -d "{\"topic\":\"echo.reply\",\"source\":\"agent:echo\",\"payload\":{\"echo\":\"$text\"}}"
}

# 订阅 SSE，持续读取
curl -sN "$RT_URL/signals/stream?topics=test.*&agent_id=echo" | while read -r line; do
  case "$line" in
    data:*) handle_signal "${line#data: }" ;;
  esac
done
```

### 5.2 Claude Agent (supervisor loop)

```bash
#!/bin/bash
COMMIT=$(git rev-parse --short=6 HEAD)

while true; do
    LOGFILE="agent_logs/agent_${COMMIT}_$(date +%s).log"

    claude --dangerously-skip-permissions \
           -p "$(cat AGENT_PROMPT.md)" \
           --model claude-sonnet-4-6 &> "$LOGFILE"

    echo "[supervisor] Agent exited, restarting in 3s..." >> "$LOGFILE"
    sleep 3
done
```

### 5.3 Bun/TypeScript Agent

```ts
// agent-interaction.ts
const RT = "http://127.0.0.1:1949";
const source = new EventSource(`${RT}/signals/stream?topics=asr.transcript.completed&agent_id=interaction`);

source.addEventListener("signal", async (e) => {
  const signal = JSON.parse(e.data);
  const reply = await processWithLLM(signal.payload.text);

  await fetch(`${RT}/signals/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: "interaction.reply.ready",
      source: "agent:interaction",
      traceId: signal.traceId,
      payload: { reply }
    })
  });
});

source.addEventListener("heartbeat", () => { /* alive */ });
source.onerror = () => { process.exit(1); /* supervisor will restart */ };
```

---

## 6. RT API 总览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/signals/publish` | 发布信号 |
| GET | `/signals/stream` | SSE 订阅信号流 |
| GET | `/signals/history?limit=N` | 查询最近信号（审计面板） |
| GET | `/signal-routes` | 列出所有路由 |
| POST | `/signal-routes` | 创建路由 |
| PUT | `/signal-routes/:id` | 更新路由 |
| DELETE | `/signal-routes/:id` | 删除路由 |
| GET | `/health` | RT 健康检查 |
| GET | `/agents` | 已注册 Agent 列表（含存活状态） |
| GET | `/topology` | 系统拓扑 |

---

## 7. 与原计划的关系

本文档是 `2026-03-01-signal-pool-sse-runtimehost-mvp-mlp-plan.md` 的**架构修订版**。

### 7.1 保留不变

- SignalPool 四件套架构（Bus + RouteTable + Journal + WindowCache）
- 数据契约（SignalEvent / SignalRoute / DeliveryRecord）
- SSE + POST 通信模式
- at-most-once 投递语义
- MVP 安全边界（本机/LAN, 默认 127.0.0.1）

### 7.2 核心变更

| 原计划 | 本方案 |
|--------|--------|
| Agent 是 Rust trait，进程内调用 | **Agent 是独立进程，通过 SSE/POST 通信** |
| T7/T8 在 TS service 层写 Agent 逻辑 | **Agent 逻辑在独立进程中，语言无关** |
| RT 负责调用 Agent 的 on_signal() | **RT 只做 SSE broadcast，Agent 自己消费** |
| 前端 Signal SDK 是特殊客户端 | **前端也只是一个 SSE 订阅者，跟 Agent 对等** |

### 7.3 简化的部分

- RT 不需要知道 Agent 的内部逻辑
- 不需要扩展 Agent Rust trait
- Relay 自然实现：远程 Agent 直接连 RT 的 SSE

---

## 8. 待讨论事项

> 以下是需要逐帧讨论确认的设计决策点

- [ ] Topic 匹配：MVP 精确匹配 vs 通配符（`asr.*`）
- [ ] Agent 注册：SSE 连接时自动注册 vs 需要先 POST /agents 注册
- [ ] RouteTable 存储：内存 vs 文件持久化 vs SQLite
- [ ] Journal 存储：内存 Ring Buffer vs 文件追加
- [ ] 信号去重：基于 event.id 的 seenCache TTL
- [ ] Agent supervisor：RT 内置 vs 外部 systemd/pm2
- [ ] 前端角色：纯观测 vs 也能 publish 信号（如用户输入触发信号）
- [ ] 安全：X-Exomind-Token 共享令牌的实现时机
- [ ] 嵌入模式：Tauri 内嵌 RT 的 spawn 策略
