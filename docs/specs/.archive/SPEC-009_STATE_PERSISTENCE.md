# SPEC-009: 状态管理与持久化

> 文档版本：v1.0
> 创建时间：2026-01-29
> 关联：Phase 3, BUF-003, THINK-003, EXEC-003

---

## 1. 概述

### 1.1 目的

定义 Actor 状态的持久化机制，包括：
- 状态快照（Snapshot）
- 状态恢复（Recovery）
- 增量持久化
- 状态版本管理

### 1.2 状态类型

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Actor 状态分类                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         持久状态（长期）                              │   │
│  │  • 配置信息 (config)                                                 │   │
│  │  • 信任等级 (trustLevel)                                             │   │
│  │  • 累计能量消耗 (totalEnergyUsed)                                    │   │
│  │  • 长期记忆 (longTermMemory)                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         半持久状态（会话）                            │   │
│  │  • 当前能量余额 (currentEnergy)                                      │   │
│  │  • 消息队列状态 (messageQueue)                                       │   │
│  │  • 对话上下文 (conversationContext)                                  │   │
│  │  • 最近操作历史 (recentActions)                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         临时状态（内存）                              │   │
│  │  • 当前思考状态 (thinkingState)                                      │   │
│  │  • 正在处理的消息 (processingMessage)                                │   │
│  │  • 缓存数据 (cache)                                                  │   │
│  │  • 临时变量 (tempVariables)                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. ActorState 快照

### 2.1 ActorSnapshot 接口

```typescript
/**
 * Actor 状态快照
 */
interface ActorSnapshot {
  /** 快照版本 */
  version: number;

  /** 快照创建时间 */
  createdAt: number;

  /** Actor 标识 */
  actorId: string;
  actorName: string;

  /** 核心状态 */
  state: ActorState;

  /** 能量状态 */
  energy: {
    current: number;
    total: number;
    used: number;
    lastUpdated: number;
  };

  /** 信任等级 */
  trust: {
    level: number;
    points: number;
    history: TrustChange[];
  };

  /** 消息队列快照 */
  messageQueue: {
    inboxSize: number;
    outboxSize: number;
    messages: SerializedMessage[];
  };

  /** 上下文状态 */
  context: {
    conversationId?: string;
    lastInteraction: number;
    userId?: string;
    metadata: Record<string, unknown>;
  };

  /** 记忆摘要 */
  memory: {
    shortTermCount: number;
    lastSummary?: string;
    embedding?: number[];
  };

  /** 配置快照 */
  config: {
    mode: RunMode;
    preferences: Record<string, unknown>;
    constraints: string[];
  };

  /** 统计信息 */
  stats: {
    messagesProcessed: number;
    actionsExecuted: number;
    uptime: number;
    lastActivity: number;
  };

  /** 校验和 */
  checksum: string;
}
```

### 2.2 StateSerializer 接口

```typescript
/**
 * 状态序列化器
 */
interface StateSerializer {
  /** 序列化状态为可存储格式 */
  serialize(snapshot: ActorSnapshot): string;

  /** 反序列化状态 */
  deserialize(data: string): ActorSnapshot;

  /** 生成校验和 */
  generateChecksum(snapshot: ActorSnapshot): string;

  /** 验证校验和 */
  validateChecksum(snapshot: ActorSnapshot): boolean;

  /** 支持的版本 */
  supportedVersion: number;
}
```

---

## 3. 持久化策略

### 3.1 PersistenceConfig 接口

```typescript
/**
 * 持久化配置
 */
interface PersistenceConfig {
  /** 存储路径 */
  storagePath: string;

  /** 持久化模式 */
  mode: PersistenceMode;

  /** 自动保存间隔（毫秒） */
  autoSaveInterval: number;

  /** 快照保留数量 */
  snapshotRetention: number;

  /** 是否启用压缩 */
  compress: boolean;

  /** 是否启用加密 */
  encrypt: boolean;

  /** 加密密钥（可选） */
  encryptionKey?: string;
}
```

### 3.2 PersistenceMode 枚举

```typescript
/**
 * 持久化模式
 */
enum PersistenceMode {
  /** 实时持久化 - 每次状态变更都保存 */
  REALTIME = "REALTIME",

  /** 定时持久化 - 按间隔保存 */
  SCHEDULED = "SCHEDULED",

  /** 事件驱动 - 关键事件时保存 */
  EVENT_DRIVEN = "EVENT_DRIVEN",

  /** 混合模式 */
  HYBRID = "HYBRID",
}
```

---

## 4. StateManager 实现

### 4.1 StateManager 类

```typescript
/**
 * 状态管理器 - 负责状态的保存和恢复
 */
export class StateManager {
  private serializer: StateSerializer;
  private storage: StateStorage;
  private scheduler: SaveScheduler;
  private pendingChanges: Set<string> = new Set();
  private snapshotRetention: number;
  private config: PersistenceConfig;

  constructor(config: PersistenceConfig) {
    this.config = config;
    this.serializer = new JSONStateSerializer();
    this.storage = new FileStateStorage(config.storagePath, config.compress);
    this.scheduler = new SaveScheduler(config.autoSaveInterval);
    this.snapshotRetention = config.snapshotRetention;

    // 设置调度保存回调
    this.scheduler.onSave(() => this.saveAll());
  }

  /**
   * 保存 Actor 状态
   */
  async save(actorId: string, snapshot: ActorSnapshot): Promise<void> {
    // 生成校验和
    snapshot.checksum = this.serializer.generateChecksum(snapshot);

    // 序列化
    const serialized = this.serializer.serialize(snapshot);

    // 写入存储
    await this.storage.write(actorId, "current", serialized);

    // 标记变更完成
    this.pendingChanges.delete(actorId);

    // 如果启用了事件驱动，保存事件
    if (this.config.mode === PersistenceMode.HYBRID) {
      await this.saveEvent(actorId, "state_change", Date.now());
    }
  }

  /**
   * 创建快照
   */
  async createSnapshot(actorId: string): Promise<void> {
    const timestamp = Date.now();
    const snapshot = await this.getState(actorId);
    snapshot.createdAt = timestamp;

    // 序列化
    const serialized = this.serializer.serialize(snapshot);

    // 写入快照文件
    await this.storage.write(actorId, `snapshot_${timestamp}`, serialized);

    // 管理快照数量
    await this.manageSnapshots(actorId);

    console.log(`📸 状态快照已创建: ${actorId} @ ${new Date(timestamp).toISOString()}`);
  }

  /**
   * 恢复 Actor 状态
   */
  async restore(actorId: string): Promise<ActorSnapshot | null> {
    try {
      // 尝试恢复最新状态
      const currentData = await this.storage.read(actorId, "current");
      if (currentData) {
        const snapshot = this.serializer.deserialize(currentData);

        // 验证校验和
        if (!this.serializer.validateChecksum(snapshot)) {
          console.warn(`⚠️ 状态校验失败，尝试从快照恢复: ${actorId}`);
          return this.restoreFromSnapshot(actorId);
        }

        return snapshot;
      }

      // 如果没有当前状态，尝试从快照恢复
      return this.restoreFromSnapshot(actorId);
    } catch (error) {
      console.error(`❌ 恢复状态失败: ${actorId}`, error);
      return null;
    }
  }

  /**
   * 从快照恢复
   */
  async restoreFromSnapshot(actorId: string): Promise<ActorSnapshot | null> {
    const snapshots = await this.listSnapshots(actorId);
    if (snapshots.length === 0) {
      return null;
    }

    // 使用最新的快照
    const latestSnapshot = snapshots[0];
    const data = await this.storage.read(actorId, `snapshot_${latestSnapshot}`);
    const snapshot = this.serializer.deserialize(data);

    console.log(`📸 从快照恢复: ${actorId} @ ${new Date(snapshot.createdAt).toISOString()}`);
    return snapshot;
  }

  /**
   * 获取状态（如果存在）
   */
  async getState(actorId: string): Promise<ActorSnapshot> {
    const snapshot = await this.restore(actorId);
    if (snapshot) {
      return snapshot;
    }

    // 返回初始状态
    return this.createInitialState(actorId);
  }

  /**
   * 标记状态已变更
   */
  markChanged(actorId: string): void {
    this.pendingChanges.add(actorId);
  }

  /**
   * 保存所有待处理的变更
   */
  async saveAll(): Promise<void> {
    for (const actorId of this.pendingChanges) {
      // 获取最新状态并保存
      const currentState = await this.storage.read(actorId, "current");
      if (currentState) {
        const snapshot = this.serializer.deserialize(currentState);
        await this.save(actorId, snapshot);
      }
    }
  }

  /**
   * 启动自动保存
   */
  startAutoSave(): void {
    if (this.config.mode === PersistenceMode.SCHEDULED ||
        this.config.mode === PersistenceMode.HYBRID) {
      this.scheduler.start();
    }
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    this.scheduler.stop();
  }

  /**
   * 列出所有快照
   */
  async listSnapshots(actorId: string): Promise<number[]> {
    return this.storage.listSnapshots(actorId);
  }

  /**
   * 管理快照数量
   */
  private async manageSnapshots(actorId: string): Promise<void> {
    const snapshots = await this.listSnapshots(actorId);
    if (snapshots.length <= this.snapshotRetention) {
      return;
    }

    // 删除最旧的快照
    const toDelete = snapshots.slice(0, snapshots.length - this.snapshotRetention);
    for (const timestamp of toDelete) {
      await this.storage.delete(actorId, `snapshot_${timestamp}`);
    }
  }

  /**
   * 保存事件
   */
  private async saveEvent(actorId: string, eventType: string, timestamp: number): Promise<void> {
    const eventData = JSON.stringify({ actorId, eventType, timestamp });
    await this.storage.append(actorId, "events", eventData);
  }

  /**
   * 创建初始状态
   */
  private createInitialState(actorId: string): ActorSnapshot {
    return {
      version: 1,
      createdAt: Date.now(),
      actorId,
      actorName: "",
      state: ActorState.CREATED,
      energy: {
        current: 0,
        total: 0,
        used: 0,
        lastUpdated: Date.now(),
      },
      trust: {
        level: 0,
        points: 0,
        history: [],
      },
      messageQueue: {
        inboxSize: 0,
        outboxSize: 0,
        messages: [],
      },
      context: {
        lastInteraction: Date.now(),
        metadata: {},
      },
      memory: {
        shortTermCount: 0,
      },
      config: {
        mode: RunMode.ACTIVE,
        preferences: {},
        constraints: [],
      },
      stats: {
        messagesProcessed: 0,
        actionsExecuted: 0,
        uptime: 0,
        lastActivity: Date.now(),
      },
      checksum: "",
    };
  }
}
```

---

## 5. 存储实现

### 5.1 StateStorage 接口

```typescript
/**
 * 状态存储接口
 */
interface StateStorage {
  /** 写入状态 */
  write(actorId: string, key: string, data: string): Promise<void>;

  /** 读取状态 */
  read(actorId: string, key: string): Promise<string | null>;

  /** 删除状态 */
  delete(actorId: string, key: string): Promise<void>;

  /** 追加数据 */
  append(actorId: string, key: string, data: string): Promise<void>;

  /** 列出快照 */
  listSnapshots(actorId: string): Promise<number[]>;

  /** 检查是否存在 */
  exists(actorId: string, key: string): Promise<boolean>;
}
```

### 5.2 FileStateStorage 实现

```typescript
/**
 * 文件状态存储实现
 */
export class FileStateStorage implements StateStorage {
  private storagePath: string;
  private compress: boolean;

  constructor(storagePath: string, compress: boolean = false) {
    this.storagePath = storagePath;
    this.compress = compress;

    // 确保目录存在
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  async write(actorId: string, key: string, data: string): Promise<void> {
    const filePath = this.getFilePath(actorId, key);

    if (this.compress) {
      data = compressSync(Buffer.from(data));
    }

    writeFileSync(filePath, data, "utf-8");
  }

  async read(actorId: string, key: string): Promise<string | null> {
    const filePath = this.getFilePath(actorId, key);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      let data = readFileSync(filePath, "utf-8");

      if (this.compress) {
        data = decompressSync(Buffer.from(data)).toString("utf-8");
      }

      return data;
    } catch (error) {
      console.error(`读取状态文件失败: ${filePath}`, error);
      return null;
    }
  }

  async delete(actorId: string, key: string): Promise<void> {
    const filePath = this.getFilePath(actorId, key);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  async append(actorId: string, key: string, data: string): Promise<void> {
    const filePath = this.getFilePath(actorId, key);
    const line = data + "\n";
    appendFileSync(filePath, line, "utf-8");
  }

  async listSnapshots(actorId: string): Promise<number[]> {
    const actorPath = join(this.storagePath, actorId);
    if (!existsSync(actorPath)) {
      return [];
    }

    const files = readdirSync(actorPath);
    const snapshots = files
      .filter(f => f.startsWith("snapshot_"))
      .map(f => parseInt(f.replace("snapshot_", ""), 10))
      .sort((a, b) => b - a); // 按时间倒序

    return snapshots;
  }

  async exists(actorId: string, key: string): Promise<boolean> {
    const filePath = this.getFilePath(actorId, key);
    return existsSync(filePath);
  }

  private getFilePath(actorId: string, key: string): string {
    const actorDir = join(this.storagePath, actorId);
    if (!existsSync(actorDir)) {
      mkdirSync(actorDir, { recursive: true });
    }
    return join(actorDir, `${key}.dat`);
  }
}
```

---

## 6. 保存调度器

### 6.1 SaveScheduler 类

```typescript
/**
 * 保存调度器 - 定时触发状态保存
 */
export class SaveScheduler {
  private interval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onSave: () => void;
  private running: boolean = false;

  constructor(intervalMs: number) {
    this.interval = intervalMs;
    this.onSave = () => {};
  }

  /**
   * 设置保存回调
   */
  onSaveCallback(callback: () => void): void {
    this.onSave = callback;
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.timer = setInterval(() => {
      if (this.onSave) {
        this.onSave();
      }
    }, this.interval);

    console.log(`⏰ 自动保存已启动 (间隔: ${this.interval}ms)`);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log(`⏰ 自动保存已停止`);
  }

  /**
   * 手动触发保存
   */
  trigger(): void {
    if (this.onSave) {
      this.onSave();
    }
  }
}
```

---

## 7. 验收标准

- [ ] 支持状态的完整保存和恢复
- [ ] 支持定时自动保存
- [ ] 支持快照管理（自动清理旧快照）
- [ ] 支持状态版本校验
- [ ] 支持增量持久化
- [ ] 支持数据压缩
- [ ] 单元测试覆盖率 > 80%
- [ ] 恢复后状态完整可用

---

## 8. 依赖关系

- 依赖 `src/actor/` - Actor 模块
- 依赖 `src/energy/` - 能量池
- 被 `src/living-agent.ts` - 主程序使用

---

## 9. 相关文档

| 文档 | 路径 |
|------|------|
| SPEC-007 | `docs/specs/SPEC-007_ACTOR_ARCHITECTURE.md` |
| SPEC-008 | `docs/specs/SPEC-008_MAILBOX.md` |

---

*文档创建：2026-01-29*
*状态：待实现*
