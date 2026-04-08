# Issue #848: QuotaMonitor Plugin — RT 插件接入信号网络

**状态**: In Progress — 设计决策已对齐 (2026-04-07)
**负责人**: @agent-team

---

## 背景

ExoMind RT 目前缺乏对外部 API 配额的可观测性。MiniMax API 的 Claude Code 套餐配额无法在 UI 上实时查看，导致 Agent 可能因额度耗尽而静默失败。本提案在 RT 内引入 QuotaMonitor 插件，作为信号网络中的主动感知节点，实现配额的主动轮询、阈值预警和按需查询。

---

## 架构设计

### 核心定位

QuotaMonitor 是一个 **RT 内部插件**（Rust），不是独立进程，也不是前端组件。它：

1. **订阅** SignalPool 中的特定信号（如 `quota.check`）
2. **发布** 配额状态信号（如 `quota.heartbeat`、`quota.warning`）
3. **被 RT HTTP API 控制**（启动/停止/查询）
4. **配置通过 config_store 持久化**

### 信号契约

```
入向信号 (QuotaMonitor 订阅):
  quota.check        → 按需查询指定模型
  quota.disable      → 停止轮询

出向信号 (QuotaMonitor 发布):
  quota.heartbeat    → 定期广播所有模型当前配额
  quota.warning      → 额度低于阈值时触发
  quota.exhausted    → 额度耗尽时触发
  quota.checked      → 按需查询的响应
  quota.error        → API 调用失败
```

### Signal 事件结构

```rust
// 入向
SignalEvent { topic: "quota.check", payload: { model: Option<String> } }
SignalEvent { topic: "quota.disable", payload: {} }

// 出向
SignalEvent { topic: "quota.heartbeat", payload: QuotaHeartbeatPayload }
SignalEvent { topic: "quota.warning", payload: QuotaWarningPayload }
SignalEvent { topic: "quota.exhausted", payload: QuotaExhaustedPayload }
SignalEvent { topic: "quota.checked", payload: QuotaCheckedPayload }
SignalEvent { topic: "quota.error", payload: QuotaErrorPayload }

struct QuotaHeartbeatPayload {
    timestamp_ms: u64,
    models: Vec<ModelQuota>,
}

struct ModelQuota {
    model_name: String,          // e.g. "MiniMax-M*"
    display_name: String,        // e.g. "MiniMax-M2.7-highspeed"
    interval_remains: u32,       // 当前 interval 剩余次数
    interval_total: u32,
    interval_reset_in_ms: u64,
    weekly_remains: u32,
    weekly_total: u32,
    weekly_reset_in_ms: u64,
}

struct QuotaWarningPayload {
    model_name: String,
    remains: u32,
    threshold: u32,
    interval_reset_in_ms: u64,
}

struct QuotaExhaustedPayload {
    model_name: String,
    interval_reset_in_ms: u64,
}

struct QuotaCheckedPayload {
    model_name: String,
    remains: u32,
    query_time_ms: u64,
}

struct QuotaErrorPayload {
    model_name: Option<String>,
    error: String,
}
```

---

## 目录结构

```
crates/exomind-runtime/src/
├── lib.rs                       ← AppState 注册 quota_monitor
├── plugins/
│   ├── mod.rs                   ← plugins 导出
│   └── quota/
│       ├── mod.rs               ← QuotaMonitor 主模块
│       ├── signals.rs           ← 信号类型定义 (Serde structs)
│       ├── http_client.rs       ← MiniMax API HTTP 调用
│       └── config_keys.rs       ← config_store key 常量
```

---

## 实现计划

> **范围锁定 (2026-04-07)**：Phase 1-4 是本次交付范围，Phase 5 已取消。

### Phase 1: 核心插件骨架

**目标**: 最小可工作的 QuotaMonitor，能查能发信号

1. `plugins/quota/mod.rs` — QuotaMonitor 结构体
   - `new(api_key, signal_pool, config_store)` 构造函数
   - `start()` — 启动内部定时器
   - `stop()` — 停止定时器
   - `check_quota(model)` — 查询单个模型
   - `check_all()` — 查询所有已注册模型

2. `plugins/quota/signals.rs` — 信号 payload 结构体（Serde 可序列化）

3. `plugins/quota/http_client.rs` — MiniMax API 调用
   - `check_remains(api_key, model)` → `Result<ModelQuota>`
   - 带 Cloudflare bypass headers（User-Agent/Referer）
   - 超时控制（5s）

4. `plugins/quota/config_keys.rs` — config_store key 常量

5. `lib.rs` — AppState 新增字段

**验收标准**:
- [ ] `cargo check` 通过
- [ ] QuotaMonitor 可初始化和销毁
- [ ] `check_quota("MiniMax-M*")` 返回正确数据

### Phase 2: 信号网络集成

**目标**: 接入 SignalPool，实现完整的信号循环

1. 实现信号订阅处理循环：
   - 接收 `quota.check` → 调用 `check_quota` → 发布 `quota.checked`
   - 接收 `quota.disable` → 停止轮询

2. 实现定时心跳广播：
   - 每 5 分钟调用 `check_all()` → 发布 `quota.heartbeat`
   - 心跳中包含所有模型的当前配额

3. 实现阈值预警：
   - `interval_remains < 1000` → 发布 `quota.warning`
   - `interval_remains == 0` → 发布 `quota.exhausted`

**验收标准**:
- [ ] `quota.check` 信号能触发 `quota.checked` 响应
- [ ] 定时器正确运行并发布心跳
- [ ] 阈值触发正确的 warning/exhausted 信号

### Phase 3: HTTP API 端点

**目标**: 暴露 REST API 供前端/调试使用

```
GET  /quota                  → 返回所有模型当前配额（缓存）
GET  /quota/{model}         → 查询指定模型实时配额
POST /quota/check           → 强制刷新所有配额
POST /quota/disable         → 停止轮询
POST /quota/enable          → 恢复轮询
```

路由注册到 `AppState::router()`。

**验收标准**:
- [ ] HTTP API 返回正确的 JSON 响应
- [ ] 前端可调通 `/quota` 端点

### Phase 4: Settings 集成（UI/后端统一设计）

**⚠️ 核心问题：不同 Actor 的 Settings 如何统一？**

#### 统一设计原则

```
┌─────────────────────────────────────────────────────────────────┐
│                    Settings 统一架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  每一层职责单一：                                                  │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐     │
│  │ SettingsItem │   │ Settings     │   │ config_store     │     │
│  │ (Frontend)  │──▶│ Registry     │──▶│ (RT Backend)     │     │
│  │             │   │              │   │                  │     │
│  │ get()       │   │ 注册点，统一   │   │ 持久化存储        │     │
│  │ set()       │   │ 暴露所有设置   │   │ 作用域: user     │     │
│  │ subscribe() │   │              │   │                  │     │
│  └──────────────┘   └──────────────┘   └──────────────────┘     │
│                                                                  │
│  每个 Actor/Plugin 只做：                                          │
│  1. 定义自己的 SettingsItem(s)                                    │
│  2. 在 Owning Module 里实现 get/set/subscribe                    │
│  3. 注册到 SettingsRegistry (单次)                                │
│                                                                  │
│  不做：                                                           │
│  ❌ 每个 Actor 自己维护 Settings UI                                │
│  ❌ 每个 Actor 自己管理 config_store 读写                          │
│  ❌ 在多个地方注册同一 Actor 的配置项                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### SettingsItem 的 get/set/subscribe 实现模式

每个需要 Settings 的 Actor/Plugin，在自己的 config 模块中提供：

```typescript
// src/config/quota-settings.ts

// 1. 纯前端存储（不需要 RT 的）
export function getQuotaMonitorEnabled(): boolean {
  return localStorage.getItem('quotaMonitorEnabled') === 'true';
}
export function setQuotaMonitorEnabled(v: boolean) {
  localStorage.setItem('quotaMonitorEnabled', String(v));
}

// 2. 需要 RT config_store 的（API key 等敏感配置）
export function getMiniMaxApiKey(): string {
  return runtimeConfigCache.get('exomind:minimaxApiKey') ?? '';
}
export function setMiniMaxApiKey(v: string): void {
  await invoke('runtime_config_put', { scope: 'user', key: 'exomind:minimaxApiKey', value: v });
}

// 3. Subscription（监听 RT 推送或前端状态变化）
export function subscribeMiniMaxApiKeyChanges(cb: (v: string) => void): () => void {
  return runtimeConfigCache.subscribe('exomind:minimaxApiKey', cb);
}
```

#### QuotaMonitor Settings 设计

在 `settings-registry.ts` 中注册：

```typescript
// 属于 'ai' category（2026-04-07 确认：暂不新建 'quota' category）
{
  id: 'quota-monitor-enabled',
  type: 'boolean',
  label: '启用配额监控',
  category: 'ai',
  get: getQuotaMonitorEnabled,
  set: setQuotaMonitorEnabled,
}, {
  id: 'quota-minimax-api-key',
  type: 'string',
  stringStyle: 'dialog',
  sensitive: true,
  dialogTitle: 'MiniMax API Key',
  dialogDescription: '用于查询 MiniMax API 配额',
  placeholder: 'sk-cp-...',
  get: getMiniMaxApiKey,
  set: setMiniMaxApiKey,
  subscribe: subscribeMiniMaxApiKeyChanges,
  mask: (v) => v ? `${v.slice(0,8)}...` : '未配置',
}, {
  id: 'quota-warning-threshold',
  type: 'number',
  label: '预警阈值',
  category: 'ai',
  min: 0,
  max: 10000,
  step: 100,
  get: getQuotaWarningThreshold,
  set: setQuotaWarningThreshold,
}
```

#### RT config_store Key 设计

```
exomind:minimaxApiKey           → API Key (sensitive)
exomind:quotaMonitorEnabled     → boolean
exomind:quotaWarningThreshold   → u32
exomind:quotaHeartbeatIntervalMinutes → u32
exomind:quotaPollingEnabled     → boolean
```

**验收标准**:
- [ ] Settings 页面显示 QuotaMonitor 配置项
- [ ] API Key 保存后 RT 能读到
- [ ] 开启/关闭轮询生效

### Phase 5: ~~前端集成~~（已取消）

> **2026-04-07 更新**：Phase 5 全部取消，不在本次交付范围内。
> - 拓扑节点：AgentHub 主要是 Agent 拓扑，不适合监控组件
> - Sidebar 小面板：可后续独立实现
> - 本次仅交付 Phase 1-4（核心插件 + 信号网络 + HTTP API + Settings 集成）

---

## 实现细节

### MiniMax API 调用（http_client.rs）

```rust
const MINIMAX_QUOTA_API: &str = "https://www.minimax.io/v1/api/openplatform/coding_plan/remains";

#[derive(Debug, Deserialize)]
struct MiniMaxRemainsResponse {
    model_remains: Vec<MiniMaxModelRemain>,
    base_resp: BaseResp,
}

#[derive(Debug, Deserialize)]
struct MiniMaxModelRemain {
    model_name: String,
    current_interval_total_count: u32,
    current_interval_usage_count: u32,  // ⚠️ 这是剩余次数，不是已用
    remains_time: u64,                   // ms
    current_weekly_total_count: u32,
    current_weekly_usage_count: u32,    // ⚠️ 这是剩余次数
    weekly_remains_time: u64,
}

struct BaseResp {
    status_code: i32,
    status_msg: String,
}

// Cloudflare bypass headers
fn build_request_headers(api_key: &str) -> HeaderMap {
    // User-Agent, Referer, Origin 等
}
```

**⚠️ 重要**: `current_interval_usage_count` 在 MiniMax API 中实际上是**剩余次数**，不是已用次数。

### 错误处理策略

| 错误类型 | 处理方式 |
|---------|---------|
| HTTP 4xx | API key 无效，publish `quota.error`，不重试直到 key 更新 |
| HTTP 5xx / 超时 | publish `quota.error`，5min 后重试 |
| 网络不可达 | publish `quota.error`，1min 后重试 |
| JSON parse 失败 | publish `quota.error`，不重试 |

### 启动/停止生命周期

```rust
impl AppState {
    pub fn init_quota_monitor(&self) {
        let Some(api_key) = self.resolve_minimax_api_key() else {
            tracing::info!("QuotaMonitor: no API key configured, skipping");
            return;
        };

        let monitor = QuotaMonitor::new(
            api_key,
            self.signal_pool.clone(),
            self.config_store.clone(),
        );

        // 从 config_store 读取配置
        monitor.set_polling_enabled(self.config_store.get_bool("exomind:quotaPollingEnabled"));
        monitor.set_warning_threshold(self.config_store.get_u32("exomind:quotaWarningThreshold"));
        monitor.set_heartbeat_interval(self.config_store.get_u32("exomind:quotaHeartbeatIntervalMinutes"));

        monitor.start();
        self.quota_monitor.set(monitor);
    }
}
```

---

## 测试计划

1. **单元测试**: `plugins/quota/http_client.rs` Mock HTTP 响应
2. **集成测试**: QuotaMonitor 信号循环（发送 check → 收到响应）
3. **E2E**: 前端设置 API Key → 触发 quota.check → 收到 quota.checked → UI 更新

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| MiniMax API 变卦（字段含义改变） | 注释标注字段含义，测试覆盖 |
| Cloudflare 拦截 | 请求头完整配置，参考已验证 curl 命令 |
| API Key 泄露 | 仅存 config_store，Settings UI 脱敏显示 |
| RT 启动时 API Key 不可用 | 懒加载，API Key 为空时优雅降级 |

---

## 依赖关系

- 无外部依赖
- 需要 `reqwest` (已存在于 Cargo.toml)
- 前端需要新增 `/quota` HTTP 端点调用

---

## 相关 Issue

- #323 (时间块反馈) — QuotaMonitor 可为其提供额度感知能力
- #527 (多设备同步) — 配额状态可纳入同步范围
