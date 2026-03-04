## M1 方案确认（exomind-runtime 内嵌 Tauri）

### 一、目标（Goal，目标）
- 将 `exomind-runtime` 从外部 Bun 进程改为 Tauri 进程内嵌（in-process runtime，进程内运行时）。
- `SignalPool` 在 Tauri 进程内运行，前端能力保持可用，优先保障桌面端验证链路。
- 保持可替换传输层（transport channel，可替换通道）：`invoke` 高频优先，HTTP 可降级。

### 二、关键决策（Decisions，决策）
- **默认 RT 端口**：`1947`（支持 `EXOMIND_RT_PORT=0` 随机端口）。
- **M1.1**：`crates/exomind-runtime` 保持 `lib.rs` 为核心导出，`main.rs` 仅作为 thin wrapper（薄包装）。
- **M1.2**：`src-tauri/src/lib.rs` 的 `setup()` 中自动启动 RT（`tokio::spawn`）。
- **M1.3**：默认加入 `invoke` 高频桥接（如 signal publish），并保留 HTTP fallback（降级）。
- **M1.4**：RT 启动后自动拉起 TS Agent 子进程：`reviewer` + `classifier`，并注入 `EXOMIND_RT_URL`。

### 三、验收链路（Acceptance Chain，验收路径）
1. 启动桌面端：
   - `cargo tauri dev`
2. 验证健康检查：
   - `curl http://127.0.0.1:1947/health` 返回 `status=ok`
3. 验证 SignalPool：
   - publish → route → SSE/history 可观测
4. 验证回归：
   - `cargo test -p exomind-runtime`
   - `bun run build`
   - 相关 Vitest/Playwright 用例通过
5. 验证前端功能不回退：
   - EventLog / Tasks / Agent Chat 可正常使用

### 四、风险与降级（Risk & Fallback，风险与降级）
- 若内嵌复杂度超预期（截止 14:00 未跑通）：
  - 降级为 Tauri spawn `exomind-rt.exe` 二进制（不再依赖 Bun server 脚本）。
  - 前端接口保持兼容，确保本轮可交付。

### 五、提交与评审策略（Commit & Review，提交与评审）
- 按 TDD 执行：先失败测试（RED）→ 最小实现（GREEN）→ 重构（REFACTOR）。
- 每个任务一个独立 commit（便于 PR squash merge）。
- 每个里程碑输出测试证据与评审结论，并同步到 PR 评论。

