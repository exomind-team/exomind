# timeblock_summary Agent 开发经验与规范

> 来源：2026-06-05 会话实战总结
> 适用范围：ExoMind Runtime 内置 Agent 开发、Broker API 设计、Session 录制、能量系统

---

## 一、核心设计原则

### 1. Broker 是数据管道，不是过滤器

> 「broker 绝对不能丢，具体决定丢不丢应该是调用方处理的事情。broker 这种属于严重的自作主张。」

- Broker 负责传递 API 响应的**全部数据**，不做任何裁剪
- 调用方（Agent 逻辑层）决定哪些数据有用、哪些可以忽略
- 新增内容类型时，Broker 无需修改——`ContentBlock` 的 `block_type` 字段天然前向兼容

**反例**：旧代码 `parse_anthropic_completion` 中 `_ => {}` 丢弃所有非 text/tool_use 块

**正例**：`ContentBlock` 保留 thinking/redacted_thinking/refusal/未来新类型

### 2. 能量消耗必须与实际工作量挂钩

- 固定每轮消耗 1 点不合理：纯文本回复和长推理消耗差异巨大
- 按内容消耗：text `ceil(len/256)`，thinking `ceil(len/512)`，tool_use `1`
- 动态初始值：根据时间块特征（正常/超时/pause）调整预算
- 一次性预算：成功后不 replenish，避免无限循环

### 3. 先分析后提交，不是必须调用

- 系统提示词不能写「必须调用 submit_timeblock_summary」——这会让 Agent 急着调用工具而不做分析
- 应该强调：submit_timeblock_summary 是**分析完成后的输出手段**，不是分析本身
- 「提交时机」子节明确要求完成所有分析步骤后再调用

### 4. Session 录制必须完整

- Agent 的每一次行为都必须被记录：思考过程（thinking）、文本回复（text）、工具调用（tool_use）
- Session 的 `content` 字段：当 LLM 只返回 tool_calls 无 text 时，用工具返回值填充
- Session 的 `tool_calls` 字段：从 history 的 `TurnItem::Assistant` 提取，不能硬编码 `Vec::new()`
- Session 的 `content_blocks` 字段：完整传递，不丢失

---

## 二、编码规范

### 1. 新增字段时的全链路检查

新增一个字段到核心类型时，必须检查以下链路：

| 环节 | 检查项 |
|------|--------|
| 类型定义 | `struct` 新增字段，`serde` 属性正确 |
| Default impl | `impl Default` 补充新字段 |
| 构造器 | 所有 `Type { ... }` 构造处补充新字段 |
| 序列化 | SQLite schema / JSON 序列化兼容 |
| 前端消费 | API 响应是否包含新字段 |
| 测试 | 新增或更新对应测试 |

**本次教训**：新增 `content_blocks` 到 `AgentSessionRecord` 后，遗漏了 `life.rs` 中 6 处构造器。

### 2. TDD 用于 Bug 修复

- 提取可测试的纯函数（如 `build_session_record`）
- 先写失败测试，再修复
- 测试覆盖正常路径 + 边界情况

**本次实践**：`build_session_record` 提取后，5 个测试覆盖 tool_calls 捕获、content_blocks 捕获、多 tool_calls、failed 状态、gap 上下文注入。

### 3. Scope/Profile 校验

- Agent 处理信号前必须检查 `scopeKey` 是否匹配当前活跃档案
- 比较逻辑：信号 payload 的 `scopeKey` vs config 中的 `exomind:activeScopeKey`
- 都没设置时放行（向后兼容），都设置但不匹配时跳过

### 4. Gap 块处理

- Gap 块不生成独立总结
- Gap 数据作为上下文注入到下一个 active 块的提示词
- 必须有过滤机制（如 10 分钟）避免捕获脏数据

---

## 三、调试经验

### 1. Tauri MCP 卡住时的退回策略

| 层级 | 工具 | 用途 |
|------|------|------|
| 第一层 | `driver_session status` | 确认 Bridge 连接 |
| 第二层 | `webview_execute_js` | 页面内 JS 执行 |
| 第三层 | `curl` RT HTTP | 直接访问 Runtime API |
| 第四层 | `sessions.sqlite` | 直接读数据库 |

**关键**：`driver_session connected=true` 不等于所有工具都可用。遇到 `Transport closed` 立即切 raw bridge 或 RT HTTP。

### 2. 杀进程必须指定 PID

```
# 先确认目标
wmic process where "name='exomind.exe'" get ProcessId,ExecutablePath,CommandLine

# 再指定 PID 杀掉
taskkill //PID <具体PID> //F
```

- 永远不要不指定 PID 就杀进程
- 同一机器可能有多个 exomind.exe（Tauri dev + 安装版）

### 3. 前端不显示 Agent 的排查路径

1. 检查 Agent 是否在 Runtime 中注册：`curl /agents`
2. 检查前端连接的是哪个 Runtime（端口是否一致）
3. 检查 Agent 是否启用：`curl /config` 查 `builtin.timeblock_summary.enabled`
4. 检查 LLM provider 是否配置：`curl /config` 查 `exomind:agentApi*`

### 4. Session 数据为空的排查路径

1. `content` 为空 → LLM 只返回 tool_calls，检查是否用工具返回值填充
2. `tool_calls` 为空 → 检查 history 中 `TurnItem::Assistant` 是否包含 tool_calls
3. `content_blocks` 为空 → 检查 `build_session_record` 是否正确传递

---

## 四、提示词设计规范

### 1. 工具描述

- ❌ 「你只有**一个工具**：xxx」— 会让 Agent 误以为无法获取数据
- ✅ 「数据通过预填上下文自动提供，xxx 是你分析完成后的输出手段」

### 2. 行为引导

- ❌ 「必须调用 xxx」— 会让 Agent 急着调用而不做分析
- ✅ 「先完成分析步骤，确认内容质量后，再调用 xxx」

### 3. 禁止项

- ❌ 「不要直接输出 Markdown；必须调用 xxx」— 混合了禁止和强制
- ✅ 「不要跳过分析步骤直接调用工具」— 只禁止坏行为

### 4. 边界说明

- 说明数据来源（预填上下文 vs 工具调用）
- 说明输出方式（调用工具提交结构化字段）
- 说明约束（不能修改数据，只能读取和提交）

---

## 五、文件变更检查清单

修改 Rust Agent 时，按此清单逐项检查：

- [ ] `agent/api.rs` — ContentBlock / ProviderCompletion 是否需要更新
- [ ] `agent/broker.rs` — AssistantTurn / completion_to_result 是否需要更新
- [ ] `agent/session.rs` — AgentSessionRecord / SQLite schema 是否需要更新
- [ ] `agent/mod.rs` — SessionInfo / Default impl 是否需要更新
- [ ] `agent/timeblock_summary/mod.rs` — 核心逻辑
- [ ] `agent/timeblock_summary/templates.rs` — 系统提示词
- [ ] `agent/timeblock_summary/context.rs` — 上下文收集
- [ ] `agent/timeblock_summary/tools.rs` — 工具定义
- [ ] `agent/life.rs` — AgentSessionRecord 构造器
- [ ] `routes/agents.rs` — actions API
- [ ] `energy.rs` — 能量系统
- [ ] `lib.rs` — 能量池注册 / signal routes
- [ ] `src/ui/app/pages/agents/WorkspaceTabs.tsx` — 前端 ActionsTab
- [ ] 对应测试文件 — 新增或更新测试
