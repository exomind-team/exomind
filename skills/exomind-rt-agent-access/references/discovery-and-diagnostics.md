> 最后更新：`2026-04-16` | 更新者：`Codex` | 更新内容概要：`拆分健康检查、版本、profiles、鉴权边界与 PowerShell curl 约定。`

# Discovery And Diagnostics

## 标识与作用域

当前最容易混淆的是“显示名”和“RT 作用域键”。

| 概念 | 示例 | 含义 |
|------|------|------|
| `displayName` | `Argon` | UI 显示名 |
| `slug` | `argon` | 归一化标识 |
| `profileId` | `profile-argon` | 存储键 |
| `scopeKey` / `user_id` | `profile-argon` | 当前 raw RT 查询参数 |

当前 `profileId` 与 `user_id` 在实现里恰好相同，但这是当前实现，不应当把它当成永远不会变的契约。

`eventlog` 还有两个 scope 细节容易被忽略：

- `user_id` 省略或空串时会落到 `anonymous`
- 非字母数字、`-`、`_` 的字符会被替换成 `_`

本地 profile ID 生成规则在 [`../../../src/lib/profile/profile-storage.ts`](../../../src/lib/profile/profile-storage.ts)：

```ts
function createProfileIdBase(slug: string): string {
  const normalized = normalizeProfileSlug(slug);
  return `profile-${normalized || 'default'}`;
}
```

## 路由可达性与鉴权边界

raw 路由大部分都挂在 protected route tree 上，不在 `public_router()`。

- 顶层公开探活只有 `/health` 与 `/version`
- `eventlog` / `tasks` / `timeblocks` / `profiles` / `signals` / `topology` 都在 protected tree
- 如果 `AppState.auth_secret` 是 `None`，本地开发模式会直接放行
- 非 loopback 绑定若未显式配置 `EXOMIND_RT_SECRET`，RT 会自动生成临时 admin secret
- 开了 `allow_lan_without_auth` 时，私网请求可免 token

鉴权开启时，可用：

- `Authorization: Bearer <token>`
- `?token=<token>`

mesh 的少数公开配对端点不在本文覆盖范围内；它们属于 `routes::public_router()` 的另一层。

## PowerShell 与 curl.exe 约定

在 Windows PowerShell 下：

- 优先用 `curl.exe`，不要依赖 `curl` 别名
- JSON body 尽量写临时文件，再 `--data-binary "@file.json"`
- 如果只是 GET，可以直接内联 URL

示例：

```powershell
$enc = New-Object System.Text.UTF8Encoding($false)
$tmp = Join-Path $env:TEMP "exo-sample.json"
[System.IO.File]::WriteAllText($tmp, '{"title":"示例任务"}', $enc)

curl.exe -sS -X POST "http://127.0.0.1:9124/tasks?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "@$tmp"
```

## 最小探活链路

### 基础可用性

```bash
curl -sS http://127.0.0.1:9124/health
curl -sS http://127.0.0.1:9124/version
curl -sS http://127.0.0.1:9124/topology
curl -sS http://127.0.0.1:9124/profiles
```

当前 live 返回形态示例：

```json
{"status":"ok"}
```

```json
{"version":"0.3.0","git_hash":"2e0b1e2","build_time":"2026-04-14T09:05:27Z"}
```

### 选定档案

如果你知道显示名是 `Argon`，通常会先回读：

```bash
curl -sS http://127.0.0.1:9124/profiles
```

然后确认有：

```json
{"id":"profile-argon","slug":"argon","displayName":"Argon"}
```

之后统一使用：

```text
user_id=profile-argon
```

## 诊断 / 发现类端点

| 端点 | 方法 | 作用 | 备注 |
|------|------|------|------|
| `/health` | GET | 基础健康检查 | 只返回 `status` |
| `/version` | GET | 版本 / git hash / build time | 用于确认真版本 |
| `/topology` | GET | RuntimeHost / Device / DeviceComponent / DeviceLink 视图 | 当前节点拓扑真值 |
| `/profiles` | GET | 已知档案列表 | 从 eventlog scope 推导 |
| `/signals/history` | GET | 全局信号历史 | 无档案隔离 |

### `/topology`

```bash
curl -sS http://127.0.0.1:9124/topology
```

当前返回既包含 legacy flat fields，也包含 nested foundation fields，例如：

- `host_id`
- `hostname`
- `capabilities`
- `runtime_host`
- `device`
- `device_components`
- `device_links`

### `/signals/history`

```bash
curl -sS "http://127.0.0.1:9124/signals/history?limit=20"
curl -sS "http://127.0.0.1:9124/signals/history?limit=20&topic_prefix=task."
curl -sS "http://127.0.0.1:9124/signals/history?limit=20&exclude_topic_prefix=system.link_proof."
curl -sS "http://127.0.0.1:9124/signals/history?limit=20&after_event_id=<signal-id>"
```

查询参数：

- `limit`，默认 `50`
- `topic_prefix`
- `exclude_topic_prefix`
- `after_event_id`

注意：`/signals/history` 是全局窗口，不是档案级真值。涉及具体档案时，回到 `/eventlog?user_id=...` 复核。

## 环境与排障提示

- PowerShell：`curl` 可能是 `Invoke-WebRequest` 别名，明确用 `curl.exe`
- JSON body：长 body 优先写文件，不要硬写一大串转义
- 鉴权问题：先看 `auth_secret`、bind host、`allow_lan_without_auth`
- 作用域问题：显示名不等于 `user_id`，先看 `/profiles`
