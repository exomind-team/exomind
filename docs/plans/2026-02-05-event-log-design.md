# 事件日志本地优先设计方案（Event Log）

## 目标与原则
- 本地优先：任何设备在离线状态也能完整记录事件。
- 事件级追加：事件不可变、仅追加，不做文本级合并。
- `md` 为可读镜像：数据库为真相，`md` 是可解析、可重建的镜像。
- 三类视图：人类 UI、读文件 Agent、MCP 接口 Agent。
- 多端稳定同步：设备间只同步事件与媒体，避免冲突。

## 数据模型（SQLite）
核心表 `events`：
- `event_id` TEXT PRIMARY KEY。格式 `deviceId:time_ms:seq`。
- `event_time_ms` INTEGER。唯一时间字段（UTC 毫秒）。
- `device_id` TEXT。事件产生设备。
- `sender_type` TEXT。`user` / `agent` / `system`。
- `sender_id` TEXT。用户/Agent/系统标识。
- `target_type` TEXT。`user` / `agent` / `device` / `group` / `channel`。
- `target_id` TEXT。目标实体 ID。
- `event_type` TEXT。语义类型（`chat` / `time_block` / `system_log` 等）。
- `content_type` TEXT。承载类型（`text` / `image` / `file` / `json`）。
- `content_text` TEXT。文本内容。
- `content_media` TEXT。JSON，存 hash、mime、尺寸、文件路径。
- `tags` TEXT。JSON 数组。
- `time_block_id` TEXT。时间块标识（可空）。
- `phase` TEXT。`start` / `end` / `point`（仅对 `time_block` 有意义）。
- `meta` TEXT。JSON 扩展字段。

辅助表 `media`：
- `hash` TEXT PRIMARY KEY（sha256）。
- `local_path` TEXT，`size` INTEGER，`mime` TEXT，`width` INTEGER，`height` INTEGER。
- `created_at_ms` INTEGER，`ref_count` INTEGER。

辅助表 `sync_state`：
- `peer_id` TEXT PRIMARY KEY。
- `last_event_time_ms` INTEGER。
- `last_event_id` TEXT（可选，稳定排序用）。

索引建议：
- `events(event_time_ms)`
- `events(sender_id)`
- `events(target_id)`
- `events(time_block_id)`

## Event ID 与排序
- `seq` 为**设备本地**单调递增计数，不跨设备共享。
- 排序规则：先按 `event_time_ms` 升序，再按 `event_id` 升序稳定排序。
- 可选字段 `received_time_ms` 仅用于调试，不参与排序。

## 时间块（番茄计时）建模
- 使用两条事件：`event_type = time_block`，`phase = start` 与 `end`。
- 两条事件共享同一 `time_block_id`。
- 事件可附带 `meta`（如任务名、目标时长等）。

## 同步策略
- 事件级同步：连接时交换本地“水位线”后增量发送事件。
- 去重规则：以 `event_id` 唯一键去重。
- 时钟偏差：可记录 `meta.device_time_offset_ms`，不影响逻辑。
- 断网：本地先写库，恢复网络后自动补发。

## 媒体存储与同步
- 媒体文件存本地 `media/<sha256>`，DB 只保存引用信息。
- 事件同步先到，媒体后补。
- 同步流程：
  - 交换缺失 hash 清单。
  - 需要的媒体分块拉取，校验 hash，原子重命名落盘。
- 默认策略：后台自动补齐。
- 可配置策略：自动 / 按需 / 关闭，支持仅 Wi‑Fi 与缓存上限。

## `md` 镜像
- 文件位置建议 `data/event_log.md`。
- 每条事件生成固定结构块，包含 `event_id`、时间、sender/target、类型、标签、正文。
- 默认增量追加；检测乱序或修复时执行全量重建。
- 读文件 Agent 直接读取 `md`，MCP 提供结构化查询。

## MCP 接口
读接口：
- `list_events(filter)`（时间段、sender/target、type、tags）。
- `get_event(event_id)`。

写接口：
- `append_event(payload)`，由应用端生成 `event_id`、`event_time_ms` 与 `device_id`。
- `client_nonce` 用于幂等去重（可选）。
- `append_media(metadata + binary)` 可选。

## UI 变更（聊天界面 → 事件日志）
- 标题改为“个人事件日志”。
- 事件以聊天气泡展示：
  - 当前设备/当前用户事件在右侧。
  - 其他设备/Agent 事件在左侧。
- 气泡内显示时间、标签与来源。
- 图片事件支持占位与下载状态提示。

## 错误处理与恢复
- DB 写入失败：回退到内存队列并提示重试。
- 媒体缺失：显示占位图 + “待同步”状态。
- 同步失败：指数退避重试，保留失败队列。
- `md` 异常：自动重建（只读镜像，可重写）。

## 测试建议
- 单元测试：`event_id` 生成、排序稳定性、去重合并、时间块成对性。
- 集成测试：离线写入、网络恢复同步、媒体补齐。
- E2E：多端并发写入 + UI 渲染一致性。

## 未决问题
- 是否需要事件删除/编辑（当前方案偏向只追加）。
- 是否需要端到端加密。
- 多用户登录与身份切换策略。

