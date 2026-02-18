## 变更内容（What Changed）
- 在 `src-tauri/Cargo.toml` 新增 `tauri-plugin-fs` 依赖。
- 在 `src-tauri/src/lib.rs` 注册 `tauri_plugin_fs::init()`，启用跨平台文件系统能力。
- 在 `src-tauri/src/commands/file_commands.rs` 中：
  - 新增 `persist_export_content_for_selected_file(...)`，统一处理 `FilePath`（文件路径类型）两种返回：
    - `FilePath::Path`（本地路径）：沿用 `fs::write` 写入。
    - `FilePath::Url`（URI，安卓常见 `content://...`）：改用 `app.fs().open(...)` + `write_all(...)` 写入。
  - 重构 `save_json_file`，不再假设保存结果一定是本地路径。
- 新增回归测试，覆盖本地路径与 Android `content://` URI 两类写入分支。

## 变更原因（Why）
- 该修复对应 Issue #153：Android 端导出失败。
- 根因是 Android 文件选择器返回的常是 `content://` URI，而旧实现通过 `as_path()` 强制按本地路径处理，导致“无效路径”错误并导出失败。
- 本次修改让导出链路同时兼容 Path 与 URI，修复 Android 端实际失败场景。

## 关键实现细节（Implementation Details）
- 抽象写入逻辑到单独函数，确保路径类型分支明确、错误映射一致（`FileError::IoError`）。
- 对 URI 分支使用 `OpenOptions`（写入/创建/截断）后写入字节内容，避免依赖本地文件系统路径转换。
- 保持前端调用协议不变，成功后仍返回可展示的保存位置字符串（路径或 URI）。

## 验证（Verification）
- `cargo test file_commands` 通过。
- `bun run test tests/unit/settings/export-runtime.test.tsx --run` 通过。
- `bun run build` 通过。

This PR was written using [Vibe Kanban](https://vibekanban.com)