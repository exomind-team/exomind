# [GH#205] Agent Hub 后端实施计划（待审批）

## 先说结论（推荐方案）
采用 **方案 B：后端核心 + 信号池闭环**，即在完成 Issue 原始目标（数据模型、Service、Claude Adapter）的同时，额外补齐 `/agents` 页“连续添加信号输入/输出节点”的最小可用能力，作为下一步“连线 Agent 处理信号”的基础。

---

## 我对现有 `packages/ts-agent-cli/src/agent.ts` 的调研结论

当前实现特点（可复用思想）：
1. `Agent` 主类负责编排，不把 Claude 调用细节散落到业务层。
2. `ClaudeClient` 负责流式读取与事件解析（`ClaudeEvent`），把原始输出转成稳定结构。
3. `State` 负责会话上下文（`sessionId`、工具白名单/黑名单、健康统计）。
4. 发生中断/压缩边界时有恢复策略（继续 prompt + resume session）。

对 #205 的启发：
1. ExoMind 主仓建议继续保持 **Service 编排 + Adapter 解耦**，避免 UI 直接碰 API 细节。
2. 这次先做“无状态 Agent”主线（系统提示词承载记忆），符合你在讨论中提出的可复现设计。
3. 流式能力按统一 `ILLMPort.stream` 出口落地，后续可以无痛替换模型厂商。

---

## 本轮实施范围（按 TDD 执行，分步 commit）
1. 类型层：`src/lib/types/agent.ts`
   - `Agent / Actor / ChatMessage`
   - `SignalNode`（`input|output`）与 `SignalTag`
2. 服务层：`src/lib/services/agent.service.ts`
   - Agent/Actor CRUD
   - Signal Pool CRUD（支持连续新增）
   - 持久化（统一走 `IStoragePort`）
3. 对话层：`src/lib/services/chat.service.ts`
   - `sendMessage / streamMessage / getChatHistory`
   - 聊天记录持久化
4. 适配层：`src/lib/adapters/llm/claude-adapter.ts`
   - 实现 `ILLMPort.complete + ILLMPort.stream`
   - 支持 `baseURL/apiKey/model`
5. #204 联调工具：
   - 生成从 Domain 到 AgentHub 视图模型的 fixture seed
6. 最小联调：
   - `/agents` 页点击“添加信号输入/输出”可连续新增并可见

---

## 验收链路（自动化）
1. Unit（类型、service、adapter、seed、UI 行为）  
2. Playwright（`/agents` 连续新增 input/output 节点）  
3. Build（`bun run build`）  

---

## 风险与处理
1. Claude SSE 事件格式多分支：先按 Messages API 主路径实现 + 单测覆盖异常分支。
2. 当前 `AgentsPage` 仍有直接 `window.location` 跳转：本次不扩大范围，仅做新增节点闭环。
3. 数据迁移：先用 `*_v1` 存储键，避免污染旧 mock 存储。

---

## 需要你审批的一句话
请确认是否按此计划执行（关键词：`批准执行`）。  
若你希望把“信号池标签（tag）策略”也在本轮固化，我会把标签规范一起纳入类型与测试。
