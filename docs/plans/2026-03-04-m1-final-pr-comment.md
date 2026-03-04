## M1 完成汇报：exomind-runtime 内嵌 Tauri（含评审闭环）

### 1. 方案与实现范围（Plan → Execute）
- M1.1：`exomind-runtime` 完成 lib 化，`main.rs` 变 thin wrapper。
- M1.2：Tauri `setup()` 自动内嵌启动 Runtime，替代外部 bun 子进程启动链路。
- M1.3：新增 `invoke` 高频通道 `signal_publish_fast`，保留 HTTP fallback。
- M1.4：Runtime 启动后自动拉起 TS agents（reviewer/classifier）。
- 端口策略：默认 `1949`；`EXOMIND_RT_PORT=0` 允许随机端口（auto port）。

### 2. 关键提交（按里程碑）
- `29b9696` feat(runtime): add reusable startup API and default port 1949
- `5931edb` feat(tauri): embed runtime with invoke fast publish and port 1949 defaults
- `433759c` docs(plan): align M1 runtime default port to 1949
- `6334f51` fix(tauri): honor RT env defaults and harden embedded runtime start race
- `592e14d` fix(runtime): address review findings for fast publish and agent startup

### 3. 自动化测试证据（Verification）
已执行并通过：

```powershell
cargo test -p exomind-runtime
cargo check -p exomind
bun run test -- tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/signal-stream-fast-publish.m1.test.ts tests/unit/tauri/runtime-commands.issue205.test.ts tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
bun run build
```

结果摘要：
- Rust runtime 测试：`88 passed, 0 failed`
- Tauri crate check：通过
- 相关 Vitest：`17 passed, 0 failed`
- 前端构建：通过

### 4. 桌面端实测证据（cargo tauri dev）
验证链路：
1. 启动 `cargo tauri dev --no-watch`
2. `GET http://127.0.0.1:1949/health` 返回 `{"status":"ok","version":"0.1.0"}`
3. `POST /signals/publish` 返回 `accepted=true`
4. 关闭进程后再次访问 health，确认端口下线（`POST_STOP_HEALTH=down`）

### 5. Playwright 自动化
通过（与信号池链路直接相关）：

```powershell
# 启动 exomind-rt 后执行
bunx playwright test tests/e2e/signal-pool-classification.test.ts --config playwright.config.ts --reporter=line
```

结果：`4 passed`

已记录的现有失败（非本次 M1 新增）：
- `bun run test:e2e:issue204`：1/3 fail（断言文案 `从市场安装` 不存在）
- `bun run test:e2e:issue205`：1/1 fail（`page.goto('/agents')` 超时）

### 6. Subagent 评审结果与修复
已使用子代理做审查（`sonnet` + `gpt-5.1`），审查重点为生命周期、并发、端口一致性、快速通道可靠性。

子代理重点意见（已修复）：
- `signal_publish_fast` 持锁过久（高频发布串行化风险）
  - 修复：提取 `SignalPool` clone 后释放锁再发布（`592e14d`）
- `setup()` 路径写死导致 env 覆盖（`EXOMIND_RT_PORT=0` 无法生效）
  - 修复：`setup()` 改为 `ensure_runtime_started(None, None)`，遵循 env/default（`6334f51`）
- 并发启动竞争（start race）误报失败
  - 修复：启动失败后加短轮询重查运行状态（`6334f51` / `592e14d`）
- TS agent 目录与日志可观测性
  - 修复：支持 `EXOMIND_RT_AGENT_WORKDIR`，默认回退 `current_dir`；agent `stderr` 改为 `inherit`（`592e14d`）

当前结论：
- M1 验收主链路已跑通，未发现阻塞本里程碑合并的问题。

### 7. 手工复测命令（给 Reviewer / QA）
```powershell
# 可选：显式指定（默认就是 1949）
$env:EXOMIND_RT_PORT='1949'
$env:EXOMIND_RT_BIND='127.0.0.1'
$env:EXOMIND_RT_URL='http://127.0.0.1:1949'

# 可选：随机端口模式（0=random）
# $env:EXOMIND_RT_PORT='0'

# 可选：TS agent 工作目录（建议在桌面调试时设置）
$env:EXOMIND_RT_AGENT_WORKDIR='D:\project\exomind'

# 启动桌面端（自动内嵌 RT）
cargo tauri dev --no-watch

# 健康检查（默认端口）
curl http://127.0.0.1:1949/health

# 发布信号
curl -X POST http://127.0.0.1:1949/signals/publish -H "Content-Type: application/json" -d "{\"topic\":\"manual.smoke\",\"source\":\"qa\",\"payload\":{\"text\":\"hello\"}}"
```

