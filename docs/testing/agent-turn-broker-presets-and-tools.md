# Agent Turn Broker Presets + Tools 验证记录

> 日期：2026-04-04
> 关联 Issue：#823
> 适用提交：工作区当前 `dev`

## 1. 目标

验证 API Agent 的 source-level 工具来源语义已更新为：

- `tools`：调用方本次显式提供的自定义工具
- `presets`：Rust 内部预设工具（组）

并且：

- `tools + presets` 可以同时存在
- HTTP 只负责转发 `tools / presets / scopeKey`
- Rust source-aware runner 负责展开 preset、与显式 tools 合并、并检查冲突
- broker 只接收最终 `Vec<ToolDef>`

## 2. 请求示例

下面这个请求同时使用：

- Rust 内部 `recent_events` preset
- 调用方临时定义的 `get_weather`

```json
{
  "systemPrompt": "你是测试助手",
  "presets": ["recent_events"],
  "scopeKey": "profile-argon",
  "tools": [
    {
      "name": "get_weather",
      "description": "获取天气",
      "inputSchema": {
        "type": "object",
        "properties": {
          "date": { "type": "string" }
        },
        "required": ["date"],
        "additionalProperties": false
      }
    }
  ],
  "newUserMessage": "先看最近事件，再查今天的天气。"
}
```

HTTP 兼容层当前仍接受旧字段：

```json
{
  "toolGroups": ["recent_events"]
}
```

但它只作为兼容别名映射到 `presets`，正式语义已经切到 `presets`。

## 3. 预期行为

Rust source-aware runner 应将上面的 source-level 请求归一化为最终工具列表：

```text
get_weather
get_recent_events
```

固定规则：

- duplicate preset key => 报错
- merge 后 duplicate tool name => 报错
- 缺少必需 `scopeKey` 的 preset => 报错
- 不做静默覆盖

## 4. 已执行验证

### 4.1 source-aware 单测

命令：

```bash
CARGO_BUILD_JOBS=1 cargo test -p exomind-runtime agent::session::tests::resolve_requested_tools_ -- --nocapture
```

覆盖点：

- `recent_events` preset 正确展开
- `tools + presets` 合并成功
- duplicate preset 报错
- duplicate final tool name 报错
- 缺少 `scopeKey` 报错

### 4.2 route 单测

命令：

```bash
CARGO_BUILD_JOBS=1 cargo test -p exomind-runtime routes::agent_sessions::tests::route_ -- --nocapture
```

覆盖点：

- `/agent-sessions` 接收 `presets`
- route 不做工具合并，只转发 source-level 字段
- Rust 层展开 `recent_events`
- 显式 `get_weather` 与 `recent_events` preset 可同轮出现

### 4.3 `agent_api_rt` 集成测试

命令：

```bash
CARGO_BUILD_JOBS=1 cargo test -p exomind-runtime route_allows_combined_presets_and_explicit_tools --test agent_api_rt -- --nocapture
```

覆盖点：

- 从实际 route 入口发出 `presets + tools` 请求
- fake upstream 真实看到了：
  - `get_recent_events`
  - `get_weather`
- RT 返回 `needs_tool_calls`

### 4.4 旧链路回归

命令：

```bash
CARGO_BUILD_JOBS=1 cargo test -p exomind-runtime route_runs_session_with_runtime_config_fallback --test agent_api_rt -- --nocapture
CARGO_BUILD_JOBS=1 cargo test -p exomind-runtime agent::life::tests::on_tick_can_persist_internal_agent_api_session -- --nocapture
CARGO_BUILD_JOBS=1 cargo test -p exomind-runtime agent::life::tests::internal_proposal_tool_calls_use_shared_helper_and_persist_proposals -- --nocapture
```

覆盖点：

- route config fallback 未被新字段语义破坏
- internal life agent 仍能通过 shared source-aware 层工作
- proposal preset 相关内部调用未回退到旧 registry 语义

## 5. 当前结论

当前代码已经实现并验证了新的约束与定义：

- API Agent 默认无工具
- `tools` 与 `presets` 可同时存在
- HTTP 只中转参数
- Rust 负责 preset 展开与合并
- broker 只消费最终工具列表

这使得调用方现在可以在同一轮 session 中同时使用：

- Rust 内置的 `recent_events` / `proposal_tools`
- 调用方本次临时提供的测试工具或业务工具

而不需要在“内部 preset”与“外部自定义工具”之间二选一。
