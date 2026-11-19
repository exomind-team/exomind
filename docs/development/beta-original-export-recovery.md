# Beta 原件导出的中断与查证

本合同来自 Beta17 实物 Android 的 `B17-EXPORT-RESTART`：系统保存选择器打开后，
外心进程被回收；确认保存时新进程无法恢复旧回调，目的文档留下 0 bytes。
同 PID 的另一次 9 MiB 导出及独立 SHA-256 成功，不能把故障泛化为所有 SAF 写入失败。
现场来源与候选边界见 [Beta17 记录](../plans/2026-11-19-beta17-physical-original-diagnostics.md)。
本合同及其源码增量不自动进入已冻结的 Beta17 二进制。

## 不变量与用户行为

| 不变量 | 用户行为语义 |
|---|---|
| 导出运行由 Native 持有，Renderer 只观察 | 隐藏消息、切页或关闭任务面板不取消已经接受的导出 |
| 外部选择器之前先持久记录任务身份 | 应用重启后能找到上次未确认的导出，原件仍保留 |
| 原件、目的文档与任务回执分别确认 | 收到原件不代表已另存为；目的文档存在不代表完整导出 |
| 取消请求与停止回执分开 | 点取消后显示等待确认；不会立即宣称任务已停止 |
| 未确认结果不自动重发、不覆盖目的文件 | 可以先查证状态；重新选址会创建新请求 |

系统回收进程属于运行环境边界，不能承诺业务仍在该进程中运行。本轮提供明确中断与
恢复入口，不实现旧 Activity Result／SAF URI 的跨进程自动续写，也不添加保活服务或
改变用户 VPN、内存清理与系统设置。

## 所有者和接线

- Core／Host 保有原件及其完整性和权限合同。导出恢复清单不修改事实、来源、回执或
  原件字节，不向业务档案写开发报告。
- [Native 导出适配器](../../src-tauri/src/beta_native_export.rs)授权当前档案，持有精确请求
  ID、选择器、复制和读回校验；[纯持久化模块](../../src-tauri/src/beta_export_journal.rs)
  负责有界元数据、原子替换及运行代际。Native setup 显式初始化，不以 Renderer 存在为条件。
- Android 清单位于 `app_data_dir()/beta-native-export-recovery/manifest.json`，与默认
  `beta-host` 并列。拒绝 Host 根重叠和链接根；UI 不能指定目录。桌面历史 API 兼容返回
  空列表，不在 PC 的用户资料目录创建该清单。
- [客户端和 DTO 校验](../../src/beta/original-export.ts)、
  [展示任务所有者](../../src/beta/original-export-tasks.ts)与
  [任务面板](../../src/beta/BetaOriginalExportCenter.tsx)恢复本机结果。关闭页面只停止观察，
  不调用 Native cancel。可见的恢复中任务继续串行查证到终态；空闲不轮询。

`beta_original_export_history(profileId)` 先校验可信窗口及 Native Human 档案权限，再只读
加载和过滤。返回 `request_id/profile_id/original_id/file_name/byte_length/sha256/phase/
failure_code/partial_output`，不含目的路径、URI、凭据或文件内容。UUID 与 Native 一致，
不额外限制合法旧 ID 的版本位。内部运行代际不进入公开 DTO。

## 阶段与剩余影响

| 阶段 | 已确认事项 | 中断后的解释 |
|---|---|---|
| `preparing` | 任务已记录，正在准备经验证的私有副本 | 尚未打开选择器，不声称已有目的文档 |
| `awaiting_destination` | 已准备打开／等待系统选择器 | 系统可能已经创建空文档；回调未到不代表没有外部副作用 |
| `writing` | 已取得目的 URI，正在复制 | 目的位置可能留下部分内容 |
| `verifying` | 正在重新打开目的文档，验证长度和 SHA-256 | 不能仅以复制结束宣布成功 |
| `succeeded` | 读回校验和终态回执提交已确认 | 界面可显示导出完成 |
| `cancelled` | 本次停止已有确认 | 按 `partial_output` 说明可能残留的新文档 |
| `failed` | 有确定失败结果 | 保留原件与错误分类；不自动覆盖或删除目的文档 |
| `interrupted` | 原任务不再活动，或提交结果未确认 | 显示上次未确认，允许查证或以新请求重新选择位置 |

清单最多保留 32 项终态及 1 项活动任务，并有 256 KiB 读取／写入预算。它是本机操作结果
缓存，不是完整导出审计，也不替代 Core 事实。坏 JSON 和不支持的布局明确失败，不清空
重置；初始化失败不阻止整个 Beta 启动。可读历史每次重新检查，临时失败不永久锁死重试。

写入依次为同目录新文件、文件 sync、rename；Android／Unix 再同步目录。rename 已发生
而目录同步失败时结果是 `CommitUnconfirmed`，不能声称没有写入。文件内容校验完成而
终态回执无法确认时，也明确提示结果未确认，既不自动再复制，也不声明最终成功。

前端区分本地 RPC 异常与 Native 查证结果：迟到异常不能覆盖已确认成功；本地异常也不能
阻止随后查到 Native 成功。历史读取不重启业务。空历史不闪现入口；用户已经打开的恢复
面板，在重试得到空结果时显示“暂无导出任务”，直到用户关闭。

## 验证入口与边界

纯持久化回归位于 [journal tests](../../src-tauri/src/beta_export_journal_tests.rs)，由
[Host 测试接缝](../../crates/exomind-beta-host/tests/native_export_journal.rs)引入同一源码，
避免测试持久化时依赖完整 GUI SDK。前端回归为
[导出恢复](../../tests/unit/beta/original-export-recovery.test.tsx)、
[导出客户端](../../tests/unit/beta/original-export.test.ts)和
[呈现独立](../../tests/unit/beta/original-export-ui.test.tsx)。源码 CI 显式运行新回归，拒绝
零测试／跳过；构建、平台行为与源码回归分别记账。

本轮已取得纯 journal 的行为红灯及 Windows 9 项通过、注册真实 handler 后的 Windows
Native `cargo check` 通过；导出相关 29 项、全量 Beta 83 文件／591 项及完整 TypeScript
检查通过。前端同时保留初始缺能力、取消／晚回执／隐藏的反例和两项界面连续性红灯。
Android 目录同步、真实选择器期间进程回收、新候选重启查证及
重新选址仍需使用包含本增量的同签名 APK 验收；不能拿 Beta17 的旧二进制代替。
