# Agent Turn Broker HTTP File Search Validation

本页记录针对实际启动的 ExoMind Runtime 的 `pwd` / `ls` / `cd` 自主文件搜索实验流程。

目标：

1. prompt 只提供文件名 `agent_api_rt.rs`
2. 首轮及中间轮 `POST /agent-sessions` 返回 `needs_tool_calls`
3. 调用方按响应中的 `toolCalls` 执行只读工具，并把 `assistant + tool_result + history` 续跑回 RT
4. 最终返回 `completed`
5. 最终回答包含仓库根目录相对完整路径 `crates/exomind-runtime/tests/agent_api_rt.rs`
6. 日志能证明 Agent 确实发生了多步搜索，而不是直接猜测

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

export EXOMIND_AGENT_API_RT_FS_ROOT="$PWD"
```

说明：

- `.codex` 当前 provider 基址是站点根路径，RT 这里需要显式补成 `/v1`
- 不要把真实 `apiKey` 写进文档、脚本或仓库文件
- `EXOMIND_AGENT_API_RT_FS_ROOT` 指向实验允许访问的仓库根目录

## 2. 启动 RT

```bash
export EXOMIND_RT_PORT=1952
export EXOMIND_RT_BIND=127.0.0.1
export EXOMIND_RT_DISABLE_TS_AGENTS=1
export EXOMIND_RT_DATA_DIR="$PWD/.tmp/rt-agent-file-search"

cargo run -p exomind-runtime
```

预期输出包含：

```text
exomind-rt listening on http://127.0.0.1:1952
```

健康检查：

```bash
curl -sS http://127.0.0.1:1952/health
```

预期：

```json
{"status":"ok"}
```

## 3. 生成首轮请求

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
  "systemPrompt": (
    "你是一个仓库文件搜索助手。当前工作根目录就是仓库根目录。"
    "你只能使用调用者提供的 pwd、ls、cd 三个只读工具，不允许猜测。"
    "每一轮你只能请求一个工具调用。请先用 pwd 确认位置，然后按广度优先、逐层收窄的方式搜索："
    "先看当前层有哪些直接子项，再优先探索更像源码/工作区的目录，避免在一个深层分支里盲目走太久；"
    "如果某条分支暂时没有线索，就用 cd .. 回到上层并继续检查尚未探索的同级目录。"
    "只有当你在 ls 输出中亲眼看到目标文件名时，才能宣布找到。"
    "找到后，请用中文给出该文件相对仓库根目录的完整路径。"
  ),
  "tools": [
    {
      "name": "pwd",
      "description": "返回当前目录相对仓库根目录的路径；仓库根目录返回 . 。无参数。",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": False
      }
    },
    {
      "name": "ls",
      "description": "列出当前目录下的直接子文件与子目录，输出按字典序排序。无参数。",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": False
      }
    },
    {
      "name": "cd",
      "description": "切换当前目录。参数 dir 只能是当前目录的一个直接子目录名，或 .. 返回父目录；不能越过仓库根目录。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "dir": { "type": "string" }
        },
        "required": ["dir"],
        "additionalProperties": False
      }
    }
  ],
  "newUserMessage": "请找到文件 agent_api_rt.rs，并在找到后输出它相对当前仓库根目录的完整路径。禁止猜测，必须依赖工具搜索。"
}
path = pathlib.Path(".tmp/http-file-search-first.json")
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload, ensure_ascii=False))
print(path)
PY
```

## 4. 执行 HTTP 搜索 loop

下面的 harness 会：

- 向实际 RT 发送首轮请求
- 读取 `toolCalls`
- 在调用方本地执行 `pwd` / `ls` / `cd`
- 把 `assistant + tool_result + history` 重新发给 RT
- 直到拿到 `completed`

```bash
python - <<'PY'
import json
import os
import pathlib
import urllib.request

rt_url = "http://127.0.0.1:1952/agent-sessions"
root = pathlib.Path(os.environ["EXOMIND_AGENT_API_RT_FS_ROOT"]).resolve()
initial = json.loads(pathlib.Path(".tmp/http-file-search-first.json").read_text())

current_dir = root
history = []
next_user_message = initial["newUserMessage"]
turn = 0
tool_log = []

def rel_dir(path: pathlib.Path) -> str:
    rel = path.relative_to(root)
    return "." if str(rel) == "." else rel.as_posix()

def execute_tool(tool_call: dict) -> str:
    global current_dir
    name = tool_call["name"]
    tool_input = tool_call.get("input", {})
    if name == "pwd":
        assert tool_input == {}, tool_call
        return rel_dir(current_dir)
    if name == "ls":
        assert tool_input == {}, tool_call
        names = sorted(
            item.name
            for item in current_dir.iterdir()
            if not item.name.startswith(".")
        )
        return "\n".join(names)
    if name == "cd":
        dir_name = tool_input["dir"]
        assert "/" not in dir_name and "\\" not in dir_name and dir_name != "." and dir_name
        if dir_name == "..":
            if current_dir == root:
                return "ERROR: already at root"
            target = current_dir.parent
        else:
            target = current_dir / dir_name
        target = target.resolve()
        assert str(target).startswith(str(root)), tool_call
        assert target.exists() and target.is_dir(), tool_call
        current_dir = target
        return f"OK: current_dir={rel_dir(current_dir)}"
    raise RuntimeError(f"unexpected tool: {name}")

while True:
    turn += 1
    payload = {
        "providerProfile": initial["providerProfile"],
        "systemPrompt": initial["systemPrompt"],
        "tools": initial["tools"],
        "history": history,
    }
    if next_user_message is not None:
        payload["newUserMessage"] = next_user_message

    req = urllib.request.Request(
        rt_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        record = json.loads(resp.read().decode("utf-8"))

    print(f"--- turn {turn} ---")
    print("status =", record["status"])
    print("sessionId =", record["sessionId"])
    print("assistantTurn.toolCalls =", json.dumps(record["assistantTurn"]["toolCalls"], ensure_ascii=False))

    if turn == 1:
        history.append({"role": "user", "content": initial["newUserMessage"]})
    history.append({
        "role": "assistant",
        "content": record["assistantTurn"]["content"],
        "toolCalls": record["assistantTurn"]["toolCalls"],
    })

    if record["status"] == "completed":
        pathlib.Path(".tmp/http-file-search-final.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2)
        )
        pathlib.Path(".tmp/http-file-search-tool-log.json").write_text(
            json.dumps(tool_log, ensure_ascii=False, indent=2)
        )
        print("final =", record["content"])
        break

    tool_calls = record["assistantTurn"]["toolCalls"]
    assert len(tool_calls) == 1, record
    tool_call = tool_calls[0]
    tool_output = execute_tool(tool_call)
    tool_log.append({
        "turn": turn,
        "currentDir": rel_dir(current_dir),
        "toolCall": tool_call,
        "toolOutput": tool_output,
    })
    print("tool =", tool_call["name"], tool_call.get("input", {}))
    print("toolOutput =", tool_output)

    history.append({
        "role": "tool",
        "toolCallId": tool_call["id"],
        "toolName": tool_call["name"],
        "content": tool_output,
    })
    next_user_message = None
PY
```

关键规则：

```text
tool_result.toolCallId 必须来自上一轮 assistantTurn.toolCalls[*].id
```

对于这组三个有状态工具，当前实验还要求：

```text
每轮只允许一个 tool call，否则调用方无法定义一致的 cwd 状态
```

## 5. 验收标准

必须同时满足：

- prompt 中只提供文件名 `agent_api_rt.rs`
- 最终响应 `status = completed`
- 最终 `content` 包含 `crates/exomind-runtime/tests/agent_api_rt.rs`
- `assistantTurn.toolCalls = []`
- `.tmp/http-file-search-tool-log.json` 能证明多步搜索
- 工具序列里至少出现过一次 `pwd`、一次 `ls`、一次 `cd`
- 至少有一次 `ls` 输出实际包含 `agent_api_rt.rs`

## 6. 非敏感证据建议

建议保留：

- `.tmp/http-file-search-final.json`
- `.tmp/http-file-search-tool-log.json`

回填 issue 时可引用：

- 最终 `content`
- `tool_log` 中关键几轮：
  - 首轮 `pwd`
  - 进入 `crates/exomind-runtime`
  - 在 `crates/exomind-runtime/tests` 的 `ls` 输出里看到 `agent_api_rt.rs`

不要回填：

- 真实 `apiKey`
- 完整 provider token
- 任何本地敏感路径之外的凭据内容
