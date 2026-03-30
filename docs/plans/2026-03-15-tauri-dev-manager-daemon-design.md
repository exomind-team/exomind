# Tauri Dev Manager Daemon 设计

## 需求

1. **多实例管理**：一条命令启动当前工作区的 ExoMind 实例（桌面/Android/多个），自动分配端口
2. **日志流式连接**：可以 attach 到任意运行中实例的原生进程日志

## 命令设计

```bash
# Phase 1: 前台模式（类似 docker-compose up）
bun tauri:manager up                              # 启动所有配置的实例，前台运行
bun tauri:manager up --name desktop               # 只启动指定实例
bun tauri:manager up --name desktop --name phone --target phone:android

# Phase 2: 后台 daemon 模式
bun tauri:manager daemon                          # 启动后台 daemon
bun tauri:manager attach desktop                  # 连接到某个实例的日志流
bun tauri:manager attach --all                    # 连接所有实例日志（带前缀）
bun tauri:manager stop desktop                    # 停止某个实例
bun tauri:manager stop --all                      # 停止所有

# 保留现有命令
bun tauri:manager start --name desktop            # 老方式（detach + 文件日志）
bun tauri:manager list                            # 列出所有实例
bun tauri:manager logs --name desktop --tail 20   # 看文件日志
```

## 架构

```
                    ┌─────────────────────────────┐
                    │   Manager Daemon (Node/Bun)  │
                    │                              │
  CLI attach ──────►│  IPC Server (localhost TCP)  │
                    │       ↕            ↕         │
                    │  ┌─────────┐ ┌─────────┐    │
                    │  │ desktop │ │  phone  │    │
                    │  │ (pipe)  │ │ (pipe)  │    │
                    │  └────┬────┘ └────┬────┘    │
                    │       ↓            ↓         │
                    │   日志文件    日志文件        │
                    └─────────────────────────────┘

子进程 stdio: pipe（不是文件重定向）
daemon 读取 pipe → tee 到文件 + 广播到 attached 客户端
```

## IPC 协议（TCP localhost）

```json
// attach 请求
{"cmd": "attach", "name": "desktop"}     // 单实例
{"cmd": "attach", "name": "*"}           // 所有

// 日志推送（daemon → client）
{"instance": "desktop", "line": "[INFO] [SignalStream] SSE started", "ts": 1710000000}

// 控制命令
{"cmd": "stop", "name": "desktop"}
{"cmd": "list"}
{"cmd": "status"}
```

## 实现计划

### Phase 1: `up` 命令（前台模式）
- 改造 `startCommand`：`stdio: pipe` 替代文件重定向
- 前缀 `[instance-name]` 打印到终端 + tee 到文件
- Ctrl+C → graceful stop：先 SIGTERM，等进程退出，再清理元数据
- 解决 os error 5：stop 后 sleep 等文件句柄释放

### Phase 2: `daemon` + `attach`
- daemon: 后台进程，启动 TCP IPC server（端口写入 `.tmp/tauri-dev-manager.sock`）
- attach: 连接 IPC，接收 JSON lines 日志流
- stop: 通过 IPC 发 stop 命令，daemon 杀子进程并等待退出

## 工作区感知

自动检测当前目录是否在 git worktree 中，用 worktree 名作为实例前缀：
```bash
# 在 exomind 主目录
bun tauri:manager up  →  instance: "desktop"

# 在 exomind-user-alice worktree
bun tauri:manager up  →  instance: "alice-desktop"
```

## 文件变更

- `scripts/dev/tauri-dev-manager.ts` — 新增 `up`/`daemon`/`attach` 命令
- `scripts/dev/tauri-dev-manager-lib.ts` — 新增 IPC 协议类型
