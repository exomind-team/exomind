# Phase 3 计划：exomind-rt + Tauri IPC + Rust Agent

> **日期**: 2026-03-03
> **前置**: Phase 2 (#320) 已合入 dev
> **目标**: 一个 binary，传输层可换，LLM Provider 可换

---

## 核心架构图

```
┌─────────────── Tauri Binary (一个进程) ──────────────────┐
│                                                          │
│  ┌──────────── exomind-rt (纯 Rust 库) ────────────┐    │
│  │                                                  │    │
│  │  SignalPool (tokio broadcast)                    │    │
│  │       ↓ fanout                                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │    │
│  │  │EventLog  │ │Task      │ │Classifier      │   │    │
│  │  │Actor     │ │Actor     │ │Agent (LLM)     │   │    │
│  │  │(机械)    │ │(机械)    │ │(async HTTP)    │   │    │
│  │  └──────────┘ └──────────┘ └────────────────┘   │    │
│  │                                                  │    │
│  │  LlmProvider trait                               │    │
│  │  ├── AnthropicProvider (HTTP)                    │    │
│  │  ├── OpenAICompatProvider (HTTP)                 │    │
│  │  └── LocalCliProvider (Claude/Codex/Gemini CLI)  │    │
│  │                                                  │    │
│  │  Storage: rusqlite → libsql (API 兼容迁移)       │    │
│  └──────────────────────────────────────────────────┘    │
│                      ↕ Tauri IPC                         │
│  ┌─────────────── React Frontend ──────────────────┐    │
│  │  invoke("publish_signal") + listen("signal")     │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘

独立模式（rt-http adapter）:
Frontend ←→ HTTP/SSE (Axum) ←→ exomind-rt
```

---

## 任务拆分

### L1: exomind-rt 纯库拆分

**目标**: `crates/exomind-runtime` → 不依赖 Axum/Tauri 的纯 Rust 库

**操作**:
- 新建 `crates/exomind-rt/` (或直接改 exomind-runtime)
- 从 Cargo.toml 移除 axum, tower, http 等 HTTP 依赖
- `signal/`, `storage/`, `types/` 全部保留
- `routes/` 移出到 `crates/rt-http/` (可选 adapter)

**验收**:
- `cargo build -p exomind-rt` 不带任何 HTTP feature 编译成功
- 所有 signal 单元测试通过

---

### L2: Tauri IPC 信号桥

**目标**: src-tauri 作为 Tauri IPC 适配层

**新建文件**:
- `src-tauri/src/signal_commands.rs` — Tauri commands
- `src-tauri/src/signal_bridge.rs` — pool subscriber → emit

**signal_commands.rs**:
```rust
#[tauri::command]
async fn publish_signal(
    state: State<'_, AppState>,
    topic: String,
    payload: serde_json::Value,
    trace_id: Option<String>,
) -> Result<String, String> {
    let event = SignalEvent::new(topic, payload, trace_id);
    let id = event.id.clone();
    state.pool.publish(event);
    Ok(id)
}

#[tauri::command]
async fn get_signal_history(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<SignalEvent>, String> {
    Ok(state.pool.recent(limit.unwrap_or(50)))
}

#[tauri::command]
fn list_signal_routes(state: State<'_, AppState>) -> Vec<SignalRoute> {
    state.pool.routes()
}
```

**signal_bridge.rs**:
```rust
pub fn start_signal_bridge(pool: Arc<SignalPool>, app: AppHandle) {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();
        while let Ok(event) = rx.recv().await {
            // 前端 listen("signal") 收到所有信号
            let _ = app.emit("signal", &event);
            // 也按 topic 分发（前端可 listen("signal:task.auto-created")）
            let topic_event = format!("signal:{}", event.topic);
            let _ = app.emit(&topic_event, &event);
        }
    });
}
```

**前端适配** (`src/lib/services/signal-stream.service.ts`):
```typescript
// 替换 SSE 实现，统一接口不变
class TauriSignalAdapter implements ISignalStream {
  subscribe(handler: (e: SignalEvent) => void) {
    return listen<SignalEvent>("signal", e => handler(e.payload))
  }
  publish(topic: string, payload: unknown) {
    return invoke("publish_signal", { topic, payload })
  }
}
```

**验收**:
- 前端 invoke publish_signal → RT actors 响应 → 前端 listen 收到 task.auto-created
- 全链路延迟 < 5ms（进程内 IPC）

---

### L3: Rust LLM Provider

**目标**: 替代 TS execFileSync，支持多 Provider

**新建**: `crates/exomind-rt/src/llm/`

```rust
// provider.rs
#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete(&self, system: &str, user: &str) -> Result<String, LlmError>;
}

// anthropic.rs — Anthropic API (直接 HTTP)
pub struct AnthropicProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,  // claude-opus-4-6 / claude-sonnet-4-6
}

// openai_compat.rs — OpenAI 兼容 API (Gemini/Groq/DeepSeek/本地 Ollama)
pub struct OpenAICompatProvider {
    client: reqwest::Client,
    base_url: String,  // https://api.openai.com/v1 | https://generativelanguage.googleapis.com/v1beta
    api_key: String,
    model: String,
}

// cli.rs — 本地 CLI fallback (claude / codex / gemini)
pub struct CliProvider {
    command: String,  // "claude" | "codex" | "gemini"
    args: Vec<String>,
}
```

**Provider 配置**（从环境变量/config 加载）:
```toml
[llm]
provider = "anthropic"          # anthropic | openai_compat | cli
model = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"
# openai_compat 时:
# base_url = "https://api.openai.com/v1"
# cli 时:
# command = "claude"
```

**验收**:
- AnthropicProvider 能完成 classify/review 任务
- 切换 Provider 只改 config，不改代码

---

### L4: Rust Agents (取代 TS agents)

**目标**: classifier/reviewer 从 TS 进程 → Rust async task

**新建**: `crates/exomind-rt/src/signal/agents/`

```rust
// classifier_agent.rs
pub fn spawn_classifier_agent(
    pool: Arc<SignalPool>,
    provider: Arc<dyn LlmProvider>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();
        loop {
            match rx.recv().await {
                Ok(event) if event.topic == "user.input.text" => {
                    let text = extract_text(&event).unwrap_or_default();
                    if text.trim().is_empty() { continue; }

                    let result = provider.complete(CLASSIFY_SYSTEM, &text).await;
                    match result {
                        Ok(json_str) => {
                            if let Ok(classification) = parse_classification(&json_str) {
                                let new_event = make_classified_event(&event, classification);
                                pool.publish(new_event);
                            }
                        }
                        Err(e) => warn!("classifier_agent: LLM call failed: {e}"),
                    }
                }
                Err(RecvError::Closed) => break,
                _ => continue,
            }
        }
    })
}
```

**多轮支持**: Agent 本身是 loop，每次收到信号独立触发一次 LLM 调用，天然支持多轮。无需迭代上限（类 Claude Code 设计）。

**验收**:
- Rust Classifier Agent 能正确分类 user.input.text
- Rust Reviewer Agent 能生成四行复盘
- TS agents 可作为 fallback 保留，或下线

---

## 执行顺序

```
#320 merge → main/dev
     ↓
L1: exomind-rt 纯库拆分 (1-2天)
     ↓
L2: Tauri IPC 信号桥 (1天)    同时: L3: Rust LLM Provider (1-2天)
     ↓                              ↓
L4: Rust Agents (接入 Provider + SignalPool) (1天)
     ↓
V3 验收: 完整一天体验 → 收工 → 四行复盘 (Tauri 内)
```

---

## 关键文件索引

**新建**:
- `crates/exomind-rt/` — 纯 Rust 核心库（从 exomind-runtime 拆出）
- `crates/rt-http/` — HTTP/SSE adapter（可选，standalone 用）
- `src-tauri/src/signal_commands.rs`
- `src-tauri/src/signal_bridge.rs`
- `crates/exomind-rt/src/llm/` — LlmProvider trait + 实现

**修改**:
- `src-tauri/src/lib.rs` — 注册 commands，启动 bridge，spawn agents
- `src/lib/services/signal-stream.service.ts` — 换 TauriSignalAdapter
- `src-tauri/Cargo.toml` — 依赖 exomind-rt
- `crates/exomind-runtime/Cargo.toml` — 移除 axum 等 HTTP dep（或新建 crate）

---

## ZeroClaw 参考点（Phase 3 实施时对照）

| ZeroClaw 模块 | 参考内容 | ExoMind 对应 |
|---|---|---|
| `src/providers/` | Provider trait 设计 + 多 API 适配 | `crates/exomind-rt/src/llm/` |
| `src/agent/loop_.rs` | LLM 调用 + response parse | Rust Agent 执行逻辑 |
| `src/agent/research.rs` | Research-first 减幻觉 | Reviewer Agent 先读 EventLog |
| Android ForegroundService | 电池管理 + OEM 兼容 | Tauri Android 插件 |

新会话：`git clone https://github.com/zeroclaw-labs/zeroclaw` 深度分析 provider/agent 代码。
