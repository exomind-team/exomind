## M1 评审闭环补充（Subagent Review Follow-up）

### 初审结论（子代理）
- 子代理初审指出的高优先项：
  1. `signal_publish_fast` 持锁范围过大（高频串行化风险）
  2. `setup()` 固定 host/port，覆盖 env（`EXOMIND_RT_PORT=0` 语义不生效）
  3. 并发启动竞争下可能误报失败（start race）
  4. TS agent 启动目录与日志可观测性不足

### 已修复提交
- `6334f51`：`setup` 改为 `ensure_runtime_started(None, None)`，遵循 env/default；补充启动竞争重查逻辑
- `592e14d`：快速发布改为先 clone `SignalPool` 再发布（缩小锁范围）；支持 `EXOMIND_RT_AGENT_WORKDIR`；`stderr` 继承便于诊断

### 复核结果（合并门禁）
- 复核结论：**未发现阻塞合并问题**（M1 范围内）。
- 残余风险（非阻塞）：
  - 现有 `issue204/issue205` Playwright 用例仍有历史性失败，需要单独 issue 处理；
  - 端口常量在 TS 侧仍可进一步收敛为单一常量源（技术债优化项）。

### 复核后再验证（已执行）
```powershell
cargo test -p exomind-runtime
cargo check -p exomind
bun run test -- tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/signal-stream-fast-publish.m1.test.ts tests/unit/tauri/runtime-commands.issue205.test.ts tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
bun run build
```

以及桌面端启动链路：
- `cargo tauri dev --no-watch` → `http://127.0.0.1:1949/health` 返回 OK
- publish 成功
- 关闭后端口下线

