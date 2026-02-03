# SPEC-015: 多端部署与 Koishi 适配器规范

> 文档版本：v1.0
> 创建时间：2026-01-29
> 状态：评审中

---

## 1. 用户需求

用户要求：
- 使用 Koishi 框架做多端适配（支持 npm 包导入）
- 持续部署，支持 Telegram、网页、软件三端聊天
- 提供网页接口和用户文档
- 每轮循环结束读取 pm/input.md 获取用户新想法

## 2. 输入

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| telegramToken | string | 是 | Telegram Bot Token |
| webPort | number | 否 | Web 服务端口 (默认 3000) |
| wsPort | number | 否 | WebSocket 端口 (默认 3001) |
| adminId | number | 否 | 管理员 Telegram ID |

## 3. 输出

| 参数 | 类型 | 描述 |
|------|------|------|
| serverStatus | object | 服务器运行状态 |
| connectedClients | number | 当前连接的客户端数 |
| messageCount | number | 累计处理消息数 |

## 4. 验收标准

- [ ] Koishi 框架核心通过 npm 包导入
- [ ] Telegram 消息接收延迟 < 1秒
- [ ] WebSocket 实时消息推送
- [ ] 桌面应用通过 Tauri 打包
- [ ] PM2 进程守护，自动重启
- [ ] Docker 镜像支持

## 5. 边界条件

- 代理配置国内环境可用
- WebSocket 断线自动重连
- 消息队列处理高并发

## 6. 架构设计

### 6.1 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Living Agent 系统                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                      Koishi Core                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │  │
│  │  │  Plugin     │  │  Scheduler  │  │  Message Router         │  │  │
│  │  │  Manager    │  │             │  │  (统一消息分发)          │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│              ┌───────────────┼───────────────┐                          │
│              ▼               ▼               ▼                          │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                │
│  │ Telegram      │ │   Web API     │ │  Desktop      │                │
│  │ Adapter       │ │   + WebSocket │ │  (Tauri)      │                │
│  │               │ │               │ │               │                │
│  │ - polling     │ │ - REST API    │ │ - local       │                │
│  │ - proxy       │ │ - ws://       │ │   WebView     │                │
│  └───────────────┘ └───────────────┘ └───────────────┘                │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    消息处理管道                                  │  │
│  │  Input → Classifier → PriorityQueue → Processor → Output       │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    持续部署层                                    │  │
│  │  PM2 (进程守护) + Docker (容器化) + CI/CD (自动部署)            │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 消息流

```
用户消息 ──▶ Adapter ──▶ Koishi Core ──▶ Message Router ──▶ Processor
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                       ▼
            Telegram Response                        WebSocket Push
```

### 6.3 依赖关系

- `koishi` - 核心框架
- `@koishijs/plugin-adapter-telegram` - Telegram 适配器
- `@koishijs/plugin-server` - Web 服务
- `@koishijs/plugin-compose` - 多端消息聚合

## 7. 实现计划

### Phase 1: Koishi 核心集成
- 安装 koishi 和依赖
- 创建 KoishiService 类
- 配置 Telegram 适配器

### Phase 2: Web 接口
- REST API 端点
- WebSocket 实时通信
- 用户认证

### Phase 3: 桌面应用
- Tauri 窗口集成
- 本地 WebView
- 系统托盘

### Phase 4: 持续部署
- PM2 配置文件
- Dockerfile
- 使用指南

## 8. 用户文档结构

```
docs/
├── user-guide.md          # 用户使用指南
├── installation.md        # 安装教程
├── configuration.md       # 配置说明
├── commands.md            # 命令列表
├── troubleshooting.md     # 问题排查
└── api-reference.md       # API 文档
```

## 9. 循环结束检查清单

每轮 Ralph Loop 结束时：
- [ ] 读取 pm/input.md
- [ ] 检查是否有新需求
- [ ] 更新用户文档
- [ ] 生成变更日志
- [ ] 通知用户新功能

---

## 10. 任务拆解

| 任务 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| KOISHI-001 | 安装 koishi 核心依赖 | P0 | 待开始 |
| KOISHI-002 | 创建 KoishiService 类 | P0 | 待开始 |
| KOISHI-003 | 配置 Telegram 适配器 | P0 | 待开始 |
| WEB-001 | 实现 REST API 接口 | P0 | 待开始 |
| WEB-002 | 实现 WebSocket 通信 | P0 | 待开始 |
| DESKTOP-001 | Tauri 窗口集成 | P1 | 待开始 |
| DEPLOY-001 | PM2 部署配置 | P0 | 待开始 |
| DEPLOY-002 | Docker 容器化 | P1 | 待开始 |
| DOCS-001 | 编写用户文档 | P1 | 待开始 |
