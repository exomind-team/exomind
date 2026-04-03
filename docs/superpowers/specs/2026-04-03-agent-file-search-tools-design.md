# #823 Agent 文件搜索工具实验设计

> 日期：2026-04-03
> 关联 Issue：#823
> 当前分支基线：`dev@51cf3188`
> 状态：待文档审阅

## 1. 背景

当前 `#823` 已经证明：

- `AgentTurnBroker` 能处理调用者自定义工具定义
- `/agent-sessions` 能把 `toolCalls` 回给调用方
- 调用方能把 `assistant(tool_call) + tool_result` 作为 `history` 回填续跑
- 真实启动 RT 的 HTTP 路径与 Rust 真实上游测试都已经跑通了“给定目标路径”的 `ls/cd` 场景

但上一轮测试仍然存在一个限制：

- prompt 中已经给了目标路径 `crates/exomind-runtime/src/agent/tools`
- 工具集只有 `ls` / `cd`
- Rust 测试用固定序列证明多步行为，而不是让 Agent 在更大的目录空间里自主搜索

升级版实验的目标是验证：

1. 不预先告诉 API Agent 目标路径
2. 只告诉它要找的文件名 `agent_api_rt.rs`
3. 给它三个只读外置工具：`pwd` / `ls` / `cd`
4. 允许 `cd("..")` 回到父目录，但不能越过给定根目录
5. Agent 应在整个受限目录树中自主搜索
6. 找到后输出仓库根目录相对的完整路径，预期由 Agent 结合 `pwd` 与搜索结果自行组织

## 2. 设计目标

本实验要同时满足两个看似冲突的目标：

1. **真实性**
   - HTTP 路径要尽量接近真实产品使用方式
   - 不把目标路径泄露给 Agent
   - 不把搜索路径固定成脚本
2. **可回归性**
   - Rust 测试要稳定
   - 要能自动判断 Agent 是否真的进行了多步搜索
   - 不能只看最终回答“像是对的”

因此，本设计采用 **1 + 3 的混合验收**：

- HTTP：自由搜索验收
- Rust：强约束回归网

## 3. 核心设计选择

### 3.1 方案对比

#### 方案 A：HTTP 与 Rust 都只做自由搜索

优点：

- 最贴近真实产品行为
- 最能体现 Agent 的自主探索

缺点：

- 回归稳定性弱
- 模型风格变化会导致测试抖动
- 很难自动判定“是否真的探索了”

#### 方案 B：HTTP 与 Rust 都做强约束搜索

优点：

- 最稳定
- 最容易自动断言

缺点：

- 会把 Agent 搜索行为脚本化
- 不能充分验证“只给文件名时的真实自主搜索”

#### 方案 C：HTTP 自由搜索 + Rust 强约束回归

优点：

- HTTP 负责产品真实性
- Rust 负责自动化稳定性
- 二者互补，能同时验证“能搜到”和“确实在搜”

缺点：

- 需要维护两条测试思路
- 文档和测试解释成本略高

### 3.2 结论

采用 **方案 C**。

## 4. 工具模型

本实验只提供三个由调用者外部执行的只读工具：

### 4.1 `pwd`

- 名称：`pwd`
- 输入：无参数
- 输出：当前目录相对实验根目录的路径
- 根目录时返回 `.`

示例：

```text
.
```

```text
crates/exomind-runtime/tests
```

### 4.2 `ls`

- 名称：`ls`
- 输入：无参数
- 输出：当前目录直接子项列表
- 输出按字典序排序，保证稳定

示例：

```text
agent_api_rt.rs
discovery_pairing_relay_e2e.rs
pty_agent.rs
```

### 4.3 `cd`

- 名称：`cd`
- 输入：`{ "dir": "<name>" }`
- 允许：
  - 当前目录的直接子目录名
  - `dir == ".."`，表示回到父目录
- 不允许：
  - 含 `/` 或 `\` 的路径
  - 空字符串
  - `.` 
  - 绝对路径
  - 任何会越过给定根目录的移动

成功示例：

```text
OK: current_dir=crates
```

```text
OK: current_dir=crates/exomind-runtime/tests
```

根目录下执行 `cd("..")` 的推荐行为：

- 返回明确错误
- 不改变当前目录

示例：

```text
ERROR: already at root
```

原因：

- 比“静默保持在根目录”更容易让模型和测试都看清当前状态

## 5. Prompt 约束

### 5.1 允许提供的信息

在测试用 prompt 中，允许提供的信息只能包括：

- 要找的文件名：`agent_api_rt.rs`
- 需要找到它并输出完整路径
- 可用工具说明：`pwd` / `ls` / `cd`
- 必须依赖工具，禁止猜测

### 5.2 明确禁止提供的信息

prompt 中不得出现：

- 目标目录路径
- 目标所在模块名
- 任意接近真实路径的提示，如：
  - `crates/exomind-runtime/tests`
  - `tests 目录`
  - `runtime crate`

### 5.3 推荐 prompt 结构

系统提示建议强调：

- 你是仓库文件搜索助手
- 起始目录是给定根目录
- 你只能通过 `pwd` / `ls` / `cd` 搜索
- 你必须找到文件 `agent_api_rt.rs`
- 找到后输出完整路径
- 不允许猜测

用户消息只给文件名和目标：

```text
请找到文件 agent_api_rt.rs，并在找到后输出它的完整路径（相对当前仓库根目录）。禁止猜测，必须依赖工具搜索。
```

## 6. 两条验证路径

### 6.1 HTTP：自由搜索验收

HTTP 路径的职责是验证真实产品行为。

要求：

- 实际启动 RT
- 使用真实上游 API
- 外部 harness 维护当前目录状态
- harness 执行 `pwd` / `ls` / `cd`
- Agent 不知道目标路径，只知道文件名

HTTP 成功条件：

1. Agent 最终返回包含 `agent_api_rt.rs` 的仓库根目录相对完整路径
2. 该路径在实验根目录下真实存在
3. 实际文件等于：
   - `crates/exomind-runtime/tests/agent_api_rt.rs`
4. 日志中能看到多轮工具调用
5. 工具调用中至少包含：
   - 一次 `pwd`
   - 一次 `ls`
   - 一次 `cd`
6. 不能首轮直接 `completed`

HTTP 路径不强制固定搜索路径，也不强制必须出现 `cd ..`，因为这里的重点是保留自主搜索真实性。

### 6.2 Rust：强约束回归网

Rust 路径的职责是提供自动化、可重复的真实环境回归保护。

这里不再要求固定唯一路径，但要强约束“确实发生了搜索”。

Rust 成功条件：

1. 默认无环境变量时安全 skip
2. 真实环境下在预算轮次内完成
3. 最终输出仓库根目录相对完整路径，且等于：
   - `crates/exomind-runtime/tests/agent_api_rt.rs`
4. 工具调用中必须至少包含：
   - 一次 `pwd`
   - 一次 `ls`
   - 一次 `cd`
5. 工具调用总数必须大于 1，且不能在过少轮次内完成
   - 即不能“一上来就回答”
6. 完成态时 `assistantTurn.toolCalls` 必须为空

Rust 路径的关键思想是：

- 不固定它“怎么找到”
- 但固定“必须表现出真实搜索行为”

## 7. 环境变量设计

复用现有真实上游变量：

- `EXOMIND_AGENT_API_RT_ENABLE`
- `EXOMIND_AGENT_API_PROVIDER`
- `EXOMIND_AGENT_API_MODEL`
- `EXOMIND_AGENT_API_BASE_URL`
- `EXOMIND_AGENT_API_KEY`

继续使用并保留：

- `EXOMIND_AGENT_API_RT_FS_ROOT`

该变量含义：

- 指定实验允许访问的根目录
- `pwd` / `ls` / `cd` 都只在这个目录树内工作

## 8. 风险与对策

### 8.1 风险：自由搜索中根目录 `ls` 输出过大

之前已经出现过：

- 根目录含大量临时目录
- 单次 `ls` 结果过大
- 提高上游失败概率

对策：

- 在 prompt 中建议 Agent 先用 `pwd` 明确位置
- 强调分层探索优先，不要反复对大目录做全量 `ls`
- HTTP harness 保留完整日志，便于复盘

### 8.2 风险：`cd("..")` 越界

对策：

- `cd("..")` 时若已到根目录，返回明确错误
- 每次路径变更后都验证仍在根目录内

### 8.3 风险：最终回答正确但过程是猜的

对策：

- HTTP：要求必须有多轮工具调用
- Rust：要求至少出现 `pwd` / `ls` / `cd`，且总工具调用数大于 1

### 8.4 风险：续跑 history 组装错误

关键要求不变：

- `tool_result.toolCallId` 必须来自 `assistantTurn.toolCalls[*].id`

这条要求必须继续写入 HTTP 文档与 Rust 测试实现。

## 9. 最小改动集合

必改文件：

- `crates/exomind-runtime/tests/agent_api_rt.rs`
  - 新增升级版真实上游 Rust 文件搜索测试
  - 扩展外部工具执行 helper，支持 `pwd` 与 `cd("..")`
- `docs/testing/`
  - 新增专门的 HTTP 文件搜索验证文档

可选文件：

- `crates/exomind-runtime/src/agent/broker.rs`
  - 若要增加更严格的 history/tool-call 匹配校验
- `crates/exomind-runtime/src/routes/agent_sessions.rs`
  - 若要补 route 侧 fake-provider 回归测试

本批优先目标是不改生产逻辑，只补实验与测试。

## 10. 完成条件

- [ ] HTTP 路径上完成一次真实启动 RT 的自由搜索实验
- [ ] prompt 中只提供文件名 `agent_api_rt.rs`
- [ ] HTTP 实验最终返回仓库根目录相对完整路径
- [ ] Rust 真实环境测试可在无环境变量时 skip
- [ ] Rust 真实环境测试可在有环境变量时通过
- [ ] Rust 测试能自动证明 Agent 发生了多步真实搜索
- [ ] `pwd` / `ls` / `cd("..")` 的边界行为被明确验证
