# v0.3.4 里程碑计划

> **截止时间**：2026-03-04 17:00
> **目标**：Tauri 内嵌 Rust RT + SignalPool 集成 + Agent Hub 真实数据 + 双平台发版

---

## 一、背景

v0.3.3 的 SignalPool 代码已在 dev 分支实现（bus/route_table/journal/window/actors/agents），但 Tauri App 仍启动旧的 JS 探测服务器（`bun server/agent-runtime-server.js`），用户打开 App 无法使用 SignalPool。

本次里程碑将 exomind-runtime 从外部进程改为 Tauri 内嵌库，一个 binary 搞定一切。

---

## 二、任务总览

| ID | 任务 | 优先级 | 预估 | Worktree |
|----|------|--------|------|----------|
| **M1** | RT 内嵌 Tauri（大重构） | P0 | 3-4h | Worktree A |
| **M2** | Agent Hub 前端（列表+拓扑图） | P1 | 2-3h | Worktree B |
| **M3** | 构建发版（版本号+Win+APK） | P1 | 1-2h | 主线（M1+M2 合并后） |

**并行策略**：M1 和 M2 在不同 worktree 并行开发。M2 先用 HTTP 直连 RT（`localhost:4077`）开发，内嵌后无缝切换。

---

## 三、M1: exomind-runtime 内嵌 Tauri

### M1.1: Cargo workspace 重组

**目标**：`exomind-runtime` 同时导出 lib（给 Tauri 链接）和 binary（独立运行）。

**改动**：

1. `crates/exomind-runtime/Cargo.toml`：
   ```toml
   [lib]
   name = "exomind_runtime"
   path = "src/lib.rs"

   [[bin]]
   name = "exomind-rt"
   path = "src/main.rs"
   ```

2. `src/lib.rs` 导出公共 API：
   ```rust
   pub mod signal;
   pub mod agent;
   pub mod routes;

   pub async fn start_server(host: &str, port: u16) -> Result<(), Box<dyn std::error::Error>> {
       // 现有 main.rs 的核心逻辑移到这里
   }
   ```

3. `src/main.rs` 变为 thin wrapper：
   ```rust
   #[tokio::main]
   async fn main() {
       exomind_runtime::start_server("127.0.0.1", 4077).await.unwrap();
   }
   ```

**验证**：
```bash
cargo build -p exomind-runtime          # lib 编译通过
cargo build -p exomind-runtime --bin exomind-rt  # binary 也能编译
cargo test -p exomind-runtime           # 测试通过
```

### M1.2: Tauri 内嵌启动

**改动**：

1. `src-tauri/Cargo.toml` 添加依赖：
   ```toml
   [dependencies]
   exomind-runtime = { path = "../crates/exomind-runtime" }
   ```

2. `src-tauri/src/lib.rs` setup 钩子：
   ```rust
   .setup(|app| {
       // 在后台 tokio 任务中启动 RT
       tauri::async_runtime::spawn(async {
           if let Err(e) = exomind_runtime::start_server("127.0.0.1", 4077).await {
               eprintln!("RT startup failed: {e}");
           }
       });
       Ok(())
   })
   ```

3. 删除或标记弃用 `runtime_commands.rs` 中的 `runtime_service_start`（不再需要 spawn 外部进程）。

**验证**：
```bash
cargo tauri dev
# App 启动后自动跑 RT
curl http://127.0.0.1:4077/health  # 应返回 OK
curl http://127.0.0.1:4077/signal-routes  # 应返回路由列表
```

### M1.3: IPC 桥接（渐进迁移，本次可跳过）

保持前端通过 HTTP 调用 RT（`localhost:4077`）。IPC 桥接作为后续优化，不阻塞发版。

### M1.4: TS Agent 随 RT 启动

**改动**：在 RT 启动成功后，spawn TS agent 子进程：

```rust
// start_server() 成功后
std::process::Command::new("bun")
    .arg("packages/ts-agent-cli/agents/reviewer/index.ts")
    .spawn()
    .ok();
std::process::Command::new("bun")
    .arg("packages/ts-agent-cli/agents/classifier/index.ts")
    .spawn()
    .ok();
```

或在 Tauri setup 中做，位置灵活。

**验证**：Agent 进程存在，SSE 连接 RT，发 `timeblock.completed` 信号能收到 `review.completed` 回复。

---

## 四、M2: Agent Hub 前端

### M2.1: 信号路由列表视图

**数据源**：`GET http://localhost:4077/signal-routes`

**UI 位置**：AgentsPage 新增 "Signal Routes" Tab（与现有 topology/list/device 并列）

**展示内容**：
```
┌──────────────────────────────────────────────────┐
│ Signal Routes (5)                                │
├──────────────────────────────────────────────────┤
│ user.input.text  →  🤖 classifier (agent)       │
│ user.input.text  →  📋 eventlog (actor)         │
│ input.classified →  ✅ task (actor)              │
│ session.end      →  🤖 reviewer (agent)         │
│ *                →  🖥️ ui (frontend)             │
│ timeblock.completed → 🤖 reviewer (agent)       │
└──────────────────────────────────────────────────┘
```

### M2.2: React Flow 拓扑图

**节点类型**：
- **Signal Topic**（椭圆，蓝色）：`user.input.text`, `input.classified`, `session.end` 等
- **Agent**（矩形，绿色）：classifier, reviewer
- **Actor**（圆角矩形，橙色）：eventlog, task
- **Frontend**（菱形，紫色）：ui

**边**：路由关系，带方向箭头，从 topic → target

**数据聚合**：
```typescript
// 从两个端点聚合
const routes = await fetch('/signal-routes').then(r => r.json());
const agents = await fetch('/agents').then(r => r.json());
// 构建 React Flow nodes + edges
```

**参考现有代码**：AgentsPage 已有 `@xyflow/react` 拓扑视图，复用布局框架。

---

## 五、M3: 构建发版

### M3.1: 版本号 bump

```bash
# package.json
"version": "0.3.4"

# src-tauri/tauri.conf.json
"version": "0.3.4"
```

### M3.2: Windows 构建

```bash
cargo tauri build
# 产物：src-tauri/target/release/bundle/msi/ExoMind_0.3.4_x64.msi
```

### M3.3: Android APK

```bash
cargo tauri android build
# 产物：src-tauri/gen/android/app/build/outputs/apk/
```

### M3.4: 发版

```bash
git tag v0.3.4
git push origin v0.3.4
gh release create v0.3.4 --title "v0.3.4: SignalPool 内嵌 + Agent Hub" \
  --notes "..." \
  path/to/msi path/to/apk
```

---

## 六、时间线

```
08:30 ── 计划确认 + 看板清场
09:00 ── M1 开工（Worktree A）
09:00 ── M2 开工（Worktree B，并行）
12:00 ── M1 检查点：RT 内嵌是否跑通？
         ├─ 跑通 → 继续 M1.4（Agent 启动）
         └─ 未通 → 14:00 前降级为 spawn 方案
13:00 ── M2 检查点：列表视图完成，开始拓扑图
15:00 ── M1 + M2 合并到 dev
15:30 ── M3：版本号 bump + 构建
16:30 ── 验收测试（Windows 安装 + APK 安装）
17:00 ── 发版 v0.3.4 🎉
```

---

## 七、降级方案

| 风险 | 触发条件 | 降级措施 |
|------|---------|---------|
| M1 内嵌超时 | 14:00 未跑通 | 改为 Tauri spawn `exomind-rt.exe`（1h） |
| M2 拓扑图超时 | 15:00 未完成 | 只发列表视图，拓扑图 v0.3.5 |
| Windows 构建失败 | 编译错误 | 只发 APK，Windows v0.3.5 |
| Android 构建失败 | NDK 问题 | 只发 Windows，APK v0.3.5 |

---

## 八、Vibe Kanban 任务 ID

| Kanban ID | 任务 |
|-----------|------|
| 里程碑 | EXO-66 |
| M1 | EXO-67 |
| M2 | EXO-68 |
| M3 | EXO-69 |

## 九、相关文件索引

| 文件 | 用途 |
|------|------|
| `crates/exomind-runtime/src/lib.rs` | M1.1: 导出核心模块 |
| `crates/exomind-runtime/src/main.rs` | M1.1: thin wrapper |
| `src-tauri/Cargo.toml` | M1.2: 添加 runtime 依赖 |
| `src-tauri/src/lib.rs` | M1.2: setup 钩子 |
| `src-tauri/src/commands/runtime_commands.rs` | M1.2: 替换/弃用 |
| `config/signal-routes.default.json` | 默认路由（6 条） |
| `packages/ts-agent-cli/agents/reviewer/index.ts` | M1.4: 自动启动 |
| `packages/ts-agent-cli/agents/classifier/index.ts` | M1.4: 自动启动 |
| `src/ui/app/pages/AgentsPage.tsx` | M2: Agent Hub 页面 |
| `package.json` | M3.1: 版本号 |
| `src-tauri/tauri.conf.json` | M3.1: 版本号 |
