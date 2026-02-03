# SPEC-021: exomind CLI 工具

> 每次新功能开发前必须填写此文档

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | exomind CLI 工具 |
| **创建日期** | 2026-01-29 |
| **优先级** | P2-1 |
| **状态** | 待开发 |

---

## 1. 用户需求

### 1.1 问题描述

当前用户需要管理 exomind 服务时，必须使用：
- `systemctl --user status exomind-web` 查看状态
- `journalctl --user -u exomind-web -f` 查看日志
- `systemctl --user restart exomind-web` 重启服务

这些命令冗长、参数复杂、不易记忆。

### 1.2 使用场景

- **场景1**：开发时快速启动/停止服务
  ```
  $ exomind start    # 启动开发模式
  $ exomind stop     # 停止服务
  ```

- **场景2**：排查问题时查看服务状态和日志
  ```
  $ exomind status   # 查看运行状态
  $ exomind logs     # 查看最近日志
  ```

- **场景3**：服务异常时快速重启
  ```
  $ exomind restart  # 重启服务
  ```

- **场景4**：配置管理
  ```
  $ exomind config show  # 显示当前配置
  $ exomind config edit  # 编辑配置
  ```

### 1.3 期望行为

提供简洁的命令行接口，替代复杂的 systemctl 和 journalctl 命令。

---

## 2. 功能定义

### 2.1 命令结构

```
exomind <command> [options]

可用命令：
├── start     # 启动服务（开发模式）
├── stop      # 停止服务
├── status    # 查看运行状态
├── logs      # 查看日志
├── restart   # 重启服务
├── config    # 配置管理
└── help      # 显示帮助
```

### 2.2 命令详解

#### 2.2.1 start - 启动服务

**用法**：`exomind start [options]`

**选项**：
| 选项 | 描述 |
|------|------|
| `-d, --dev` | 开发模式（默认） |
| `-p, --production` | 生产模式（systemd） |

#### 2.2.2 stop - 停止服务

**用法**：`exomind stop [options]`

**选项**：
| 选项 | 描述 |
|------|------|
| `-f, --force` | 强制终止 |

#### 2.2.3 status - 查看状态

**用法**：`exomind status [options]`

**选项**：
| 选项 | 描述 |
|------|------|
| `-j, --json` | JSON 格式输出 |

#### 2.2.4 logs - 查看日志

**用法**：`exomind logs [options]`

**选项**：
| 选项 | 描述 |
|------|------|
| `-n, --lines <number>` | 显示行数（默认 50） |
| `-f, --follow` | 实时跟踪日志 |
| `-e, --error` | 只显示错误日志 |

#### 2.2.5 restart - 重启服务

**用法**：`exomind restart [options]`

#### 2.2.6 config - 配置管理

**用法**：`exomind config <subcommand>`

**子命令**：`show`, `edit`, `get`, `set`, `reset`

---

## 3. 验收标准

- [ ] `exomind start` 可以启动服务
- [ ] `exomind stop` 可以停止服务
- [ ] `exomind status` 显示正确的运行状态
- [ ] `exomind logs` 显示最近的日志
- [ ] `exomind restart` 可以重启服务
- [ ] `exomind config show` 显示当前配置
- [ ] `exomind -h` 显示帮助信息
- [ ] 命令行交互友好

---

## 4. 架构设计

### 4.1 目录结构

```
src/
└── cli/
    ├── index.ts              # CLI 入口
    ├── commands/             # 命令实现
    │   ├── start.ts
    │   ├── stop.ts
    │   ├── status.ts
    │   ├── logs.ts
    │   ├── restart.ts
    │   └── config.ts
    ├── utils/                # 工具函数
    │   ├── service.ts
    │   ├── logs.ts
    │   └── config.ts
    └── types.ts              # 类型定义
```

### 4.2 核心接口

```typescript
// 服务管理器
interface ServiceManager {
  start(mode: 'dev' | 'production'): Promise<void>;
  stop(force: boolean): Promise<void>;
  status(): Promise<ServiceStatus>;
  restart(force: boolean): Promise<void>;
}

interface ServiceStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  memory?: number;
  address?: string;
  health?: boolean;
}
```

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | 小荷 |
