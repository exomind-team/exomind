# Agent Turn Broker HTTP Weather Validation

本页记录针对实际启动的 ExoMind Runtime 的两段式天气工具调用验证流程。

目标：

1. 首轮 `POST /agent-sessions` 返回 `needs_tool_calls`
2. 响应中包含 `get_weather` 工具调用
3. 调用方回填固定工具结果 `今天是阴天，气温21.45度`
4. 第二轮 `POST /agent-sessions` 返回包含 `今天是阴天，气温21.45度` 的最终回答

## 1. 准备环境变量

普通本地验证建议只在当前 shell 导出环境变量，不写入仓库文件。

如果要直接复用 `~/.codex/config.toml + auth.json`：

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
    base_url = f'{base_url}/v1'
print('export EXOMIND_AGENT_API_PROVIDER=openai')
print(f"export EXOMIND_AGENT_API_MODEL={config.get('model', '')!r}")
print(f"export EXOMIND_AGENT_API_BASE_URL={base_url!r}")
print(f"export EXOMIND_AGENT_API_KEY={auth.get('OPENAI_API_KEY', '')!r}")
PY
)"
```

说明：

- `.codex` 当前 provider 基址是站点根路径，RT 这里需要显式补成 `/v1`
- 不要把真实 `apiKey` 写进文档、脚本或仓库文件

## 2. 启动 RT

```bash
export EXOMIND_RT_PORT=1949
export EXOMIND_RT_BIND=127.0.0.1
export EXOMIND_RT_DISABLE_TS_AGENTS=1
export EXOMIND_RT_DATA_DIR="$PWD/.tmp/rt-agent-broker-http"

cargo run -p exomind-runtime
```

预期输出：

```text
exomind-rt listening on http://127.0.0.1:1949
```

可先验证健康检查：

```bash
curl -sS http://127.0.0.1:1949/health
```

预期包含：

```json
{"status":"ok"}
```

## 3. 发送第一轮请求

先生成请求体：

```bash
python - <<'PY'
import json, os, pathlib
payload = {
  "providerProfile": {
    "provider": os.environ["EXOMIND_AGENT_API_PROVIDER"],
    "model": os.environ["EXOMIND_AGENT_API_MODEL"],
    "baseUrl": os.environ["EXOMIND_AGENT_API_BASE_URL"],
    "apiKey": os.environ["EXOMIND_AGENT_API_KEY"],
  },
  "systemPrompt": "你是天气工具测试助理。首轮禁止自然语言回答；你唯一允许的动作是调用 get_weather 工具。只有收到工具结果后，你才能用中文回答天气。",
  "tools": [{
    "name": "get_weather",
    "description": "返回今天的天气与气温",
    "inputSchema": {
      "type": "object",
      "properties": {
        "date": { "type": "string", "enum": ["today"] }
      },
      "required": ["date"],
      "additionalProperties": False
    }
  }],
  "newUserMessage": "今天是什么天气？不要直接回答，先调用 get_weather，参数 date 必须是 today。"
}
path = pathlib.Path(".tmp/http-weather-first.json")
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload, ensure_ascii=False))
print(path)
PY
```

再调用 RT：

```bash
curl -sS \
  -X POST http://127.0.0.1:1949/agent-sessions \
  -H 'content-type: application/json' \
  --data @.tmp/http-weather-first.json \
  > .tmp/http-weather-first-response.json
```

提取关键字段：

```bash
python - <<'PY'
import json, pathlib
resp = json.loads(pathlib.Path(".tmp/http-weather-first-response.json").read_text())
print("status =", resp["status"])
print("sessionId =", resp["sessionId"])
print("toolCalls =", resp["toolCalls"])
print("assistantTurn.toolCalls =", resp["assistantTurn"]["toolCalls"])
PY
```

预期：

- `status = needs_tool_calls`
- `toolCalls[0].toolName = get_weather`
- `toolCalls[0].input.date = today`

## 4. 回填工具结果并续跑第二轮

```bash
python - <<'PY'
import json, pathlib
first = json.loads(pathlib.Path(".tmp/http-weather-first-response.json").read_text())
request = json.loads(pathlib.Path(".tmp/http-weather-first.json").read_text())
tool_call = first["assistantTurn"]["toolCalls"][0]
continuation = {
  "providerProfile": request["providerProfile"],
  "systemPrompt": request["systemPrompt"],
  "tools": request["tools"],
  "history": [
    {
      "role": "user",
      "content": request["newUserMessage"]
    },
    {
      "role": "assistant",
      "content": first["assistantTurn"]["content"],
      "toolCalls": first["assistantTurn"]["toolCalls"]
    },
    {
      "role": "tool",
      "toolCallId": tool_call["id"],
      "toolName": tool_call["name"],
      "content": "今天是阴天，气温21.45度"
    }
  ]
}
path = pathlib.Path(".tmp/http-weather-second.json")
path.write_text(json.dumps(continuation, ensure_ascii=False))
print(path)
PY
```

```bash
curl -sS \
  -X POST http://127.0.0.1:1949/agent-sessions \
  -H 'content-type: application/json' \
  --data @.tmp/http-weather-second.json \
  > .tmp/http-weather-second-response.json
```

检查结果：

```bash
python - <<'PY'
import json, pathlib
resp = json.loads(pathlib.Path(".tmp/http-weather-second-response.json").read_text())
print("status =", resp["status"])
print("content =", resp["content"])
print("assistantTurn.toolCalls =", resp["assistantTurn"]["toolCalls"])
PY
```

预期：

- `status = completed`
- `content` 包含 `今天是阴天，气温21.45度`
- `assistantTurn.toolCalls = []`

## 5. 对应 Rust 测试

默认未显式启用真实上游测试时跳过：

```bash
cargo test -p exomind-runtime broker_weather_flow_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

使用本地 `.codex` 环境变量后跑真实上游：

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
    base_url = f'{base_url}/v1'
print('export EXOMIND_AGENT_API_PROVIDER=openai')
print('export EXOMIND_AGENT_API_RT_ENABLE=1')
print(f"export EXOMIND_AGENT_API_MODEL={config.get('model', '')!r}")
print(f"export EXOMIND_AGENT_API_BASE_URL={base_url!r}")
print(f"export EXOMIND_AGENT_API_KEY={auth.get('OPENAI_API_KEY', '')!r}")
PY
)"

cargo test -p exomind-runtime broker_weather_flow_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

预期：

- 未启用或缺少环境变量时打印 skip 信息并通过
- 环境变量正确时通过
- 如果远端返回 `401`，测试会显式失败并提示检查 `EXOMIND_AGENT_API_*`
