# ExoMind CLI（RT Client Shell，RT 客户端外壳）

## 目标

`exomind` 是 ExoMind 的 **RT client shell（RT 客户端外壳）**。

它不是直接改 store（存储）的旁路工具，而是通过现有 RT HTTP contract（运行时 HTTP 契约）访问：

- `eventlog`
- `task`
- `proposal`
- `rt`

Phase 1 的设计重点：

1. 默认 `connect-first（优先连接）`
2. 默认不静默自启 RT
3. 零参数直接显示首页帮助
4. 对人类可读，对 Agent 可稳定调用

## 默认行为

目标解析顺序：

1. `--target host:port`
2. CLI 本地状态中的 `default_target`
3. 本机候选端口探测：`9124`、`1950`、`1949`
4. 若仍未找到，且显式要求 `--spawn-if-missing`
5. 否则报错

当前实现仍坚持：

- 普通业务命令不静默拉起新的 RT
- `eventlog` 内部使用 `user_id`
- `task / proposal` 内部优先使用 `profile_id`

## 首页帮助

直接运行：

```bash
exomind
```

会显示：

- CLI 的定位说明
- `connect-first` 默认行为
- 常用命令样例
- Agent-friendly usage（Agent 友好调用样例）

## 命令样例

### RT

```bash
exomind rt status
exomind rt probe
exomind rt use 127.0.0.1:9124
```

### EventLog

```bash
exomind eventlog add --profile argon --content "补记今天的口述" --tag note --tag voice
exomind eventlog list --profile argon --limit 20
exomind eventlog get --profile argon evt-123
exomind eventlog watch --profile argon --since-id evt-123
```

### Task

```bash
exomind task add --profile argon --title "整理浏览器标签" --priority high --tag cleanup
exomind task list --profile argon --status pending --tag cleanup
exomind task get --profile argon task-123
exomind task update --profile argon task-123 --title "整理三个屏幕程序"
exomind task start --profile argon task-123
exomind task complete --profile argon task-123
exomind task cancel --profile argon task-123
```

### Proposal

```bash
exomind proposal add --profile argon --action create_task --title "建议：整理浏览器标签" --params-file proposal.json
exomind proposal list --profile argon --status pending
exomind proposal get --profile argon 12
exomind proposal approve --profile argon 12
exomind proposal reject --profile argon 12
exomind proposal snooze --profile argon 12
exomind proposal comment --profile argon 12 --content "先改成低优先级"
```

## Agent 调用建议

推荐 Agent / skill / 脚本使用：

```bash
exomind task list --profile argon --status pending --json
exomind proposal add --profile argon --action create_task --title "建议：整理标签" --params-file -
exomind eventlog add --profile argon --content "补记今天的口述" --json
```

建议遵循：

1. 显式传 `--profile` 或 `--user-id`
2. 需要结构化结果时加 `--json`
3. 需要稳定输入时优先 `--params-file`，必要时用 `-` 从 stdin 读入

## 本地状态

CLI 维护一份轻量客户端状态（client state，客户端状态），默认保存在：

- Windows: `%APPDATA%/ExoMind/cli-state.json`
- 测试时可用 `EXOMIND_CLI_STATE_PATH` 覆盖

状态内容属于客户端偏好，不是业务数据：

- `default_target`
- 每个 target 的 `default_profile`
- 每个 target 的 `auth_token`
- 每个 target 的 `last_seen_at`

## 当前范围说明

Phase 1 当前已覆盖：

- 顶层首页帮助
- `examples`
- `rt status / probe / use / clear-default`
- `eventlog add / list / get / watch`
- `task add / list / get / update / start / complete / cancel / suspend / resume`
- `proposal add / list / get / approve / reject / snooze / comment`

后续如继续扩展，应继续保持：

- `CLI = RT client shell`
- `connect-first`
- 不绕过 RT 直接碰 store
