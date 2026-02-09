# ExoMind MVP 架构文档

> ExoMind MVP - 外心最小验证版
> 记录生命中的每一个事件

## 1. 系统概述

ExoMind MVP 是一个 CLI 应用程序，用于记录用户的**事件（Event）**和**时间块（TimeBlock）**。它的核心设计理念是：

- **事件驱动**：一切记录都是事件
- **时间块连缀**：用开始/结束事件对定义连续时间段
- **即时持久化**：防止数据丢失
- **单活跃块**：同一时间只能有一个活跃的时间块

## 2. 核心类型定义

### 2.1 Event（事件）

```
┌─────────────────────────────────────────┐
│              Event                      │
├─────────────────────────────────────────┤
│ id: UUID              ← 唯一标识        │
│ timestamp: Timestamp  ← 发生时间        │
│ content: string       ← 记录内容        │
│ tags: Set<Tag>       ← 主题标签        │
│ meta: JSONObject      ← 扩展元数据       │
└─────────────────────────────────────────┘
```

**设计原则**：
- **唯一性**：每个事件有全局唯一的 UUID
- **瞬时性**：事件记录一个时间点
- **内容性**：包含文本内容
- **主题性**：通过标签进行分类
- **扩展性**：元数据支持未来扩展

### 2.2 TimeBlock（时间块）

```
┌─────────────────────────────────────────┐
│            TimeBlock                    │
├─────────────────────────────────────────┤
│ id: UUID              ← 唯一标识        │
│ name: string          ← 块名称          │
│ note: string          ← 个人记录        │
│ startId → Event       ← 开始事件引用     │
│ endId → Event         ← 结束事件引用    │
│ tags: Set<Tag>        ← 主题标签        │
│ meta: JSONObject      ← 扩展元数据       │
└─────────────────────────────────────────┘
```

**设计原则**：
- **连续性**：由开始事件和结束事件定义时间范围
- **层次性**：时间块内容比事件更丰富（名称+记录）
- **非重叠性**（MVP）：同一时间只能有一个活跃块
- **可查询**：`eventsInBlock()` 获取块内所有事件

### 2.3 PlannedTimeBlock（计划中时间块）

```
┌─────────────────────────────────────────┐
│         PlannedTimeBlock                 │
├─────────────────────────────────────────┤
│ startId → Event       ← 开始事件引用     │
│ name: string          ← 块名称          │
│ tags: Set<Tag>        ← 主题标签        │
│ meta: JSONObject      ← 扩展元数据       │
└─────────────────────────────────────────┘
```

**用途**：跟踪当前活跃但未结束的时间块

## 3. 数据模型关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                          数据关系图                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────┐                    ┌──────────────┐            │
│   │   Event 1    │                    │TimeBlock 1  │            │
│   │              │                    │              │            │
│   │ id: e1       │ ──────┐     ┌─────│ id: tb1      │            │
│   │ content:      │       │     │     │ name: 写代码 │            │
│   │   "开始xxx"  │       │     │     │ startId: e1  │            │
│   │ tags:        │       │     │     │ endId: e3    │            │
│   │   [block_    │       │     │     │              │            │
│   │    start]    │       │     │     └──────────────┘            │
│   └──────────────┘       │     │                                  │
│                          │     │                                  │
│   ┌──────────────┐       │     │                                  │
│   │   Event 2    │       │     │                                  │
│   │              │       │     │                                  │
│   │ id: e2       │       │     │                                  │
│   │ content:      │       │     │                                  │
│   │   "笔记"     │       │     │                                  │
│   │ tags: []     │       │     │                                  │
│   └──────────────┘       │     │                                  │
│                          │     │                                  │
│   ┌──────────────┐       │     │                                  │
│   │   Event 3    │       │     │                                  │
│   │              │       │     │                                  │
│   │ id: e3       │ ◄─────┘     │                                  │
│   │ content:      │              │                                  │
│   │   "结束xxx"  │              │                                  │
│   │ tags:        │              │                                  │
│   │   [block_    │              │                                  │
│   │    end]      │              │                                  │
│   └──────────────┘              │                                  │
│                                │                                  │
│   ┌─────────────────────────────────────────┐                      │
│   │           ExoMindLogs                   │                      │
│   │  ┌───────────────────────────────────┐ │                      │
│   │  │ eventsMap: Map<UUID, Event>       │ │                      │
│   │  │   e1 → Event1                     │ │                      │
│   │  │   e2 → Event2                     │ │                      │
│   │  │   e3 → Event3                     │ │                      │
│   │  └───────────────────────────────────┘ │                      │
│   │  ┌───────────────────────────────────┐ │                      │
│   │  │ timeBlocksMap: Map<UUID, TimeBlock│ │                      │
│   │  │   tb1 → TimeBlock1                │ │                      │
│   │  └───────────────────────────────────┘ │                      │
│   └─────────────────────────────────────────┘                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**关键关系**：
1. **事件引用**：TimeBlock 不存储完整 Event，只存储 ID
2. **事件范围**：`eventsInBlock()` 根据 startId 和 endId 的时间戳过滤
3. **扁平存储**：`eventsMap` 和 `timeBlocksMap` 都是 Map 结构

## 4. 核心类实现

### 4.1 EventImpl

```typescript
class EventImpl implements Event {
    readonly id: UUID              // 自动生成 UUID
    readonly timestamp: Timestamp  // Date.now()
    private _content: NoteContent
    private _tags: Set<Tag>
    private _meta?: JSONObject

    // 工厂方法：从 JSON 恢复
    static fromJSON(json: JSONObject): EventImpl

    // 序列化
    toJSON(): JSONObject
}
```

### 4.2 ExoMindLogsImpl

```typescript
class ExoMindLogsImpl implements ExoMindLogs {
    private eventsMap: Map<UUID, Event> = new Map()
    private timeBlocksMap: Map<UUID, TimeBlock> = new Map()

    // 事件管理
    get events(): IterableIterator<Event>
    get eventsByTime(): IterableIterator<Event>
    getEventById(id: UUID): Event | void
    addEvent(content, tags, meta?): Event

    // 时间块管理
    eventsInBlock(timeBlock): IterableIterator<Event>
    get timeBlocks(): IterableIterator<TimeBlock>
    getTimeBlockById(id: UUID): TimeBlock | void
    addTimeBlock(start, end, context): TimeBlock

    // 持久化
    toJSON(): JSONValue
    loadJSON(json: JSONValue): void
}
```

### 4.3 ExoMindAppImpl

```typescript
class ExoMindAppImpl implements ExoMindApp {
    private _logs: ExoMindLogs
    private activeBlock?: PlannedTimeBlockImpl
    private rl: readline.Interface
    private dataFile: string

    // 时间块状态
    get activeStartEvent(): Event | void
    isStartEvent(event): boolean    // tags.has('block_start') || startsWith('开始')
    isEndEvent(event): boolean      // tags.has('block_end') || startsWith('结束')
    addTimeBlock(end, context): TimeBlock

    // 展示
    showEvent(event): string
    showTimeBlock(block): string

    // 生命周期
    saveData(): void
    loadJSON(json: JSONValue): void
    run(): Promise<void>
}
```

## 5. 主要功能流程

### 5.1 开始时间块流程

```
用户输入: "开始写代码"
    │
    ▼
┌─────────────────────────────────────────┐
│  handleStartBlock(name: "写代码")       │
└─────────────────────────────────────────┘
    │
    ├── 检查是否有活跃块
    │       └── 有 → 询问是否结束旧块
    │               └── 结束旧块 → 继续
    │               └── 不结束 → 返回
    │
    ▼
┌─────────────────────────────────────────┐
│  创建开始事件                           │
│  Event {                               │
│      content: '开始时间块 "写代码"',    │
│      tags: ['block_start']              │
│  }                                     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  创建 PlannedTimeBlock                  │
│  PlannedTimeBlock {                     │
│      startId: event.id,                │
│      name: '写代码'                     │
│  }                                     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  设置活跃块                             │
│  this.activeBlock = plannedBlock        │
└─────────────────────────────────────────┘
```

### 5.2 记录普通事件流程

```
用户输入: "学习了函数式编程"
    │
    ▼
┌─────────────────────────────────────────┐
│  handleNote(content)                    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  创建事件                               │
│  Event {                               │
│      content: '学习了函数式编程',       │
│      tags: []                          │
│  }                                     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  添加到日志系统                         │
│  eventsMap.set(event.id, event)         │
└─────────────────────────────────────────┘
```

### 5.3 结束时间块流程

```
用户输入: "结束"
    │
    ▼
┌─────────────────────────────────────────┐
│  endBlock()                            │
└─────────────────────────────────────────┘
    │
    ├── 检查是否有活跃块
    │       └── 无 → 报错返回
    │
    ▼
┌─────────────────────────────────────────┐
│  获取开始事件                           │
│  start = getEventById(activeBlock.     │
│      startId)                          │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  询问用户输入记录/反思                   │
│  "请输入本次时间块的记录/反思（必填）：" │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  创建结束事件                           │
│  Event {                               │
│      content: '结束时间块',             │
│      tags: ['block_end']                │
│  }                                     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  创建 TimeBlock                         │
│  TimeBlock {                            │
│      startId: start.id,               │
│      endId: end.id,                    │
│      name: activeBlock.name,           │
│      note: user_input                  │
│  }                                     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  计算持续时间                           │
│  duration = end.timestamp -             │
│      start.timestamp                    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  清除活跃块                             │
│  this.activeBlock = undefined          │
└─────────────────────────────────────────┘
```

## 6. 数据持久化机制

### 6.1 JSON 结构

```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": 1707283200000,
      "content": "开始时间块 \"写代码\"",
      "tags": ["block_start"]
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "timestamp": 1707285000000,
      "content": "学习了函数式编程",
      "tags": []
    }
  ],
  "timeBlocks": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "name": "写代码",
      "note": "学习了很多新概念",
      "startId": "550e8400-e29b-41d4-a716-446655440000",
      "endId": "550e8400-e29b-41d4-a716-446655440002",
      "tags": []
    }
  ],
  "activeBlock": {
    "startId": "550e8400-e29b-41d4-a716-446655440000",
    "name": "写代码",
    "tags": ["block_start"]
  }
}
```

### 6.2 保存流程

```
用户输入: exit
    │
    ▼
┌─────────────────────────────────────────┐
│  saveData()                            │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  调用 toJSON()                          │
│  this.toJSON()                          │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  JSON 序列化                            │
│  JSON.stringify(data, null, 2)         │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  写入文件                                │
│  fs.writeFileSync(                      │
│      'data/exomind.json',               │
│      jsonString                         │
│  )                                      │
└─────────────────────────────────────────┘
```

### 6.3 加载流程

```
程序启动
    │
    ▼
┌─────────────────────────────────────────┐
│  检查数据文件是否存在                    │
│  fs.existsSync(dataFile)               │
└─────────────────────────────────────────┘
    │
    ├── 不存在 → 跳过加载
    │
    ▼
┌─────────────────────────────────────────┐
│  读取文件                               │
│  fs.readFileSync(dataFile, 'utf-8')    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  JSON 解析                              │
│  JSON.parse(content)                    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  加载事件                               │
│  for event in data.events:             │
│      EventImpl.fromJSON(event)         │
│      eventsMap.set(event.id, event)    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  加载时间块                             │
│  for block in data.timeBlocks:         │
│      start = getEventById(block.       │
│          startId)                       │
│      end = getEventById(block.endId)   │
│      TimeBlockImpl.fromJSON(           │
│          block, start, end)             │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  恢复活跃块（如果有）                   │
│  if data.activeBlock:                   │
│      activeBlock =                     │
│          PlannedTimeBlockImpl.          │
│              fromJSON(activeBlock)      │
└─────────────────────────────────────────┘
```

## 7. 关键设计决策

### 7.1 扁平化数据存储

| 决策 | 原因 | 体现 |
|------|------|------|
| 不嵌套 Event | 避免循环引用 | TimeBlock 只存 startId/endId |
| Map 结构 | O(1) 查找 | `eventsMap.get(id)` |
| 运行时过滤 | 延迟计算 | `eventsInBlock()` 运行时过滤 |

### 7.2 单活跃块模式

```typescript
// MVP 约束：同一时间只能有一个活跃块
if (currentBlock) {
    // 必须先结束旧块，才能开始新块
    const shouldEnd = await confirm('是否帮您结束当前块？');
    if (shouldEnd) {
        await this.endBlock();
    }
}
```

### 7.3 异常检测

```typescript
// 超过 4 小时自动标记异常
const longTag = duration > 4 * 60 * 60 * 1000
    ? color(COLORS.red, ' 🔴 已进行 4+ 小时')
    : '';
```

### 7.4 即时保存

```typescript
// 用户退出时自动保存
if (lower === 'exit' || lower === 'quit') {
    this.saveData();  // 防止数据丢失
    console.log('💾 数据已保存');
    this.exit();
}
```

## 8. 命令参考

| 命令 | 效果 |
|------|------|
| `开始xxx` | 开始一个新的时间块 |
| `结束` | 结束当前时间块，输入记录 |
| 其他文本 | 记录普通事件 |
| `exit/quit/q` | 退出并保存 |

## 9. 文件结构

```
mvp/
├── main.ts           # 主程序入口（CLI 实现）
├── types.ts          # 类型定义（接口）
└── test.ts           # 单元测试
```

---

*文档版本: v1.0*
*更新: 2026-02-08*
