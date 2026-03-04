# M1 Embedded Runtime in Tauri Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `exomind-runtime` 从外部进程模式改成 Tauri 进程内嵌运行（in-process runtime，进程内运行时），并交付 `invoke 高频桥接 + HTTP fallback（降级）`。

**Architecture:** `crates/exomind-runtime` 提供可复用 `lib` 启动入口（start API，启动接口）与句柄（handle，运行句柄）；`src-tauri` 在 `setup()` 内 `tokio::spawn` 启动 RT；前端保持现有 HTTP 调用链不破坏，同时新增 `invoke` 快速通道用于高频 publish。RT 默认端口统一为 `1949`，并允许 `port=0` 随机分配。

**Tech Stack:** Rust (axum/tokio/tauri), TypeScript (React/Vitest/Playwright), Bun (TS Agent 子进程), GitHub CLI (`gh`)

---

## Scope / Non-Scope（范围 / 非范围）

- Scope（本轮包含）
  - M1.1 crate 重构为可复用 lib + thin `main.rs`
  - M1.2 Tauri `setup()` 内嵌 RT 启动
  - M1.3 `invoke` 高频桥接 + HTTP fallback
  - M1.4 TS `reviewer + classifier` 随 RT 启动与退出
  - 端口默认改为 `1949`（并支持随机端口）
- Non-Scope（本轮不包含）
  - 全面替换前端所有 HTTP 调用为 invoke（只改高频 publish）
  - Web-only WASM 正式交付（仅保留兼容路径与后续接口）

---

### Task 1: Freeze Contracts + Baseline Verification（冻结契约与基线验证）

**Files:**
- Modify: `artifacts/pr-comments/2026-03-04-m1-plan-comment.md`
- Modify: `docs/plans/2026-03-04-m1-embedded-runtime-tauri-plan.md`
- Verify: `crates/exomind-runtime/`, `src-tauri/`, `src/lib/services/`

**Step 1: Create plan comment markdown（先写方案评论）**

```md
## M1 方案与验收链路
- 默认端口: 1949（可设置 0 随机）
- 内嵌模式: Tauri setup() 启动 RT
- 高频 publish: invoke 优先，HTTP 降级
```

**Step 2: Baseline tests before implementation（编码前基线测试）**

Run:
```powershell
cargo test -p exomind-runtime
bun run build
```

Expected:
- 当前分支全部通过或记录明确失败点（若已有历史失败需注明与本任务无关）

**Step 3: Commit plan artifacts**

Run:
```powershell
git add docs/plans/2026-03-04-m1-embedded-runtime-tauri-plan.md artifacts/pr-comments/2026-03-04-m1-plan-comment.md
git commit -m "docs: add M1 embedded runtime implementation plan and PR comment draft"
```

---

### Task 2: Runtime lib entrypoint（Runtime 库入口）TDD

**Files:**
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `crates/exomind-runtime/src/main.rs`
- Create: `crates/exomind-runtime/tests/runtime_startup.test.rs`（若仓库命名风格要求可改名）
- Modify: `crates/exomind-runtime/Cargo.toml`（必要时补 feature/deps）

**Step 1: Write failing tests（先写失败测试）**

Test targets:
- `start_with_options()` 返回可观察句柄（startup handle，启动句柄）
- 默认端口为 `1949`
- `port=0` 时可随机端口，且可通过 `local_addr` 读取实际端口
- actor（`task_actor` / `eventlog_actor`）随 runtime 启动

**Step 2: Run test to verify RED（确认失败）**

Run:
```powershell
cargo test -p exomind-runtime runtime_startup -- --nocapture
```

Expected:
- FAIL，失败原因是 `start` API 尚未实现或行为不符

**Step 3: Minimal implementation（最小实现）**

Implementation outline:
```rust
pub struct RuntimeHandle { /* server task + actor task + ts agent process handles */ }
pub struct RuntimeStartOptions { pub host: String, pub port: u16, ... }
pub async fn start_with_options(opts: RuntimeStartOptions) -> Result<RuntimeHandle, RuntimeError>;
```

**Step 4: Re-run targeted tests（确认转绿）**

Run:
```powershell
cargo test -p exomind-runtime runtime_startup -- --nocapture
```

Expected:
- PASS

**Step 5: Keep binary thin wrapper（保持 main 精简）**
- `main.rs` 仅解析 env + 调 `start_with_options()` + `wait()`

**Step 6: Commit**

Run:
```powershell
git add crates/exomind-runtime/src/lib.rs crates/exomind-runtime/src/main.rs crates/exomind-runtime/tests/runtime_startup.test.rs crates/exomind-runtime/Cargo.toml
git commit -m "feat(runtime): expose reusable start API and thin binary wrapper"
```

---

### Task 3: Embed runtime in Tauri setup()（Tauri 内嵌启动）TDD

**Files:**
- Modify: `Cargo.toml`（workspace deps，可选）
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create/Modify: `src-tauri/src/runtime_embed.rs`（如需解耦）
- Test: `tests/unit/tauri/runtime-commands.issue205.test.ts`（契约保持）

**Step 1: Write failing Rust/TS tests（先写失败测试）**

Test targets:
- Tauri app `setup()` 会自动拉起 RT（无需调用 start command）
- setup 后状态可读（host/port/running）

**Step 2: Verify RED**

Run:
```powershell
bun test tests/unit/tauri/runtime-commands.issue205.test.ts
```

Expected:
- FAIL（旧行为是手动按钮启动）

**Step 3: Implement setup embedding（实现 setup 内嵌）**
- `src-tauri/Cargo.toml` 引入 `exomind-runtime`（workspace dependency，工作区依赖）
- `setup()` 中 `tokio::spawn` 启动 runtime，默认 `127.0.0.1:1949`
- 支持 `EXOMIND_RT_PORT=0` 随机端口，并把实际端口写入共享状态

**Step 4: Verify GREEN**

Run:
```powershell
bun test tests/unit/tauri/runtime-commands.issue205.test.ts
```

Expected:
- PASS

**Step 5: Commit**

Run:
```powershell
git add Cargo.toml src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/runtime_embed.rs tests/unit/tauri/runtime-commands.issue205.test.ts
git commit -m "feat(tauri): start embedded exomind-runtime in setup hook"
```

---

### Task 4: Replace runtime commands semantics（命令语义迁移）TDD

**Files:**
- Modify: `src-tauri/src/commands/runtime_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/adapters/tauri-runtime-adapter.ts`
- Modify: `src/lib/services/runtime-control.service.ts`（如需）
- Modify: `tests/unit/services/runtime-control.service.issue205.test.ts`
- Modify: `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

**Step 1: Write failing tests**

Targets:
- `runtime_service_start` 在内嵌模式下幂等（idempotent，重复调用不重复启动）
- `runtime_service_status` 返回 setup 已启动状态
- `runtime_service_stop` 可控关闭（仅桌面端）
- 默认端口改为 `1949`

**Step 2: Verify RED**

Run:
```powershell
bun test tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx
```

**Step 3: Implement command migration**
- 去掉 `spawn bun server/agent-runtime-server.js`
- 命令改为控制/查询内嵌 runtime handle
- 维持前端接口不变（API 兼容）

**Step 4: Verify GREEN**

Run:
```powershell
bun test tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx
```

**Step 5: Commit**

Run:
```powershell
git add src-tauri/src/commands/runtime_commands.rs src-tauri/src/lib.rs src/lib/adapters/tauri-runtime-adapter.ts src/lib/services/runtime-control.service.ts tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx
git commit -m "refactor(runtime): migrate runtime control commands to embedded mode"
```

---

### Task 5: Invoke bridge + HTTP fallback（高频桥接 + 降级）TDD

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/signal_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/services/signal-stream.service.ts`
- Modify: `src/lib/services/timeblock.service.ts`
- Test: `tests/unit/services/signal-stream.service.test.ts`

**Step 1: Write failing tests**

Targets:
- 在 Tauri 环境优先 `invoke('signal_publish_fast')`
- invoke 失败时自动 fallback 到 HTTP `POST /signals/publish`
- 非 Tauri 环境保持 HTTP 行为

**Step 2: Verify RED**

Run:
```powershell
bun test tests/unit/services/signal-stream.service.test.ts
```

**Step 3: Implement minimal bridge**
- Rust command 直接调用 `signal_pool.publish`
- TS publish 流程：`invoke -> catch -> fetch`

**Step 4: Verify GREEN**

Run:
```powershell
bun test tests/unit/services/signal-stream.service.test.ts
```

**Step 5: Commit**

Run:
```powershell
git add src-tauri/src/commands/mod.rs src-tauri/src/commands/signal_commands.rs src-tauri/src/lib.rs src/lib/services/signal-stream.service.ts src/lib/services/timeblock.service.ts tests/unit/services/signal-stream.service.test.ts
git commit -m "feat(signal): add invoke fast-path with HTTP fallback for publish"
```

---

### Task 6: TS agents auto-spawn with runtime（TS Agent 自启动）TDD

**Files:**
- Modify: `crates/exomind-runtime/src/lib.rs`（或拆到 `runtime/agents.rs`）
- Modify: `packages/ts-agent-cli/agents/classifier/index.ts`（默认端口文案）
- Modify: `packages/ts-agent-cli/agents/reviewer/index.ts`（默认端口文案）
- Create/Modify: `crates/exomind-runtime/tests/runtime_agents_spawn.test.rs`

**Step 1: Write failing tests**

Targets:
- runtime 启动时 spawn `classifier` + `reviewer`
- 进程环境变量带 `EXOMIND_RT_URL=http://127.0.0.1:<port>`
- runtime 停止时子进程同步退出

**Step 2: Verify RED**

Run:
```powershell
cargo test -p exomind-runtime runtime_agents_spawn -- --nocapture
```

**Step 3: Implement spawn/teardown**
- `tokio::process::Command` 拉起 Bun 子进程
- 进程句柄纳入 `RuntimeHandle`
- 失败隔离（spawn 一个失败不应导致主服务崩溃）

**Step 4: Verify GREEN**

Run:
```powershell
cargo test -p exomind-runtime runtime_agents_spawn -- --nocapture
```

**Step 5: Commit**

Run:
```powershell
git add crates/exomind-runtime/src/lib.rs crates/exomind-runtime/tests/runtime_agents_spawn.test.rs packages/ts-agent-cli/agents/classifier/index.ts packages/ts-agent-cli/agents/reviewer/index.ts
git commit -m "feat(runtime): auto-spawn reviewer and classifier with embedded runtime"
```

---

### Task 7: End-to-end verification + PR update（端到端验收 + PR 更新）

**Files:**
- Modify: `artifacts/pr-comments/2026-03-04-m1-test-evidence.md`
- Modify: `artifacts/pr-comments/2026-03-04-m1-review-result.md`
- Modify: `README.md` / `docs/development/*.md`（如端口或运行命令有变化）

**Step 1: Run required verification chain**

Run:
```powershell
cargo test -p exomind-runtime
bun test tests/unit/tauri/runtime-commands.issue205.test.ts
bun test tests/unit/services/runtime-control.service.issue205.test.ts
bun test tests/unit/services/signal-stream.service.test.ts
bun run build
```

Expected:
- 全部通过；若有非本任务失败项，列入 PR comment 的 “Known Issues（已知问题）”

**Step 2: Desktop runtime smoke（桌面端冒烟）**

Run:
```powershell
cargo tauri dev
curl http://127.0.0.1:1949/health
curl http://127.0.0.1:1949/signals/history?limit=1
```

Expected:
- `health` 返回 `status=ok`
- SignalPool 接口可用

**Step 3: Playwright validation（在用户启动 dev server 后执行）**

Run:
```powershell
bunx playwright test -c tests/e2e/playwright.signal-pool.config.ts
```

**Step 4: PR comment + description update**

Run:
```powershell
gh pr comment <PR_NUMBER> --body-file artifacts/pr-comments/2026-03-04-m1-test-evidence.md
gh pr comment <PR_NUMBER> --body-file artifacts/pr-comments/2026-03-04-m1-review-result.md
gh pr edit <PR_NUMBER> --body-file artifacts/pr-comments/2026-03-04-m1-pr-description.md
```

**Step 5: Request review and record review result**
- 发起代码评审（code review，代码审查）
- 修复 Critical/Important 问题后再次附证据

**Step 6: Final commit(s)**

Run:
```powershell
git add artifacts/pr-comments README.md docs/development
git commit -m "docs: add M1 verification evidence and review summary"
```

---

## Runtime Env + Startup Commands（运行环境变量与启动命令）

### Desktop preferred validation（桌面端优先）

```powershell
# Runtime (RT) default port（默认端口）
$env:EXOMIND_RT_PORT='1949'
$env:EXOMIND_RT_BIND='127.0.0.1'

# Optional random port（随机端口，可选）
# $env:EXOMIND_RT_PORT='0'

# TS agent runtime URL（供 reviewer/classifier 使用）
$env:EXOMIND_RT_URL='http://127.0.0.1:1949'

# Start desktop app
cargo tauri dev
```

### Web mode note（Web 模式说明）

- 本轮优先验证桌面端。
- Web-only 路径后续可通过 WASM/runtime adapter 演进；本轮保持 HTTP 路由兼容，不阻塞 UI Summary 信号链路。

---

## Rollback / Downgrade（降级方案）

若 14:00 前内嵌链路仍不稳定：
- 启用降级：Tauri 侧改为 spawn `exomind-rt.exe`（不再 spawn Bun JS server）。
- 仍保留同一 API 契约：`/health`, `/signals/*`, `/agents/*`，确保前端与测试不改或少改。

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-04-m1-embedded-runtime-tauri-plan.md`.  
Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints.

Which approach?


