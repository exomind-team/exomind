# Agent Turn Broker Proposal Tools Test

## Purpose

This test validates that ExoMind's API Agent broker flow can:

1. receive realistic event-log-style context
2. expose proposal tools per turn from the Rust caller
3. return tool calls from the upstream LLM
4. let the Rust caller execute those tool calls against the real `ProposalStore`
5. continue the conversation with `assistant(tool_call) + tool_result + history`
6. produce a final natural-language summary grounded in the created proposal drafts

This is the proposal-tool story tracked under `#830`, built on the broker/session model from `#823`.

## Tool Set

The Rust caller provides three semantic tools:

- `add_task_proposal`
- `add_timeblock_proposal`
- `add_event_proposal`

They map to existing proposal action types:

- `add_task_proposal` -> `create_task`
- `add_timeblock_proposal` -> `start_timeblock`
- `add_event_proposal` -> `append_event`

## Narrative Fixture

The real-upstream and deterministic contract tests use a realistic event-log-style narrative:

```text
2026-04-04 09:10 事件：刚推送 test(rt): add broker file search validation
2026-04-04 09:35 事件：feat(task-dag): unify dag text and tag search 已在 dev
2026-04-04 10:20 事件：对了，明天可能要验收下任务依赖图新布局
2026-04-04 10:45 事件：刚完成一轮 pwd/ls/cd 文件搜索验证，准备回填 issue
2026-04-04 11:05 事件：完成一个时间块，准备开始总结
2026-04-04 11:20 事件：下一步希望把这轮 API Agent 实验整理成 issue 回填与简明总结
```

Expected extraction behavior:

- create at least one task proposal for `验收任务依赖图新布局`
- create a timeblock proposal for concentrated issue write-up / summary work
- create an event proposal for a phase summary / review record

## Tests

### Deterministic contract test

File:

- `crates/exomind-runtime/tests/agent_api_rt.rs`

Command:

```bash
cargo test -p exomind-runtime broker_proposal_story_contract_creates_real_proposals --test agent_api_rt -- --nocapture
```

What it proves:

- the shared proposal-tool helper can execute all three tool types
- the broker continuation path works with `assistant(tool_call) + tool_result`
- the in-memory `ProposalStore` contains real persisted drafts

Acceptance:

- exactly 3 drafts are created in the scripted scenario
- action types include:
  - `create_task`
  - `start_timeblock`
  - `append_event`

### Internal Rust caller regression

File:

- `crates/exomind-runtime/src/agent/life.rs`

Command:

```bash
cargo test -p exomind-runtime internal_proposal_tool_calls_use_shared_helper_and_persist_proposals --lib -- --nocapture
```

What it proves:

- internal Rust callers can expose proposal tools
- internal tool execution reuses the same shared helper
- a real proposal is written into `ProposalStore`

### Real-upstream regression

File:

- `crates/exomind-runtime/tests/agent_api_rt.rs`

Skip-path command:

```bash
cargo test -p exomind-runtime broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Real-upstream command:

```bash
eval "$(python - <<'PY'
import json, pathlib, tomllib
home = pathlib.Path.home()
config = tomllib.loads((home/'.codex'/'config.toml').read_text())
auth = json.loads((home/'.codex'/'auth.json').read_text())
provider_id = config.get('model_provider', 'default')
provider = config.get('model_providers', {}).get(provider_id, {})
base_url = provider.get('base_url', '').rstrip('/')
if base_url and not base_url.endswith('/v1'):
    base_url += '/v1'
print('export EXOMIND_AGENT_API_RT_ENABLE=1')
print('export EXOMIND_AGENT_API_PROVIDER=openai')
print(f"export EXOMIND_AGENT_API_MODEL={config.get('model', '')!r}")
print(f"export EXOMIND_AGENT_API_BASE_URL={base_url!r}")
print(f"export EXOMIND_AGENT_API_KEY={auth.get('OPENAI_API_KEY', '')!r}")
PY
)"

cargo test -p exomind-runtime broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Operational rule:

- if a run returns `401`, stop and report the auth failure instead of continuing

Acceptance:

- without env vars, the test skips cleanly
- with real upstream enabled, the test completes successfully
- the created proposals are verified from `ProposalStore`, not inferred from prose only
- the resulting proposal set includes:
  - at least one `create_task`
  - at least one `start_timeblock`
  - at least one `append_event`
- all created proposals remain `pending`
- final summary explains the created drafts in Chinese

## Non-Sensitive Evidence Examples

### Example task proposal tool call input

```json
{
  "name": "add_task_proposal",
  "input": {
    "title": "任务提案：验收任务依赖图新布局",
    "body": "根据事件日志，为明天的任务依赖图新布局验收形成任务草案。",
    "taskTitle": "验收任务依赖图新布局",
    "description": "为任务依赖图新布局安排明日验收",
    "priority": "high",
    "tags": ["验收", "task-dag", "布局", "明日跟进"]
  }
}
```

### Example tool result payload

```json
{
  "actionType": "create_task",
  "proposalId": 1,
  "scopeKey": "profile-alpha",
  "status": "pending",
  "title": "任务提案：验收任务依赖图新布局"
}
```

### Example stored proposal excerpt

```json
{
  "id": 1,
  "title": "任务提案：验收任务依赖图新布局",
  "action_type": "create_task",
  "action_params": {
    "title": "验收任务依赖图新布局",
    "description": "为任务依赖图新布局安排明日验收",
    "priority": "high",
    "tags": ["验收", "task-dag", "布局", "明日跟进"]
  },
  "status": "pending",
  "publisher": {
    "publisher_type": "agent",
    "id": "api-agent",
    "name": "API Agent"
  }
}
```

### Example final assistant summary excerpt

```text
我已提取并创建了 4 条草案：
1. 任务提案：验收任务依赖图新布局
2. 任务提案：回填 API Agent 实验 issue 与验证结果
3. 时间块提案：API Agent 实验回填与总结 45 分钟
4. 事件提案：补记 API Agent 实验阶段性总结
```

## Current Observed Result

In the current real-upstream run, the Agent created:

- 2 task proposals
- 1 timeblock proposal
- 1 event proposal

The first task proposal directly captured the target story:

- `验收任务依赖图新布局`

This means the proposal-tool product story is already working end-to-end in test form:

- realistic event narrative in
- external API Agent decides tool calls
- Rust executes tool calls into real proposal storage
- broker continuation completes with a grounded Chinese summary
