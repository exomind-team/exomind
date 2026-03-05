## M4 方案与验收链路（审批版）

本 PR 目标：完成 **RT 内嵌 + Agent Hub + 信号链路端到端 + UI 精调**，作为 M3 构建发版前置。

### 验收映射

1. **RT 内嵌验证**
   - Tauri `setup()` 自动启动 embedded runtime（内嵌运行时）
   - `http://127.0.0.1:4077/health` 返回 `ok`
   - `http://127.0.0.1:4077/signal-routes` 返回路由列表

2. **Agent 自动启动**
   - 启动后自动拉起 `classifier + reviewer`
   - Agent 与 RT SSE 保持连接
   - 若自动启动缺失，补充 `Command::new("bun")` 启动链路（仅必要时）

3. **信号链路端到端**
   - `timeblock.completed` 发布成功
   - Reviewer 生成反馈并发布 `review.completed`
   - 前端 SSE 写入 `EventStorage(type=agent_feedback)`
   - `ChatPage` 紫色 AI 气泡正确渲染

4. **Agent Hub 前端整合**
   - 路由列表来自内嵌 RT 真实数据（非 mock）
   - React Flow 拓扑可拖拽/缩放/自适应
   - 桌面与移动端均可用

5. **UI 精调**
   - 无明显溢出/错位
   - 样式一致性达标
   - 无 `console.error` / warning

---

### 执行策略（TDD + 分步提交）

- 严格执行 `RED -> GREEN -> REFACTOR`（先失败测试，再最小实现）
- 每个 Task 至少一个独立 commit（便于 squash merge）
- 每完成一个 Task 同步进展评论
- 完成后执行代码评审，并把评审结论写入 PR 评论

---

### 计划文档

- `docs/plans/2026-03-04-m4-rt-agent-hub-integration-plan.md`

---

### 待审批

请确认是否按该计划开始执行（批准后进入 Task 2 代码实施）。
