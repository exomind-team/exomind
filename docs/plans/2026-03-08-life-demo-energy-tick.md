# 认知生命 Demo：能量系统 + Tick 心跳 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Agent 在 ExoMind Runtime 上"活着"——具有可见的能量消耗、自主心跳（tick）、降频机制和可死亡性，为 2026-03-08 晚 8 点报告提供可演示的生命体验证。

**Architecture:** 在现有 RT 的 AppState 中新增 EnergyRegistry（per-agent 能量池），启动时为每个有 tick 的 Agent 启动 tokio 定时任务。Tick scheduler 根据能量水位动态调整 tick 间隔（降频），每次 tick 扣减能量并发布 `agent.tick` 信号。前端通过 SSE 或轮询 API 实时展示能量条和 tick 日志。

**Tech Stack:** Rust (axum/tokio) + TypeScript (React 18 + Tailwind CSS) + SSE

---

## 全景设计

### 数据流

```
┌─────────────────────────────────────────────────────────────┐
│  RT (Rust)                                                  │
│                                                             │
│  EnergyRegistry ← HashMap<agent_id, AgentEnergy>            │
│       │                                                     │
│       ▼                                                     │
│  TickScheduler (per-agent tokio::spawn)                     │
│       │                                                     │
│       ├─ sleep(adjusted_interval) ← 降频表                  │
│       ├─ energy.consume(tick_cost)                           │
│       ├─ agent.on_tick() → Vec<SignalEvent>                  │
│       ├─ publish signals to SignalPool                       │
│       ├─ publish agent.tick meta-signal (能量快照)            │
│       └─ if energy == 0 → publish agent.dormant, stop loop  │
│                                                             │
│  HTTP API:                                                  │
│       GET /agents/:id/energy → AgentEnergySnapshot          │
│       GET /agents → AgentSummary (含 energy_ratio)           │
│       SSE /signals/stream → agent.tick 事件实时推送           │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/SSE
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React)                                           │
│                                                             │
│  AgentDetailPage 增强:                                      │
│       ├─ 能量条 (current / max, 颜色渐变)                    │
│       ├─ 当前 tick 间隔 (实时更新)                            │
│       ├─ 状态标签: alive / slowing / dormant                │
│       └─ tick 日志流 (最近 N 条 agent.tick 信号)             │
│                                                             │
│  AgentSummary 列表:                                         │
│       └─ 每个 Agent 卡片显示能量百分比小条                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 降频表（与报告 4.3 节一致，demo 加速版）

报告原始设定（真实运行用）：

| 能量水位 | tick 间隔 |
|---------|----------|
| > 80%   | 5 min    |
| 50-80%  | 10 min   |
| 20-50%  | 30 min   |
| < 20%   | 60 min   |
| = 0     | dormant  |

**Demo 加速版**（全程 ~3 分钟演完生命周期）：

| 能量水位 | tick 间隔 | 说明 |
|---------|----------|------|
| > 80%   | 3s       | 正常节拍 |
| 50-80%  | 6s       | 开始降频 |
| 20-50%  | 12s      | 明显变慢 |
| < 20%   | 20s      | 濒死 |
| = 0     | stop     | dormant |

### Agent.tick 信号 payload 设计

```json
{
  "topic": "agent.tick",
  "source": "rt:tick-scheduler",
  "payload": {
    "agent_id": "heartbeat",
    "tick_count": 42,
    "energy": {
      "current": 750,
      "max": 1000,
      "ratio": 0.75
    },
    "tick_interval_secs": 6,
    "decision": "idle",
    "phase": "slowing"
  }
}
```

### Agent.dormant 信号 payload 设计

```json
{
  "topic": "agent.dormant",
  "source": "rt:tick-scheduler",
  "payload": {
    "agent_id": "heartbeat",
    "total_ticks": 58,
    "cause": "energy_depleted",
    "final_energy": 0
  }
}
```

---

## Task 1: EnergyPool 模块 (Rust)

**Files:**
- Create: `crates/exomind-runtime/src/energy.rs`
- Modify: `crates/exomind-runtime/src/lib.rs` (添加 `pub mod energy;` 导出)

**Step 1: Write the failing test**

在 `energy.rs` 末尾写 `#[cfg(test)] mod tests`：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_pool_starts_full() {
        let pool = AgentEnergy::new(1000, 10);
        assert_eq!(pool.current(), 1000);
        assert_eq!(pool.max(), 1000);
        assert!((pool.ratio() - 1.0).abs() < f64::EPSILON);
        assert!(!pool.is_dormant());
    }

    #[test]
    fn consume_reduces_energy() {
        let pool = AgentEnergy::new(100, 10);
        assert!(pool.consume(30));
        assert_eq!(pool.current(), 70);
    }

    #[test]
    fn consume_clamps_to_zero() {
        let pool = AgentEnergy::new(20, 10);
        assert!(pool.consume(50));
        assert_eq!(pool.current(), 0);
        assert!(pool.is_dormant());
    }

    #[test]
    fn consume_on_dormant_returns_false() {
        let pool = AgentEnergy::new(10, 10);
        pool.consume(10);
        assert!(!pool.consume(5));
    }

    #[test]
    fn refill_caps_at_max() {
        let pool = AgentEnergy::new(100, 10);
        pool.consume(50);
        pool.refill(200);
        assert_eq!(pool.current(), 100);
    }

    #[test]
    fn tick_interval_scales_with_energy() {
        let pool = AgentEnergy::new(1000, 10);
        let base = 3;
        // > 80% → 1x
        assert_eq!(pool.adjusted_tick_interval(base), 3);
        // 50-80% → 2x
        pool.consume(300); // 700/1000 = 70%
        assert_eq!(pool.adjusted_tick_interval(base), 6);
        // 20-50% → 4x
        pool.consume(400); // 300/1000 = 30%
        assert_eq!(pool.adjusted_tick_interval(base), 12);
        // < 20% → ~7x
        pool.consume(150); // 150/1000 = 15%
        assert_eq!(pool.adjusted_tick_interval(base), 20);
    }

    #[test]
    fn snapshot_captures_state() {
        let pool = AgentEnergy::new(1000, 10);
        pool.consume(250);
        let snap = pool.snapshot("test-agent");
        assert_eq!(snap.agent_id, "test-agent");
        assert_eq!(snap.current, 750);
        assert_eq!(snap.max, 1000);
        assert!((snap.ratio - 0.75).abs() < 0.001);
        assert_eq!(snap.phase, "normal");
    }

    #[test]
    fn registry_tracks_multiple_agents() {
        let registry = EnergyRegistry::new();
        registry.register("a", AgentEnergy::new(100, 5));
        registry.register("b", AgentEnergy::new(200, 10));

        assert_eq!(registry.get("a").unwrap().max(), 100);
        assert_eq!(registry.get("b").unwrap().max(), 200);
        assert!(registry.get("c").is_none());

        let snapshots = registry.all_snapshots();
        assert_eq!(snapshots.len(), 2);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind-runtime energy -- --nocapture`
Expected: compilation error (structs not defined yet)

**Step 3: Write minimal implementation**

```rust
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Per-agent energy pool (Agent 能量池).
///
/// 线程安全，内部使用 RwLock 保护可变状态。
/// tick_cost 是每次 tick 的默认能量消耗。
pub struct AgentEnergy {
    state: RwLock<EnergyState>,
    max: u64,
    tick_cost: u64,
}

struct EnergyState {
    current: u64,
}

/// Snapshot of agent energy for API/SSE serialization.
#[derive(Debug, Clone, Serialize)]
pub struct AgentEnergySnapshot {
    pub agent_id: String,
    pub current: u64,
    pub max: u64,
    pub ratio: f64,
    pub tick_cost: u64,
    pub phase: String,
    pub is_dormant: bool,
}

impl AgentEnergy {
    pub fn new(max: u64, tick_cost: u64) -> Self {
        Self {
            state: RwLock::new(EnergyState { current: max }),
            max,
            tick_cost,
        }
    }

    pub fn current(&self) -> u64 {
        self.state.read().unwrap().current
    }

    pub fn max(&self) -> u64 {
        self.max
    }

    pub fn tick_cost(&self) -> u64 {
        self.tick_cost
    }

    pub fn ratio(&self) -> f64 {
        let current = self.current();
        if self.max == 0 {
            return 0.0;
        }
        current as f64 / self.max as f64
    }

    pub fn is_dormant(&self) -> bool {
        self.current() == 0
    }

    /// Consume energy. Returns false if already dormant (energy == 0).
    /// Clamps to zero (never goes negative).
    pub fn consume(&self, amount: u64) -> bool {
        let mut state = self.state.write().unwrap();
        if state.current == 0 {
            return false;
        }
        state.current = state.current.saturating_sub(amount);
        true
    }

    /// Refill energy, capped at max.
    pub fn refill(&self, amount: u64) -> u64 {
        let mut state = self.state.write().unwrap();
        state.current = (state.current + amount).min(self.max);
        state.current
    }

    /// Calculate adjusted tick interval based on energy ratio.
    /// Uses the frequency modulation table from the report.
    pub fn adjusted_tick_interval(&self, base_secs: u64) -> u64 {
        let ratio = self.ratio();
        if ratio > 0.8 {
            base_secs       // 正常节拍
        } else if ratio > 0.5 {
            base_secs * 2   // 降频 2x
        } else if ratio > 0.2 {
            base_secs * 4   // 降频 4x
        } else {
            // < 20%: 用 20s 的 demo 值（或 base * 7 取较小值）
            (base_secs * 7).min(20)
        }
    }

    /// Current phase name for display.
    pub fn phase(&self) -> &'static str {
        let ratio = self.ratio();
        if ratio > 0.8 {
            "normal"
        } else if ratio > 0.5 {
            "slowing"
        } else if ratio > 0.2 {
            "critical"
        } else if ratio > 0.0 {
            "dying"
        } else {
            "dormant"
        }
    }

    /// Take a snapshot for serialization.
    pub fn snapshot(&self, agent_id: &str) -> AgentEnergySnapshot {
        AgentEnergySnapshot {
            agent_id: agent_id.to_string(),
            current: self.current(),
            max: self.max,
            ratio: self.ratio(),
            tick_cost: self.tick_cost,
            phase: self.phase().to_string(),
            is_dormant: self.is_dormant(),
        }
    }
}

/// Registry of per-agent energy pools.
#[derive(Clone, Default)]
pub struct EnergyRegistry {
    pools: Arc<RwLock<HashMap<String, Arc<AgentEnergy>>>>,
}

impl EnergyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, agent_id: &str, pool: AgentEnergy) {
        self.pools
            .write()
            .unwrap()
            .insert(agent_id.to_string(), Arc::new(pool));
    }

    pub fn get(&self, agent_id: &str) -> Option<Arc<AgentEnergy>> {
        self.pools.read().unwrap().get(agent_id).cloned()
    }

    pub fn all_snapshots(&self) -> Vec<AgentEnergySnapshot> {
        self.pools
            .read()
            .unwrap()
            .iter()
            .map(|(id, pool)| pool.snapshot(id))
            .collect()
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cargo test -p exomind-runtime energy -- --nocapture`
Expected: all 8 tests PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/energy.rs crates/exomind-runtime/src/lib.rs
git commit -m "feat(energy): add AgentEnergy pool with frequency modulation"
```

---

## Task 2: Tick Scheduler (Rust)

**Files:**
- Create: `crates/exomind-runtime/src/tick.rs`
- Modify: `crates/exomind-runtime/src/lib.rs` (添加 `pub mod tick;`，AppState 加 `energy_registry`，start_with_options 中启动 tick scheduler)

**Step 1: Write tick scheduler**

`tick.rs` — 核心 tick 循环逻辑：

```rust
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::task::JoinHandle;

use crate::agent::AgentRegistry;
use crate::energy::{AgentEnergy, EnergyRegistry};
use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

/// Spawn a tick loop for a single agent.
///
/// The loop:
/// 1. Sleep for adjusted interval (based on energy ratio)
/// 2. Consume tick_cost energy
/// 3. Call agent.on_tick()
/// 4. Publish returned signals + agent.tick meta-signal
/// 5. If energy == 0, publish agent.dormant and stop
pub fn spawn_agent_tick(
    agent_id: String,
    base_interval_secs: u64,
    energy: Arc<AgentEnergy>,
    signal_pool: Arc<SignalPool>,
    registry: AgentRegistry,
    host_id: String,
    cancel: Arc<AtomicBool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick_count: u64 = 0;

        loop {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            // 1. Sleep with adjusted interval
            let interval = energy.adjusted_tick_interval(base_interval_secs);
            tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

            if cancel.load(Ordering::Relaxed) {
                break;
            }

            // 2. Consume energy
            if !energy.consume(energy.tick_cost()) {
                // Already dormant — publish and stop
                publish_dormant(&agent_id, tick_count, &signal_pool, &host_id);
                break;
            }

            tick_count += 1;

            // 3. Call agent.on_tick()
            let tick_signals = if let Some(agent) = registry.get(&agent_id) {
                agent.on_tick().await
            } else {
                // Agent unregistered — stop ticking
                break;
            };

            // 4. Publish agent's signals
            for signal in tick_signals {
                signal_pool.publish(signal);
            }

            // 5. Publish agent.tick meta-signal
            let snapshot = energy.snapshot(&agent_id);
            let tick_event = SignalEvent {
                schema_version: 1,
                id: uuid::Uuid::new_v4().to_string(),
                topic: "agent.tick".to_string(),
                ts: chrono::Utc::now().timestamp_millis() as u64,
                source: "rt:tick-scheduler".to_string(),
                origin_host_id: host_id.clone(),
                hop: 0,
                trace_id: None,
                payload: serde_json::json!({
                    "agent_id": agent_id,
                    "tick_count": tick_count,
                    "energy": {
                        "current": snapshot.current,
                        "max": snapshot.max,
                        "ratio": snapshot.ratio,
                    },
                    "tick_interval_secs": interval,
                    "phase": snapshot.phase,
                }),
            };
            signal_pool.publish(tick_event);

            // 6. Check dormant
            if energy.is_dormant() {
                publish_dormant(&agent_id, tick_count, &signal_pool, &host_id);
                break;
            }
        }
    })
}

fn publish_dormant(
    agent_id: &str,
    total_ticks: u64,
    signal_pool: &SignalPool,
    host_id: &str,
) {
    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "agent.dormant".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "rt:tick-scheduler".to_string(),
        origin_host_id: host_id.to_string(),
        hop: 0,
        trace_id: None,
        payload: serde_json::json!({
            "agent_id": agent_id,
            "total_ticks": total_ticks,
            "cause": "energy_depleted",
        }),
    };
    signal_pool.publish(event);
}

/// Start tick loops for all agents with tick_interval_secs > 0.
pub fn start_all_ticks(
    registry: &AgentRegistry,
    energy_registry: &EnergyRegistry,
    signal_pool: &Arc<SignalPool>,
    host_id: &str,
    cancel: Arc<AtomicBool>,
) -> Vec<JoinHandle<()>> {
    let mut handles = Vec::new();

    for summary in registry.list() {
        if summary.tick_interval_secs == 0 {
            continue;
        }

        let Some(energy) = energy_registry.get(&summary.id) else {
            continue;
        };

        let handle = spawn_agent_tick(
            summary.id.clone(),
            summary.tick_interval_secs,
            energy,
            Arc::clone(signal_pool),
            registry.clone(),
            host_id.to_string(),
            Arc::clone(&cancel),
        );

        handles.push(handle);
    }

    handles
}
```

**Step 2: Write integration test**

在 `tick.rs` 末尾：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{Agent, AgentRegistry, ChatChunk, ChatRequest};
    use futures_util::stream::{self, StreamExt};
    use futures_util::stream::BoxStream;
    use futures_util::future::BoxFuture;
    use std::sync::atomic::AtomicBool;

    struct TickTestAgent;

    impl Agent for TickTestAgent {
        fn id(&self) -> &str { "tick-test" }
        fn name(&self) -> &str { "Tick Test" }
        fn description(&self) -> &str { "Test agent for tick" }
        fn chat_stream(&self, _req: ChatRequest) -> BoxStream<'static, ChatChunk> {
            stream::empty().boxed()
        }
        fn tick_interval_secs(&self) -> u64 { 1 }
        fn on_tick(&self) -> BoxFuture<'_, Vec<SignalEvent>> {
            Box::pin(async { Vec::new() })
        }
    }

    #[tokio::test]
    async fn tick_loop_publishes_signals_and_stops_on_energy_depletion() {
        let registry = AgentRegistry::new();
        registry.register(Arc::new(TickTestAgent));

        let energy_registry = EnergyRegistry::new();
        // 30 energy, 10 per tick → 3 ticks then dormant
        energy_registry.register("tick-test", AgentEnergy::new(30, 10));

        let signal_pool = Arc::new(SignalPool::new(None));
        let mut rx = signal_pool.subscribe();
        let cancel = Arc::new(AtomicBool::new(false));

        let handles = start_all_ticks(
            &registry,
            &energy_registry,
            &signal_pool,
            "test-host",
            cancel,
        );
        assert_eq!(handles.len(), 1);

        // Collect signals (3 ticks + 1 dormant = 4 signals, with timeout)
        let mut tick_signals = Vec::new();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);

        loop {
            let timeout = tokio::time::timeout_at(deadline, rx.recv()).await;
            match timeout {
                Ok(Ok(event)) => {
                    tick_signals.push(event);
                    if tick_signals.iter().any(|e: &SignalEvent| e.topic == "agent.dormant") {
                        break;
                    }
                }
                _ => break,
            }
        }

        let tick_count = tick_signals.iter().filter(|e| e.topic == "agent.tick").count();
        let dormant_count = tick_signals.iter().filter(|e| e.topic == "agent.dormant").count();

        assert_eq!(tick_count, 3, "should have 3 tick signals");
        assert_eq!(dormant_count, 1, "should have 1 dormant signal");

        // Verify energy is depleted
        let energy = energy_registry.get("tick-test").unwrap();
        assert!(energy.is_dormant());
    }
}
```

**Step 3: Run tests**

Run: `cargo test -p exomind-runtime tick -- --nocapture`
Expected: PASS

**Step 4: Wire into AppState and start_with_options**

修改 `lib.rs`：

1. 在 `AppState` 中增加 `energy_registry: EnergyRegistry`
2. 在 `start_with_options` 中为内置的 tickable agent 注册能量并启动 tick scheduler
3. 在 `RuntimeHandle` 中增加 `tick_cancel: Arc<AtomicBool>` 用于 graceful shutdown

具体修改点：

```rust
// AppState 新增字段：
pub energy_registry: EnergyRegistry,

// AppState::new_runtime 中初始化：
energy_registry: EnergyRegistry::new(),

// start_with_options 中，在 actor_tasks 之后：
let tick_cancel = Arc::new(AtomicBool::new(false));
let tick_tasks = tick::start_all_ticks(
    &state.registry,
    &state.energy_registry,
    &state.signal_pool,
    &options.host_id,
    Arc::clone(&tick_cancel),
);

// RuntimeHandle 新增：
tick_cancel: Arc<AtomicBool>,
tick_tasks: Vec<JoinHandle<()>>,

// stop() 中：
self.tick_cancel.store(true, Ordering::Relaxed);
```

**Step 5: Run full test suite**

Run: `cargo test -p exomind-runtime -- --nocapture`
Expected: all existing 188+ tests PASS, new tick tests PASS

**Step 6: Commit**

```bash
git add crates/exomind-runtime/src/tick.rs crates/exomind-runtime/src/lib.rs
git commit -m "feat(tick): add tick scheduler with energy-based frequency modulation"
```

---

## Task 3: Heartbeat Demo Agent (Rust)

**Files:**
- Create: `crates/exomind-runtime/src/agent/heartbeat.rs`
- Modify: `crates/exomind-runtime/src/agent/mod.rs` (添加 `pub mod heartbeat;`)
- Modify: `crates/exomind-runtime/src/lib.rs` (在 start_with_options 中注册 heartbeat agent + energy)

**Step 1: Write the Heartbeat Agent**

```rust
use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream, StreamExt};

use super::{Agent, ChatChunk, ChatRequest};
use crate::signal::types::SignalEvent;

/// A minimal demo agent that has a heartbeat tick.
///
/// 它不调用 LLM，每次 tick 只发一个 "pulse" 信号。
/// 用于演示：Agent 自主心跳 → 能量消耗 → 降频 → dormant。
pub struct HeartbeatAgent {
    id: String,
}

impl HeartbeatAgent {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

impl Agent for HeartbeatAgent {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        "Heartbeat Agent"
    }

    fn description(&self) -> &str {
        "最小生命体 — 心跳、能量消耗、降频、可死亡"
    }

    fn status(&self) -> &'static str {
        "available"
    }

    fn chat_stream(&self, _request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        stream::iter(vec![ChatChunk::content_only(
            "我是心跳 Agent，不支持对话。请观察我的能量和 tick 信号。",
        )])
        .boxed()
    }

    // ── 信号网络能力 ──

    fn subscriptions(&self) -> Vec<String> {
        vec![] // 不订阅任何信号，纯自主 tick
    }

    fn publications(&self) -> Vec<String> {
        vec!["heartbeat.pulse".to_string()]
    }

    fn tick_interval_secs(&self) -> u64 {
        3 // Demo 加速：3 秒基础 tick
    }

    fn on_tick(&self) -> BoxFuture<'_, Vec<SignalEvent>> {
        let agent_id = self.id.clone();
        Box::pin(async move {
            vec![SignalEvent {
                schema_version: 1,
                id: uuid::Uuid::new_v4().to_string(),
                topic: "heartbeat.pulse".to_string(),
                ts: chrono::Utc::now().timestamp_millis() as u64,
                source: format!("agent:{agent_id}"),
                origin_host_id: String::new(), // RT 会覆盖
                hop: 0,
                trace_id: None,
                payload: serde_json::json!({
                    "message": "I'm alive",
                }),
            }]
        })
    }
}
```

**Step 2: Register in start_with_options**

在 `start_with_options` 中，builtin actors 之后、tick scheduler 之前：

```rust
// Register heartbeat demo agent
if options.spawn_builtin_actors {
    let heartbeat = Arc::new(agent::heartbeat::HeartbeatAgent::new("heartbeat"));
    state.registry.register(heartbeat);
    // 100 energy, 10 per tick → ~10 ticks ≈ 30-60 seconds (with frequency modulation)
    state.energy_registry.register("heartbeat", energy::AgentEnergy::new(100, 10));
}
```

**Step 3: Test**

Run: `cargo test -p exomind-runtime -- --nocapture`
Expected: all PASS

**Step 4: Manual integration test**

```bash
# Terminal 1: Start RT
cargo run --manifest-path crates/exomind-runtime/Cargo.toml --bin exomind-rt

# Terminal 2: Watch SSE stream
curl -N http://localhost:1949/signals/stream

# Expected: see agent.tick and heartbeat.pulse signals every 3s,
# then slowing down, then agent.dormant after ~10 ticks.
```

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/agent/heartbeat.rs crates/exomind-runtime/src/agent/mod.rs crates/exomind-runtime/src/lib.rs
git commit -m "feat(demo): add Heartbeat Agent — minimal life demo with tick + energy"
```

---

## Task 4: Energy HTTP API (Rust)

**Files:**
- Create: `crates/exomind-runtime/src/routes/energy.rs`
- Modify: `crates/exomind-runtime/src/routes/mod.rs` (添加 `pub mod energy;` + merge router)
- Modify: `crates/exomind-runtime/src/agent/mod.rs` (AgentSummary 增加 `energy_ratio`)

**Step 1: Write the energy route**

```rust
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};

use crate::energy::AgentEnergySnapshot;
use crate::AppState;

/// GET /agents/:id/energy
async fn get_agent_energy(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<AgentEnergySnapshot>, StatusCode> {
    let energy = state
        .energy_registry
        .get(&id)
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(energy.snapshot(&id)))
}

/// GET /energy — all agent energy snapshots
async fn list_energy(
    State(state): State<AppState>,
) -> Json<Vec<AgentEnergySnapshot>> {
    Json(state.energy_registry.all_snapshots())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/energy", get(list_energy))
        .route("/agents/:id/energy", get(get_agent_energy))
}
```

**Step 2: Write tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::energy::{AgentEnergy, EnergyRegistry};
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tower::util::ServiceExt;

    fn test_state() -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "energy-test".to_string();
        let mut state = AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: crate::agent::AgentRegistry::new(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(
                host_id,
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            energy_registry: EnergyRegistry::new(),
        };
        state
            .energy_registry
            .register("heartbeat", AgentEnergy::new(1000, 10));
        state
    }

    #[tokio::test]
    async fn get_agent_energy_returns_snapshot() {
        let state = test_state();
        let app = router().with_state(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/agents/heartbeat/energy")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let snap: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(snap["agent_id"], "heartbeat");
        assert_eq!(snap["current"], 1000);
        assert_eq!(snap["max"], 1000);
        assert_eq!(snap["phase"], "normal");
    }

    #[tokio::test]
    async fn get_unknown_agent_returns_404() {
        let state = test_state();
        let app = router().with_state(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/agents/unknown/energy")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
```

**Step 3: Add energy_ratio to AgentSummary**

在 `agent/mod.rs` 的 `AgentSummary` 中增加可选字段：

```rust
/// 当前能量比例 (0.0-1.0)，None 表示无能量系统.
#[serde(skip_serializing_if = "Option::is_none")]
pub energy_ratio: Option<f64>,
```

在 `AgentRegistry::list()` 中，如果有 energy_registry 引用就填入。但为了不改变 trait，这个在 route handler 层面做更合适 — 在 `list_agents` handler 中查 energy_registry 补充 energy_ratio。

**Step 4: Run tests**

Run: `cargo test -p exomind-runtime -- --nocapture`
Expected: all PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/routes/energy.rs crates/exomind-runtime/src/routes/mod.rs crates/exomind-runtime/src/agent/mod.rs
git commit -m "feat(api): add energy HTTP endpoints for agent energy monitoring"
```

---

## Task 5: 前端能量展示 (TypeScript/React)

**Files:**
- Modify: `src/services/runtime-client.ts` (新增 getAgentEnergy 方法)
- Modify: `src/ui/app/pages/agents/AgentDetailPage.tsx` (增加能量条)
- Modify: `src/lib/types/agent-hub.ts` (增加 energy 类型)

**Step 1: 新增类型定义**

在 `src/lib/types/agent-hub.ts` 末尾追加：

```typescript
// Agent 能量快照
export interface AgentEnergySnapshot {
  agent_id: string;
  current: number;
  max: number;
  ratio: number;
  tick_cost: number;
  phase: string; // 'normal' | 'slowing' | 'critical' | 'dying' | 'dormant'
  is_dormant: boolean;
}
```

**Step 2: RuntimeClient 新增方法**

在 `src/services/runtime-client.ts` 中新增：

```typescript
async getAgentEnergy(agentId: string): Promise<AgentEnergySnapshot | null> {
  try {
    const resp = await fetch(`${this.baseUrl}/agents/${agentId}/energy`);
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}
```

**Step 3: AgentDetailPage 增加能量条**

在 AgentDetailPage 的 stats section 之后，增加能量可视化区域：

```tsx
// 能量条组件（内联在 AgentDetailPage 中）
function EnergyBar({ energy }: { energy: AgentEnergySnapshot }) {
  const percent = Math.round(energy.ratio * 100);
  const barColor =
    energy.phase === 'normal' ? '#22C55E' :
    energy.phase === 'slowing' ? '#EAB308' :
    energy.phase === 'critical' ? '#F97316' :
    energy.phase === 'dying' ? '#EF4444' :
    '#6B7280'; // dormant

  const phaseLabel =
    energy.phase === 'normal' ? '正常' :
    energy.phase === 'slowing' ? '降频中' :
    energy.phase === 'critical' ? '能量不足' :
    energy.phase === 'dying' ? '濒死' :
    '休眠';

  return (
    <section className="mt-4">
      <h3 className="text-[13px] font-semibold text-muted-foreground">生命能量 (C1)</h3>
      <div className="mt-2 rounded-2xl border border-border-card bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">
            {energy.current} / {energy.max}
          </span>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ color: barColor, backgroundColor: barColor + '15' }}
          >
            {phaseLabel}
          </span>
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${percent}%`,
              backgroundColor: barColor,
            }}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-background py-1.5">
            <span className="text-[11px] text-muted-foreground">每 tick 消耗</span>
            <p className="text-sm font-semibold text-foreground">{energy.tick_cost}</p>
          </div>
          <div className="rounded-lg bg-background py-1.5">
            <span className="text-[11px] text-muted-foreground">剩余能量</span>
            <p className="text-sm font-semibold text-foreground">{percent}%</p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

**Step 4: AgentDetailPage 集成轮询**

在 AgentDetailPage 组件中增加 energy state + 轮询逻辑：

```tsx
const [energy, setEnergy] = useState<AgentEnergySnapshot | null>(null);

useEffect(() => {
  if (!targetId) return;
  let disposed = false;

  const poll = async () => {
    // 获取第一个可用的 runtime client
    const client = getRuntimeManager().getFirstClient();
    if (!client) return;
    const snap = await client.getAgentEnergy(targetId);
    if (!disposed && snap) setEnergy(snap);
  };

  void poll();
  const timer = setInterval(poll, 2000); // 每 2 秒轮询
  return () => {
    disposed = true;
    clearInterval(timer);
  };
}, [targetId]);
```

在 JSX 中，stats section 之后插入：

```tsx
{energy && <EnergyBar energy={energy} />}
```

**Step 5: Verify**

```bash
bun run build
# 确认无类型错误
```

**Step 6: Commit**

```bash
git add src/lib/types/agent-hub.ts src/services/runtime-client.ts src/ui/app/pages/agents/AgentDetailPage.tsx
git commit -m "feat(ui): add energy bar to AgentDetailPage with real-time polling"
```

---

## Task 6: 端到端验证

**Step 1: 编译 RT**

```bash
cargo build -p exomind-runtime
```
Expected: 编译成功

**Step 2: 运行全部 Rust 测试**

```bash
cargo test -p exomind-runtime -- --nocapture
```
Expected: 190+ tests PASS

**Step 3: 启动 RT 并观察心跳**

```bash
# Terminal 1
cargo run --manifest-path crates/exomind-runtime/Cargo.toml --bin exomind-rt

# Terminal 2 — 监听 SSE 流
curl -N http://localhost:1949/signals/stream

# Terminal 3 — 查询能量
curl http://localhost:1949/agents/heartbeat/energy | jq
```

Expected:
- SSE 流中每 3 秒出现 `agent.tick` + `heartbeat.pulse` 信号
- 随着能量下降，tick 间隔自动变长（3s → 6s → 12s → 20s）
- 能量耗尽后出现 `agent.dormant` 信号，tick 停止
- `/agents/heartbeat/energy` 返回实时能量快照

**Step 4: 启动前端验证 UI**

```bash
bun dev
```

- 打开 `http://localhost:5173/agents`
- 点击 heartbeat Agent 查看详情
- 确认能量条实时下降，phase 标签变化

**Step 5: TypeScript 构建验证**

```bash
npx tsc --noEmit
```
Expected: 无类型错误

---

## Demo 演示脚本（给晚上报告用）

### 准备

1. `cargo build -p exomind-runtime`
2. `bun dev` 启动前端
3. 准备两个终端窗口

### 演示步骤

1. **启动 RT**（演示启动即有生命）
   ```bash
   cargo run --manifest-path crates/exomind-runtime/Cargo.toml --bin exomind-rt
   ```
   > "启动运行时，Heartbeat Agent 自动开始心跳"

2. **展示信号流**（前端拓扑视图）
   > 打开前端 /agents → topology 视图
   > "信号网络 = 神经系统，RouteTable = 丘脑"

3. **展示能量条**（点击 heartbeat 详情）
   > "Agent 的能量在持续消耗 — 这是 C1（能量依赖）"

4. **等待降频**（观察 tick 间隔变化）
   > "能量低于 80%，tick 间隔翻倍 — 这是 C6（自我感知→自我调节）"
   > "这不是我们硬编码的，而是先天反射弧 — 像心跳一样不可覆盖"

5. **等待 dormant**（能量耗尽）
   > "能量 = 0，Agent 进入休眠 — 这是 C5（可死亡性）"
   > "没有重试，没有重启，不可回滚"

6. **对比传统框架**
   > "传统 Agent 框架：任务开始→执行→结束→销毁"
   > "ExoMind：Agent 在'活着'，tick 是心跳，不行动是合法决策"

### 关键对话点

- "不是给 LLM 套壳，是造身体"
- "Heartbeat Agent 不调 LLM，但它是'活的'"
- "能量系统 = C1，沙盒边界 = C2，不可回滚 = C5"
- "Phase C 的终极目标：让认知从这个身体里自己长出来"

---

*创建时间: 2026-03-08*
*预计实现时间: 2-3 小时*
