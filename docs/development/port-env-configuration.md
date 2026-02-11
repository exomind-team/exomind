# 多 Worktree 端口配置指南

## 背景

当同一台机器同时运行多个 ExoMind worktree（例如功能测试分支 + 部署验证分支）时，默认端口会冲突。  
Issue: `#79`

## 支持的环境变量

| 变量名 | 默认值 | 作用 |
|---|---:|---|
| `EXOMIND_WEB_PORT` | `1420` | Vite 开发服务端口 |
| `EXOMIND_HMR_PORT` | `1421` | Vite HMR WebSocket 端口 |
| `EXOMIND_POUCHDB_PORT` | `6984` | PouchDB 同步服务端口 |
| `EXOMIND_ASR_PORT` | `1949` | ASR 后端服务端口 |
| `VITE_SYNC_SERVER_URL` | `http://localhost:6984` | 前端同步服务地址（优先级高于 `EXOMIND_POUCHDB_PORT`） |
| `VITE_ASR_SERVER_URL` | `http://localhost:1949` | 前端 ASR 服务地址（优先级高于 `EXOMIND_ASR_PORT`） |

## 优先级规则

1. 前端同步地址：`VITE_SYNC_SERVER_URL` > `EXOMIND_POUCHDB_PORT` 组装地址 > 默认地址  
2. 前端 ASR 地址：`VITE_ASR_SERVER_URL` > `EXOMIND_ASR_PORT` 组装地址 > 默认地址  
3. Vite 端口：`EXOMIND_WEB_PORT` 和 `EXOMIND_HMR_PORT`（若未设置 HMR 端口，则自动使用 `WEB_PORT + 1`）

## 推荐：每个 worktree 一组端口

### Worktree A

```powershell
$env:EXOMIND_WEB_PORT='1420'
$env:EXOMIND_HMR_PORT='1421'
$env:EXOMIND_POUCHDB_PORT='6984'
$env:EXOMIND_ASR_PORT='1949'
bun run dev:sync
```

### Worktree B

```powershell
$env:EXOMIND_WEB_PORT='1520'
$env:EXOMIND_HMR_PORT='1521'
$env:EXOMIND_POUCHDB_PORT='7084'
$env:EXOMIND_ASR_PORT='2049'
bun run dev:sync
```

## 仅前端开发（不启动同步脚本）

```powershell
$env:EXOMIND_WEB_PORT='1919'
$env:EXOMIND_HMR_PORT='1920'
bun run dev
```

## 验证要点

1. 启动日志中 Web/PouchDB/ASR 端口与环境变量一致。  
2. 浏览器访问地址与 `EXOMIND_WEB_PORT` 一致。  
3. 同步页面默认服务器地址与端口配置一致。  
4. 修改环境变量后，重启进程即可生效。

