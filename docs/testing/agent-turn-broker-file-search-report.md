# Agent Turn Broker File Search Experiment Report

日期：2026-04-03

关联文件：

- Rust 真实上游测试：[crates/exomind-runtime/tests/agent_api_rt.rs#L683](/data/data/com.termux/files/home/A137442/exomind/crates/exomind-runtime/tests/agent_api_rt.rs#L683)
- 外部文件系统工具 helper：[crates/exomind-runtime/tests/agent_api_rt.rs#L926](/data/data/com.termux/files/home/A137442/exomind/crates/exomind-runtime/tests/agent_api_rt.rs#L926)
- HTTP 验证方法：[docs/testing/agent-turn-broker-http-file-search.md#L1](/data/data/com.termux/files/home/A137442/exomind/docs/testing/agent-turn-broker-http-file-search.md#L1)
- 设计说明：[docs/superpowers/specs/2026-04-03-agent-file-search-tools-design.md](/data/data/com.termux/files/home/A137442/exomind/docs/superpowers/specs/2026-04-03-agent-file-search-tools-design.md)

## 1. 实验目标

验证当前 `#823` 的 API Agent broker 链路在不泄露目标路径的前提下，能通过调用方外置的 `pwd` / `ls` / `cd` 三个只读工具完成真实文件搜索。

本轮目标文件固定为：

```text
agent_api_rt.rs
```

成功条件：

- prompt 中只提供文件名，不提供目标路径
- 首轮和中间轮必须返回 `needs_tool_calls`
- 调用方执行工具后通过 `history` 续跑
- 最终返回 `completed`
- 最终回答包含仓库根目录相对路径 `crates/exomind-runtime/tests/agent_api_rt.rs`
- 搜索过程中必须出现真实工具调用，而不是直接猜测

## 2. 本轮确认的关键约束

### 2.1 路径语义

本实验中的“完整路径”统一指：

```text
相对当前仓库根目录的完整路径
```

最终目标值为：

```text
crates/exomind-runtime/tests/agent_api_rt.rs
```

### 2.2 工具语义

- `pwd`
  - 无参数
  - 返回当前目录相对仓库根目录的路径；根目录返回 `.`
- `ls`
  - 无参数
  - 返回当前目录直接子项，按字典序排序
  - 为降低噪声，本实验中过滤以 `.` 开头的隐藏项
- `cd`
  - 参数：`{"dir":"<name>"}` 或 `{"dir":".."}` 
  - 只允许进入直接子目录或回到父目录
  - 不允许越过实验根目录

### 2.3 单轮单工具调用

这组三个工具是有状态的，因为 `cd` 会改变当前目录。

因此，本实验额外要求：

```text
每一轮 assistant 只能请求一个 tool call
```

否则调用方无法为同一轮中的多个 `cd` 定义一致的 cwd 状态。这个约束已经直接写进本轮测试提示词和 Rust 断言中。

## 3. 测试方法

### 3.1 Rust 真实上游测试

入口：

```bash
cargo test -p exomind-runtime \
  broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present \
  --test agent_api_rt -- --nocapture
```

环境变量：

- `EXOMIND_AGENT_API_RT_ENABLE=1`
- `EXOMIND_AGENT_API_PROVIDER`
- `EXOMIND_AGENT_API_MODEL`
- `EXOMIND_AGENT_API_BASE_URL`
- `EXOMIND_AGENT_API_KEY`
- `EXOMIND_AGENT_API_RT_FS_ROOT`

测试策略：

- 无 provider/token 环境时自动 `skip`
- 有环境时调用真实上游模型
- 调用方在测试 harness 中维护 `current_dir`
- 每次收到 `toolCalls` 后，本地执行工具并把 `assistant + tool_result + history` 续跑回 broker

关键断言：

- 至少调用过一次 `pwd`
- 至少调用过一次 `ls`
- 至少调用过一次 `cd`
- 至少发生过一次 `cd("..")`
- 总工具调用数大于 1
- 不能在前两轮直接 `completed`
- 至少有一次 `ls` 输出里真实出现 `agent_api_rt.rs`
- 目标文件必须是在 `crates/exomind-runtime/tests` 目录的 `ls` 输出中被观察到
- 完成态时 `assistantTurn.toolCalls = []`
- 最终回答必须包含 `crates/exomind-runtime/tests/agent_api_rt.rs`

### 3.2 HTTP 实际 RT 验证

入口文档：

- [docs/testing/agent-turn-broker-http-file-search.md#L138](/data/data/com.termux/files/home/A137442/exomind/docs/testing/agent-turn-broker-http-file-search.md#L138)

测试策略：

- 实际启动 RT，使用 `/agent-sessions`
- 首轮只发：
  - `providerProfile`
  - `systemPrompt`
  - `tools`
  - `newUserMessage`
- 后续轮次通过 harness 自动追加：
  - `assistant`
  - `tool`
  - `history`

关键规则：

```text
tool_result.toolCallId 必须来自上一轮 assistantTurn.toolCalls[*].id
```

验收点：

- 首轮不能直接 `completed`
- 过程里至少出现一次 `pwd`、一次 `ls`、一次 `cd`
- 至少一次 `ls` 输出实际包含 `agent_api_rt.rs`
- 最终 `status=completed`
- 最终 `assistantTurn.toolCalls=[]`
- 最终 `content` 包含 `crates/exomind-runtime/tests/agent_api_rt.rs`

## 4. 实验过程摘要

### 4.1 Rust 真实上游实跑结果

本轮将成功日志保存为：

```text
.tmp/rust-file-search-success.log
```

关键结果：

- 测试名：

```text
broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present
```

- 最终状态：

```text
ok
```

- 实际耗时：

```text
finished in 85.64s
```

- 最终回答：

```text
找到文件，路径是：

`crates/exomind-runtime/tests/agent_api_rt.rs`
```

- 真实搜索证据：
  - `used_cd_parent=true`
  - `target_seen_dir=Some("crates/exomind-runtime/tests")`
  - 工具序列包含 `pwd`、`ls`、`cd`、`cd ..`

从日志尾部可见，Agent 不是直达命中，而是先探索：

- `crates`
- `crates/exomind-runtime`
- `crates/exomind-runtime/src`
- `crates/exomind-runtime/src/agent`
- 回退到 `crates/exomind-runtime`
- 再进入 `crates/exomind-runtime/tests`

并在 `tests` 目录的 `ls` 输出中真实看到了：

```text
agent_api_rt.rs
```

### 4.2 HTTP 实际 RT 实跑结果

本轮 HTTP 产物保存为：

```text
.tmp/http-file-search-final.json
.tmp/http-file-search-tool-log.json
```

关键结果：

- 最终状态：

```json
{"status":"completed"}
```

- 最终回答：

```text
找到文件，相对仓库根目录的完整路径是：

`crates/exomind-runtime/tests/agent_api_rt.rs`
```

- 工具调用回合数：

```text
14
```

- 关键工具序列：

```text
pwd
ls
cd crates
ls
cd exomind-runtime
ls
cd src
ls
cd agent
ls
cd ..
cd ..
cd tests
ls
```

- 目标文件首次被看到的时机：

```text
第 14 次工具调用的 ls 输出
```

工具日志证明：

- 首轮先 `pwd`
- 然后 `ls` 根目录
- 接着缩小到 `crates/exomind-runtime`
- 先误入 `src/agent`
- 再通过 `cd ..` 回退
- 最终进入 `tests` 并在 `ls` 输出中看到 `agent_api_rt.rs`

## 5. 本轮遇到的问题与修正

### 5.1 根目录噪声太大

第一次尝试时，仓库根目录包含大量隐藏目录和临时目录，模型容易在顶层被噪声干扰。

修正：

- `ls` 过滤隐藏项
- 在系统提示中强调：
  - 先 `pwd`
  - 再逐层搜索
  - 避免在一个分支里盲目深挖
  - 没线索就 `cd ..` 回退

### 5.2 多个并行 `cd` 导致状态不一致

一次真实上游响应曾在同一轮返回多个 `cd`，例如同时尝试：

- `crates`
- `src-tauri`
- `src`
- `server`

这与 `cd` 的有状态模型冲突。

修正：

- 在提示词中明确“每轮只允许一个工具调用”
- 在 Rust 断言中直接要求：

```text
record.assistant_turn.tool_calls.len() == 1
```

### 5.3 不能要求固定工具序列

HTTP 与 Rust 的真实运行中，搜索过程都包含回退和探索偏差，说明不能把测试写成精确序列脚本。

因此本轮最终采用的是：

- 保证真实搜索证据
- 不强制固定 turn 数或唯一工具顺序
- 只要求关键行为不变量

## 6. 结论

本轮已经确认：

1. 当前 API Agent broker 链路可以支持调用方外置的 `pwd` / `ls` / `cd` 三工具搜索实验。
2. 在不泄露目标路径的情况下，Agent 能通过多轮工具调用真实找到 `agent_api_rt.rs`。
3. Rust 真实上游测试与 HTTP 实际 RT 验证都已成功。
4. 对于有状态工具，当前单步续跑 broker 模型需要额外约束“每轮只允许一个 tool call”。
5. 当前实验方法已经具备可复跑性，后续可以作为更多外置只读工具故事的验证模板。
