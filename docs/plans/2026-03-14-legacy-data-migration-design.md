# 旧版数据一次性迁移设计

> **状态**: 已确认
> **日期**: 2026-03-14
> **范围**: EventLog + Task + TimeBlock 三域统一迁移

---

## 背景

commit `9bb5916` 将三个数据域（EventLog、Task、TimeBlock）的默认存储后端从 legacy（PouchDB/IndexedDB/JSON 文件）切换到 RT SQLite，但 EventLog 和 Task 缺少数据迁移逻辑，导致已有用户启动后看到空数据。TimeBlock 有 lazy migration 但与其他域不一致。

**数据未丢失**——旧数据仍在原存储位置，只是新代码默认读取空的 SQLite 数据库。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 迁移位置 | Bootstrap 层一次性迁移 | 干净，不在读取路径留 fallback |
| 提示方式 | Modal 对话框 | 只弹一次，用户必须明确选择 |
| 失败策略 | 保守——回退 legacy 模式 | 数据安全第一 |
| 跳过行为 | 记住选择 + 设置页手动入口 | 尊重用户意愿 |
| 迁移范围 | 三域统一 | 一致性体验 |
| 旧数据处理 | 保留不删除 | 作为备份 |

## 整体流程

```
应用启动
  ↓
Bootstrap 检测运行时 (tauri?)
  ↓ yes
检查 localStorage: exomind:migrationCompleted
  ↓ 未完成
检查 localStorage: exomind:migrationSkipped
  ↓ 未跳过
并行读取三个旧数据源的数量:
  - EventLog: TauriEventLogStorageAdapter.listEvents().length
  - Task: TaskPouchAdapter.listTasks().length
  - TimeBlock: env.storage.read('time_blocks').length + activeBlock
  ↓ 任一有数据
并行检查 RT SQLite 是否为空:
  - GET /eventlog → 0 条?
  - GET /tasks → 0 条?
  - GET /timeblocks → 0 条 且无 active?
  ↓ RT 侧对应域为空
弹出 MigrationDialog
  ├─ 用户点「立即迁移」→ 执行迁移 → 成功 → 标记完成 → 进入应用
  ├─ 用户点「暂不迁移」→ 标记跳过 → backend mode 切 legacy → 进入应用
  └─ 迁移失败 → backend mode 全切 legacy → 下次启动再提示
```

### 标记机制

- `exomind:migrationCompleted = 'true'` — 已迁移成功，永不再提示
- `exomind:migrationSkipped = 'true'` — 已跳过，不弹窗，设置页留入口

## MigrationDialog UI

### 桌面端

```
┌─────────────────────────────────────────────┐
│                                             │
│    🔄 检测到旧版数据                          │
│                                             │
│    系统检测到以下旧版数据可以迁移到            │
│    新的本地存储格式：                          │
│                                             │
│    ┌─────────────────────────────────────┐   │
│    │  📝 事件日志    128 条              │   │
│    │  ✅ 任务        23 个               │   │
│    │  ⏱️ 时间块      45 个（含进行中 1）  │   │
│    └─────────────────────────────────────┘   │
│                                             │
│    迁移后，数据将统一存储在本地 SQLite         │
│    数据库中，原始数据将保留作为备份。           │
│                                             │
│    ┌───────────┐  ┌──────────────────┐      │
│    │  暂不迁移  │  │  立即迁移 ✨     │      │
│    └───────────┘  └──────────────────┘      │
│                                             │
└─────────────────────────────────────────────┘
```

### 迁移中状态

```
    ┌──────────────────────────────────┐
    │  正在迁移... 事件日志 (2/3)       │
    │  ████████████░░░░  75%           │
    └──────────────────────────────────┘
```

### 移动端适配

- 同样的 Modal，宽度 `max-w-sm`
- 按钮纵向排列：「立即迁移」在上，「暂不迁移」在下

### 设计要点

- 使用 shadcn/ui Dialog 组件
- 不可通过点击背景关闭（`onInteractOutside` prevent）
- 迁移过程中禁止关闭
- "原始数据将保留作为备份" — 给用户安全感

## 迁移执行逻辑

### 迁移顺序

```typescript
const MIGRATION_STEPS = [
  { domain: 'eventlog',  label: '事件日志' },
  { domain: 'task',      label: '任务' },
  { domain: 'timeblock', label: '时间块' },
];
```

### 每个域的数据流

| 域 | 读取旧数据 | 写入新存储 |
|----|-----------|-----------|
| EventLog | `TauriEventLogStorageAdapter.listEvents()` | `POST /eventlog/import/json?strategy=merge` |
| Task | `TaskPouchAdapter.listTasks()` | `POST /tasks/import/json?strategy=merge` |
| TimeBlock (completed) | `env.storage.read('time_blocks')` | `PUT /timeblocks` |
| TimeBlock (active) | `env.storage.read('active_block')` | `PUT /timeblocks/active` |

### 关键设计

- EventLog、Task 使用 RT 已有的 `import/json` API，策略 `merge`（幂等，重复导入安全）
- TimeBlock 没有 import API，使用已有的 `PUT` 接口
- 迁移成功后不删除旧数据（保留作为备份）
- 成功后显式写入三个域的 backend mode 为 `'rt-sqlite'`

### 错误处理

- 任一域迁移失败 → 整体视为失败
- 已成功迁移的域不回滚（merge 策略不破坏数据）
- 三个域的 backend mode 全部切回 `'legacy'`
- 下次启动重新检测（merge 幂等保证安全）

## 设置页手动入口

在「数据」分类下新增注册表项：

```typescript
{
  id: 'data-legacy-migration',
  category: 'data',
  type: 'action',
  label: '迁移旧版数据',
  description: '将旧版存储中的数据迁移到本地 SQLite',
  visible: () => !isMigrationCompleted(),
  onAction: () => openMigrationDialog(),
}
```

迁移完成后自动隐藏。

## TimeBlock lazy migration 清理

统一走一次性迁移后，移除 `TimeBlockServiceImpl` 中的 fallback 逻辑：

- `readActiveBlock()` — 删除 Step 2（env.storage fallback）、Step 3（PouchDB fallback）
- `readCompletedBlockData()` — 删除 Step 2（env.storage fallback）
- 迁移后只需读 RT SQLite，读取路径干净

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/ui/components/MigrationDialog.tsx` | 新建 | 迁移对话框组件 |
| `src/lib/migration/legacy-migration.ts` | 新建 | 检测 + 迁移执行逻辑 |
| `src/config/domain-backend-mode.ts` | 修改 | 新增迁移标记读写函数 |
| `src/lib/environment/bootstrap.ts` | 修改 | 启动时调用迁移检测 |
| `src/ui/app/config/settings/settings-registry.ts` | 修改 | 新增手动迁移入口项 |
| `src/lib/services/timeblock.service.ts` | 修改 | 删除 lazy migration fallback |
| `src/App.tsx` 或入口组件 | 修改 | 挂载 MigrationDialog |
