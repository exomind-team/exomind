# SPEC-010 持续运行系统

> 文档版本：v1.0
> 创建时间：2026-01-29
> 状态：待评审

---

## 1. 用户需求

### 1.1 问题背景

自主生命体需要 **7x24 小时持续运行**，但当前存在以下问题：
- 进程崩溃后无法自动重启
- 能量耗尽时无法优雅休眠
- 无法定时唤醒执行任务
- 缺乏运行状态监控

### 1.2 用户期望

- 进程异常崩溃后 **自动重启**
- 能量不足时 **自动休眠**，有能量时 **自动唤醒**
- 定时任务 **准时执行**
- 实时监控 **运行状态**

---

## 2. 输入

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| config | PersistenceConfig | 是 | 持久化配置 |
| energyThreshold | number | 否 | 休眠能量阈值（默认 10%） |
| checkInterval | number | 否 | 状态检查间隔（默认 60000ms） |
| maxRetries | number | 最大重试次数（默认 5） |

---

## 3. 输出

| 参数 | 类型 | 描述 |
|------|------|------|
| RunningStatus | enum | 运行状态 |
| HealthReport | object | 健康检查报告 |
| SystemMetrics | object | 系统指标 |

---

## 4. 验收标准

- [ ] roahp 配置完成，进程守护生效
- [ ] 能量 < 10% 时自动休眠
- [ ] 能量 > 50% 时自动唤醒
- [ ] 定时任务准时执行
- [ ] 健康检查接口返回状态
- [ ] 日志聚合功能正常

---

## 5. 架构设计

### 5.1 组件结构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        持续运行系统                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐          │
│  │   roahp       │───→│   Supervisor  │───→│   Monitor      │          │
│  │   进程守护     │    │   监督者      │    │   监控器       │          │
│  └───────────────┘    └───────────────┘    └───────────────┘          │
│                                                                         │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐          │
│  │   SleepManager│───→│   WakeScheduler│───→│   Logger      │          │
│  │   休眠管理     │    │   唤醒调度     │    │   日志聚合     │          │
│  └───────────────┘    └───────────────┘    └───────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 类设计

```typescript
/**
 * 持续运行管理器
 */
class ContinuousRunner {
  private supervisor: Supervisor;
  private monitor: SystemMonitor;
  private sleepManager: SleepManager;
  private wakeScheduler: WakeScheduler;
  private logger: UnifiedLogger;
  private isRunning: boolean = false;

  async start(): Promise<void>;
  async stop(): Promise<void>;
  async getStatus(): Promise<RunningStatus>;
  async getHealthReport(): Promise<HealthReport>;
}

/**
 * 进程监督者
 */
class Supervisor {
  private childProcess: ChildProcess | null = null;
  private maxRetries: number = 3;
  private retryDelay: number = 5000;

  async start(): Promise<void>;
  async stop(): Promise<void>;
  async restart(): Promise<void>;
  onCrash(callback: (error: Error) => void): void;
}

/**
 * 系统监控器
 */
class SystemMonitor {
  private metrics: SystemMetrics;
  private checkInterval: number = 60000;

  async getMetrics(): Promise<SystemMetrics>;
  async getHealth(): Promise<HealthStatus>;
  startMonitoring(): void;
  stopMonitoring(): void;
}

/**
 * 休眠管理器
 */
class SleepManager {
  private energyThreshold: number = 0.1;
  private lastCheckTime: number = 0;

  async shouldSleep(): Promise<boolean>;
  async enterSleep(): Promise<void>;
  async exitSleep(): Promise<void>;
  setThreshold(threshold: number): void;
}

/**
 * 唤醒调度器
 */
class WakeScheduler {
  private scheduledTasks: Map<string, ScheduledTask>;

  schedule(task: ScheduledTask): string;
  cancel(taskId: string): void;
  getScheduledTasks(): ScheduledTask[];
  async executeDueTasks(): Promise<void>;
}

/**
 * 统一日志器
 */
class UnifiedLogger {
  private logLevel: LogLevel = LogLevel.INFO;
  private logs: LogEntry[] = [];

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
  getRecentLogs(level?: LogLevel, limit?: number): LogEntry[];
  async flush(): Promise<void>;
  async rotate(): Promise<void>;
}
```

### 5.3 数据流

```
用户配置
    │
    ▼
┌──────────────┐
│ ContinuousRunner │
└──────┬───────┘
       │
       ├─────────────────────────────────────┐
       │                                     │
       ▼                                     ▼
┌──────────────┐                     ┌──────────────┐
│ SleepManager │                     │ WakeScheduler│
│ (能量检测)    │                     │ (定时任务)    │
└──────┬───────┘                     └──────┬───────┘
       │                                     │
       ▼                                     ▼
┌──────────────────────────────────────────────────────┐
│                    Supervisor                         │
│         (进程守护 + 自动重启 + 状态监控)               │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  UnifiedLogger │
              │   (日志聚合)    │
              └────────────────┘
```

---

## 6. 依赖关系

| 依赖 | 版本 | 用途 |
|------|------|------|
| node:child_process | 内置 | 进程管理 |
| node:fs | 内置 | 文件操作 |
| node:os | 内置 | 系统信息 |
| node:events | 内置 | 事件处理 |

---

## 7. 实现细节

### 7.1 roahp 配置

```typescript
// 进程守护配置
interface RoahpConfig {
  script: string;           // 入口脚本
  cwd: string;              // 工作目录
  env: Record<string, string>; // 环境变量
  maxRestarts: number;      // 最大重启次数
  minUptime: number;        // 最小运行时间
  restartDelay: number;     // 重启延迟
}

// 自动重启策略
const autoRestart = () => {
  let restartCount = 0;
  const maxRestarts = 5;
  const baseDelay = 1000;

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);

    if (restartCount < maxRestarts) {
      restartCount++;
      const delay = baseDelay * Math.pow(2, restartCount - 1);
      console.log(`🔄 ${delay/1000}秒后自动重启... (第${restartCount}次)`);

      setTimeout(() => {
        execSync("nohup bun run src/living-agent.ts > /tmp/bot.log 2>&1 &");
        process.exit(0);
      }, delay);
    } else {
      console.error("❌ 超过最大重启次数，停止自动重启");
      process.exit(1);
    }
  });
};
```

### 7.2 能量检测休眠

```typescript
// 能量检测休眠
const energyBasedSleep = async () => {
  const SLEEP_THRESHOLD = 0.1;  // 10%
  const WAKE_THRESHOLD = 0.5;   // 50%
  const CHECK_INTERVAL = 60000; // 1分钟

  setInterval(async () => {
    const energy = await energyPool.getAvailableEnergy();

    if (energy < SLEEP_THRESHOLD && state !== ActorState.SLEEPING) {
      console.log(`🔋 能量不足 (${energy * 100}%)，进入休眠模式`);
      await actor.sleep();
    } else if (energy > WAKE_THRESHOLD && state === ActorState.SLEEPING) {
      console.log(`⚡ 能量恢复 (${energy * 100}%)，唤醒系统`);
      await actor.wake();
    }
  }, CHECK_INTERVAL);
};
```

### 7.3 定时唤醒

```typescript
// 定时任务调度
const scheduledWakeTasks = new Map<string, NodeJS.Timeout>();

const scheduleWake = (time: string, task: () => Promise<void>) => {
  const [hours, minutes] = time.split(":").map(Number);
  const now = new Date();
  const scheduledTime = new Date(now);
  scheduledTime.setHours(hours, minutes, 0, 0);

  if (scheduledTime <= now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }

  const delay = scheduledTime.getTime() - now.getTime();

  const timeout = setTimeout(async () => {
    await task();
    // 重新调度下一次
    scheduleWake(time, task);
  }, delay);

  scheduledWakeTasks.set(time, timeout);
  console.log(`⏰ 已调度定时任务: ${time}`);
};

// 示例：每天早上 8 点检查更新
scheduleWake("08:00", async () => {
  console.log("☀️ 早上好，执行每日检查...");
  await checkForUpdates();
  await syncMemory();
});
```

### 7.4 健康检查

```typescript
// 健康检查接口
const healthCheck = async (): Promise<HealthReport> => {
  const report: HealthReport = {
    status: "healthy",
    timestamp: Date.now(),
    checks: {
      process: checkProcessHealth(),
      memory: checkMemoryHealth(),
      energy: checkEnergyHealth(),
      network: checkNetworkHealth(),
    },
    metrics: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
    },
    issues: [],
  };

  // 检查是否有问题
  for (const [key, check] of Object.entries(report.checks)) {
    if (!check.passed) {
      report.status = "degraded";
      report.issues.push({
        component: key,
        message: check.message,
        severity: check.severity,
      });
    }
  }

  return report;
};

app.get("/health", async (req, res) => {
  const report = await healthCheck();
  res.json(report);
});
```

### 7.5 日志聚合

```typescript
// 统一日志格式
interface LogEntry {
  timestamp: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
  source?: string;
}

// 日志聚合
const unifiedLogger = {
  logs: [] as LogEntry[],

  log(level: string, message: string, context?: Record<string, unknown>) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: level as LogEntry["level"],
      message,
      context,
      source: "living-agent",
    };

    this.logs.push(entry);

    // 保持日志在合理大小
    if (this.logs.length > 10000) {
      this.logs = this.logs.slice(-5000);
    }

    // 控制台输出
    const output = level === "error" ? console.error :
                   level === "warn" ? console.warn :
                   level === "debug" ? console.debug : console.log;
    output(`[${level.toUpperCase()}] ${message}`, context || "");
  },

  getRecentLogs(level?: string, limit: number = 100): LogEntry[] {
    let logs = this.logs;
    if (level) {
      logs = logs.filter(l => l.level === level);
    }
    return logs.slice(-limit);
  },

  async flush(): Promise<void> {
    // 持久化到文件
    const logPath = `/tmp/living-agent-${Date.now()}.log`;
    const content = this.logs.map(l =>
      JSON.stringify({ ...l, timestamp: new Date(l.timestamp).toISOString() })
    ).join("\n");
    await writeFile(logPath, content, "utf-8");
    console.log(`💾 日志已持久化: ${logPath}`);
  },
};
```

---

## 8. 测试策略

### 8.1 测试用例

| 用例 | 类型 | 预期结果 |
|------|------|----------|
| Supervisor 启动/停止 | 单元测试 | 正确管理子进程 |
| 自动重启机制 | 单元测试 | 崩溃后自动重启 |
| 能量检测休眠 | 单元测试 | 能量低时进入休眠 |
| 定时唤醒 | 单元测试 | 定时任务准时执行 |
| 健康检查 | 集成测试 | 返回正确状态 |
| 日志聚合 | 集成测试 | 日志正确收集 |

### 8.2 测试命令

```bash
# 运行持续运行相关测试
bun test -- tests/continuous.test.ts

# 运行所有测试
bun test
```

---

## 9. 检查清单

- [ ] roahp 配置完成
- [ ] 进程守护功能正常
- [ ] 能量检测休眠生效
- [ ] 定时唤醒任务正常
- [ ] 健康检查接口可用
- [ ] 日志聚合功能正常
- [ ] 单元测试 > 80% 覆盖

---

*文档创建：2026-01-29*
*评审状态：待评审*
