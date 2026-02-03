# exomind-web 基础框架

> exomind-web 是 Life OS 的网页入口，提供全功能现代化界面

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | exomind-web 基础框架 |
| **创建日期** | 2026-01-29 |
| **优先级** | P0 |
| **状态** | 待开发 |
| **Spec 编号** | SPEC-016 |

---

## 1. 用户需求

### 1.1 问题描述

Life OS 需要一个现代化的网页入口，替代原有的 telegram-bot 独立部署模式，提供：
- 统一的 Web 界面
- 资源实时监控（MiniMax 额度）
- 语音输入/输出能力
- Agent 协调接口

### 1.2 使用场景

- **场景1**：用户在网页中与 Agent 对话，输入语音或文字
- **场景2**：用户通过网页查看 MiniMax 额度使用情况
- **场景3**：管理员通过健康检查端点监控服务状态

### 1.3 期望行为

| 功能 | 期望行为 |
|------|----------|
| 项目名称 | 从 `telegram-bot` 重命名为 `exomind-web` |
| 服务端口 | 监听端口 **1949** |
| 健康检查 | 提供 `/health` 端点返回 JSON 状态 |
| 网页 UI | 四视图框架（对话/任务/财务/资源） |
| systemd 部署 | 用户级 systemd 服务，开机自启 |

---

## 2. 功能定义

### 2.1 输入

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| PORT | number | 否 | 1949 | 服务监听端口 |
| NODE_ENV | string | 否 | development | 运行环境 |
| TELEGRAM_BOT_TOKEN | string | 否 | - | Telegram Bot Token |
| TELEGRAM_PROXY | string | 否 | - | Telegram 代理地址 |

### 2.2 输出

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 返回网页 UI |
| `/health` | GET | 健康检查端点 |
| `/status` | GET | 服务状态端点 |

### 2.3 处理逻辑

```
用户请求
    ↓
nginx/代理 (1949)
    ↓
exomind-web 服务
    ├── / → 返回静态 HTML (四视图框架)
    ├── /health → 返回 {status: "ok", uptime: xxx}
    └── /api/* → 路由到对应处理器
```

---

## 3. 验收标准

- [ ] 项目目录从 `telegram-bot` 重命名为 `exomind-web`
- [ ] 服务监听端口改为 **1949**
- [ ] `/health` 端点返回 JSON 格式状态
- [ ] systemd 服务名改为 `exomind-web`
- [ ] 网页 UI 四视图框架可正常加载
- [ ] 所有现有单元测试通过 (342/342)
- [ ] 部署后服务可正常启动

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 端口 1949 被占用 | 提示端口冲突，退出启动 |
| 环境变量未设置 | 使用默认值，开发模式运行 |
| systemd 服务启动失败 | 查看日志排查问题 |
| 健康检查超时 | 返回 503 状态码 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| EADDRINUSE | Port 1949 is already in use | 提示用户更换端口 |
| ENOENT | Config file not found | 使用默认配置 |
| SERVICE_START_FAILED | systemd 服务启动失败 | 输出 journalctl 查看日志 |

---

## 6. 依赖关系

### 6.1 依赖模块

- `src/api-server.ts` - API 服务核心
- `src/living-agent.ts` - Agent 核心逻辑
- `src/dashboard.ts` - 网页控制面板

### 6.2 外部依赖

- **systemd** - 进程守护和开机自启
- **nginx/Caddy** - 反向代理（可选）
- **MiniMax API** - 额度查询

---

## 7. 架构设计

### 7.1 目录结构

```
exomind-web/
├── src/
│   ├── api-server.ts      # API 服务入口 ⭐ (端口 1949)
│   ├── living-agent.ts    # Agent 核心
│   ├── dashboard.ts       # 网页 UI
│   ├── actor/             # Actor 架构
│   ├── signals/           # 信号池
│   ├── energy/            # 能量池
│   ├── trust/             # 信任度
│   └── growth/            # 成长系统
├── deploy/
│   ├── install.sh         # systemd 安装脚本 ⭐
│   ├── uninstall.sh       # 卸载脚本
│   └── exomind-web.service # 服务定义文件 ⭐
├── tests/                 # 单元测试
├── docs/
│   └── specs/             # Spec 文档
├── pm/
│   ├── agent.md           # Agent 配置
│   ├── input.md           # 任务队列
│   └── memory/
│       └── long-term.md   # 长期记忆
├── package.json
└── README.md
```

### 7.2 服务配置

```typescript
interface ExomindConfig {
  port: number;        // 1949
  host: string;        // "0.0.0.0"
  env: "development" | "production";
  services: {
    telegram: boolean; // 是否启用 Telegram
    websocket: boolean; // 是否启用 WebSocket
  };
}
```

### 7.3 systemd 服务定义

```ini
[Unit]
Description=Exomind Web - Life OS 网页入口
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/bun run /path/to/exomind-web/src/api-server.ts
WorkingDirectory=/path/to/exomind-web
Restart=always
RestartSec=10
Environment=PORT=1949
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

### 7.4 数据流

```
浏览器 → HTTP (1949) → API Server → 各模块处理 → 响应
                    ↓
              健康检查 → 返回 {status, uptime, memory}
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 健康检查正常 | GET /health | {status: "ok", uptime: > 0} |
| 端口配置 | PORT=1949 | 服务监听 1949 |
| 服务状态 | GET /status | 包含服务正常运行信息 |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 启动测试 | 启动服务 | 服务正常运行 |
| 健康测试 | curl localhost:1949/health | 返回 200 + JSON |
| 重启测试 | systemctl restart exomind-web | 服务重新运行 |

---

## 9. 文档更新

- [ ] 更新 README.md (项目名称、端口 1949)
- [ ] 更新 agent.md (服务名 exomind-web)
- [ ] 更新 deploy/install.sh (服务名 exomind-web)

---

## 10. 实施计划

### Step 1: 项目重命名配置
- [ ] 更新 package.json (name: "exomind-web")
- [ ] 更新 agent.md (服务名、端口)
- [ ] 更新 deploy/install.sh

### Step 2: 端口配置 (1949)
- [ ] 更新 api-server.ts (默认端口 1949)
- [ ] 更新 agent.md (端口配置)

### Step 3: 健康检查端点
- [ ] 确保 /health 端点正常工作
- [ ] 添加 /status 端点（可选）

### Step 4: systemd 部署
- [ ] 更新 exomind-web.service (服务名、端口)
- [ ] 更新 deploy/install.sh
- [ ] 测试安装脚本

### Step 5: 测试验证
- [ ] 运行 bun test (342/342 通过)
- [ ] 部署测试

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | 小荷 |
