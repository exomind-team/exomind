# ADR-003: 重构 FileStorage 模块 - 统一存储抽象

## 状态

已批准

## 背景

当前 `src/lib/db/` 存在以下问题：
1. 缺乏统一的存储接口抽象
2. 错误处理不一致（各模块自行定义）
3. 类型定义分散
4. JSONL 和 SQLite 实现无法互换

## 决策

创建统一的存储抽象层，包含：
1. `Storage` 接口定义核心存储操作
2. `StorageError` 自定义错误类型
3. `JSONLStorageAdapter` JSONL 适配器
4. `StorageResult<T>` 结果类型包装

## 影响

- 新增文件：`src/lib/db/types.ts`, `src/lib/db/errors.ts`, `src/lib/db/storage.ts`
- 修改文件：`src/lib/db/jsonl.ts`, `src/lib/db/sqlite.ts`
- 后端：`src-tauri/src/commands/file_commands.rs` 重构为统一的命令模式
