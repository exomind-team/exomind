# 多 Worktree 端口配置指南（RT-only）

## 背景

同一台机器并行运行多个 ExoMind worktree 时，主要需要隔离的是：

- Web / HMR
- Embedded RT
- ASR
- MCP Bridge

`PouchDB sync server` 已不再是主链路，本指南只描述当前仍在主路径中的端口与环境变量。

## 支持的环境变量

| 变量名 | 默认值 | 作用 |
|---|---:|---|
| `EXOMIND_WEB_PORT` | `1420` | Vite 开发服务端口 |
| `EXOMIND_HMR_PORT` | `1421` | Vite HMR WebSocket 端口 |
| `EXOMIND_RT_PORT` | `9124` | Embedded RT HTTP 端口 |
| `EXOMIND_RT_BIND` | `127.0.0.1` | Embedded RT 监听地址；局域网联调可设为 `0.0.0.0` |
| `EXOMIND_ASR_PORT` | `1949` | ASR 后端服务端口 |
| `VITE_ASR_SERVER_URL` | 自动推导 | 前端 ASR 服务地址（优先级高于 `EXOMIND_ASR_PORT`） |
| `EXOMIND_BFF_ALLOWED_ORIGINS` | 见规则 | ASR BFF 的 CORS 白名单 |

## 优先级规则

1. 前端 ASR 地址：`VITE_ASR_SERVER_URL` > `EXOMIND_ASR_PORT + 当前 hostname`
2. Vite 端口：`EXOMIND_WEB_PORT` 和 `EXOMIND_HMR_PORT`
3. Embedded RT：`EXOMIND_RT_PORT` + `EXOMIND_RT_BIND`
4. BFF CORS：
   - `EXOMIND_BFF_ALLOWED_ORIGINS='*'`：全部放行，仅建议本地开发临时使用
   - 显式白名单：仅放行白名单
   - 未设置：`development` 默认放行；`production` 默认只放行 `http://<hostname>:<EXOMIND_WEB_PORT>`

## 推荐：每个 worktree 一组端口

### Worktree A

```powershell
$env:EXOMIND_WEB_PORT='1420'
$env:EXOMIND_HMR_PORT='1421'
$env:EXOMIND_RT_PORT='9124'
$env:EXOMIND_ASR_PORT='1949'
bun run dev
```

### Worktree B

```powershell
$env:EXOMIND_WEB_PORT='1520'
$env:EXOMIND_HMR_PORT='1521'
$env:EXOMIND_RT_PORT='9224'
$env:EXOMIND_ASR_PORT='2049'
bun run dev
```

## 局域网联调

```powershell
$env:EXOMIND_RT_BIND='0.0.0.0'
$env:EXOMIND_RT_PORT='9124'
bun run tauri dev
```

说明：

- 真正的多设备同步主路径是 `device pairing + RT net + RT SQLite`
- 不再需要单独启动 `6984` 的 Pouch 同步服务

## 验证要点

1. 启动日志中的 Web / RT / ASR 端口与环境变量一致
2. `bun scripts/dev/tauri-dev-manager.ts list` 中实例状态正常
3. Android / 桌面联调时，RT 可通过 `/health` 正常响应
4. 多设备同步以真实业务域落库为准，不以 UI 连接状态为准
