# [GH#205] P0 验收标准与任务清单（可观察现象版）

## 结论（本 PR 目标）
本 PR 固定为 **P0：真实可验收闭环**，聚焦 3 个“可见现象”：
1. 点击信号池内某个信号，可完成真实信号写入与读取（非 mock）。
2. 点击 Agent 节点可进入对话页，并完成真实 Agent 对话（非占位流式文本）。
3. Agent 网络展示真实在线状态（来源于探测/心跳，而非静态 fixture）。

同时保留 RuntimeHost 多设备接入与 Tauri 托管服务目标（单 PR 完成 P0）。

---

## P0 验收标准（必须全部通过）

### AC-1 真实信号读写（Signal R/W）
- 在 `/agents` 信号池中点击任一信号输入节点，执行“写入测试信号”。
- UI 立即显示写入成功，且可点击“读取最新信号”读取回显内容。
- 数据源为真实存储（EventLog/PouchDB/Tauri 命令），不是内存临时数组。
- 自动化证据：
  - Unit：`signal.service` 写入后可读回
  - E2E：页面点击写入 -> 读取 -> 文本断言通过

### AC-2 真实 Agent 对话（Real Chat）
- 在 `/agents` 点击 Agent 节点进入 `/agents/chat/$agentId`。
- 发送消息后，返回内容来自真实 runtime 端口（RuntimeHost API / stream），非 `placeholder response`。
- 对话历史刷新后仍存在（持久化通过）。
- 自动化证据：
  - Unit：`chat.service` 调用 runtime adapter 并持久化
  - E2E：输入消息后出现真实回复片段 + 刷新页面后历史仍在

### AC-3 真实在线状态（Online Status）
- 设备页可显示 RuntimeHost 在线/离线/异常状态，状态变化有时间戳。
- Agent 网络节点状态由真实探测结果驱动（心跳 TTL/探测失败回退），不是静态写死。
- 自动化证据：
  - Unit：状态机/TTL 过期测试
  - E2E：模拟主机断连后状态从 online -> offline

### AC-4 配置与托管（Runtime Config + Tauri Host）
- 设置页可配置 Host/Port/AutoStart，并立即影响探测与连接。
- Tauri 桌面端可显示服务启停状态（start/stop/status），替代手工命令行观测。
- 自动化证据：
  - Unit：配置持久化 + 命令映射
  - 手工验证：桌面端点击启停后状态变化可见

### AC-5 发布门槛（Release Gate）
- `bun vitest`（本次新增用例）通过。
- `bun run test:e2e:issue205` 通过。
- `bun run build` 通过。

---

## P0 任务清单（按 TDD + 每步 commit）

### Task 1: 信号池真实读写闭环
- 新增 `signal.service`（或在 `agent.service` 扩展）实现真实写入/读取。
- 将信号节点点击行为接入读写动作（UI 有可见反馈）。
- 先补失败测试，再实现。

### Task 2: Agent 真实对话链路
- 增加 RuntimeHost chat adapter（HTTP/SSE）并接入 `AgentHubService.streamConversation`。
- 替换当前 web/mock 占位回复路径，保留 mock 仅作回退。
- 对话历史持久化与恢复测试补齐。

### Task 3: 在线状态真实化
- 新增 RuntimeHost 探测 + 心跳 TTL 状态机（online/offline/warning）。
- 设备页与 Agent 网络节点状态绑定真实状态源。

### Task 4: Tauri 托管与设置页联动
- 增加 `runtime_service_start/stop/status` 命令并注入 `invoke_handler`。
- 设置页增加 RuntimeHost 配置项，保存后触发状态刷新。

### Task 5: 自动化验收
- Unit：signal/chat/status/config/tauri command。
- E2E：信号写读、节点跳转真实对话、在线状态切换。

### Task 6: 评审与证据评论
- 更新进度评论与评审评论（命令 + 结果 + 风险）。
- 评论同步到 Issue #205 与 PR #251。

---

## P1（拆分到新 PR，不在本 PR 实现）
1. Agent 级细粒度健康指标（token/cost/latency 面板）。
2. 多 RuntimeHost 负载均衡与故障转移策略。
3. Signal 路由可视化编排（批量规则、重试策略、回放）。
4. 多模型供应商策略与成本路由。

---

## 风险与控制
1. **真实对话外部依赖风险**：提供 mock 回退开关，但默认走真实链路。
2. **状态抖动风险**：加入 TTL + 连续失败阈值，避免一跳离线。
3. **跨端行为差异**：Web/Tauri 共享 service 契约，Tauri 仅补托管命令层。
