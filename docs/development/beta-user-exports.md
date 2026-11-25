# Beta 用户导出与档案往返

要在另一台设备继续使用同一档案，选择档案备份与导入。要把几条记录交给其他工具，选择内容导出。下表列出入口与产物。运行环境能否完成系统选取和保存，按对应制品与设备记录核对。[首次使用](../product/beta-first-session.md) · [版本状态](../AI-CONTEXT.md)

| 用户目的 | 入口与产物 | 内容边界 |
|---|---|---|
| 将一个档案带到另一设备，或保留可重新导入的副本 | 管理档案 → 档案备份与导入；`.exomind-profile` v1 无压缩包 | 档案事实、来源证明及可读取的原件；缺失或未验证内容明确标为 partial |
| 将选中的记录、时间块及附件交给其他工具 | 消息／时间块“更多操作”选入清单 → 选取内容导出；未压缩 USTAR | `records.md`、`manifest.json` 和本机持有、符合预算的原件；它不是可往返的完整档案包 |

## 档案往返

空设备也能选择档案包。选择文件只产生私有暂存和预览，尚不创建档案；Human 明确确认后才按原 profile ID 导入。界面不自动切换当前档案或清除草稿。同 ID 的冲突、来源证明缺口、缺件和预算不足保留各自反馈。

新设备保留自身身份，不克隆源设备密钥、owner 凭据、Peer 或 Agent 授权。导入时间块与摘要不会自动开始倒计时或触发模型；原件生命周期事实作为来源历史保留，不在目标设备执行源设备的本机释放。目标已有的 Released/Purged 状态也不被原件导入绕过。

导入可能已经接受部分事实后才失败或取消。它们不会回滚，档案列表在这些终态后刷新，保留内容仍可到达。列表按只增集合合并，晚到的旧列表不能抹掉期间刚创建的档案。

## 选取内容导出

选择按档案分别保留。Capture 选择精确 event ID；时间块选择 block ID。轮转同时引用前后块，两者可以分别选择；一条轮转事实在导出中只出现一次。选择时间块不暗示同时选择附近的 Capture。原文与同档案、目标 ID/digest 匹配的更正分别保留来源。

导出先冻结 highwater。Capture 精确读取，时间块按该快照读取 typed 节点并检查引用；无关时间块节点仍消耗真实扫描预算，超限明确标为不完整。原件通过 Core permit 分块读取和完成校验；释放或撤销使旧 permit 失效。文件使用稳定 ID 作为包内路径，原文件名在 manifest 中保留。

当前边界为 512 项选择、4096 个扫描候选、256 MiB 原件预算，以及各 2 MiB 的 Markdown/manifest。结果分别报告是否保存并校验、内容是否完整、包含／省略的原件数、以及可能的部分输出。不能从“任务已受理”或取消 ACK 推断文件已保存。

## 中断与清理的所有者

Native 持有文件操作，界面只观察。折叠、切页和卸载界面不会取消 Native 任务；取消按原 request ID 明确请求。系统选择器需要正常的系统交互，不缓存或自动恢复旧目的 URI。

范围导出的 UI 在发起调用前保存不超过 64 KiB 的最小意图，只包含设备、来源 runtime、档案、请求和选择身份。持久键按 Device／Device+Profile 定位；runtime 用于来源说明和迟到结果隔离。同设备的新 runtime 只向当前 Native 查证原 request，不自动重发。IndexedDB 严格持久事务不可用时，阻止发起保存并保留明确反馈。

Native 范围导出回执最多保留 32 个终态和一个在途任务，位于实际 Host 根的独立相邻目录。重启后的未完成任务投影为 Interrupted；进入选择器后的任务标记可能有部分输出。终态写入失败返回结果未确认；JSON 损坏保留原文件并报错。状态查询仍须通过目标档案的 Human 授权。

档案往返暂存也位于实际 Host 根的独立相邻目录。创建时在私有 journal 中绑定文件身份；重启后显式放弃会核对身份、类型与链接数。已有完整回执的副本还核对长度和 SHA。未知、替换或无法确认的文件保留；证明字段不返回 Renderer。

范围导出的启动过程不按 UUID 文件名清扫私有 stage 或 manifest 临时文件。跨重启未确认的残片可能保留；桌面目的目录 `.tmp`、SAF 空文档也无法在不保存旧路径／URI 的情况下自动定位。不会删除用户源文件、另存文件或回滚已导入事实，也不将删除逻辑字节描述成 SQLite 已向系统返还空间。

## 维护入口与验证层次

- Host：`profile_archive`、`user_export` 与 `user_export_source`。
- Native：`beta_native_profile_archive`、其私有 journal、`beta_native_user_export` 与其回执 journal。
- UI：`BetaProfileArchives`、`user-range-export-state`、`BetaUserRangeExportControls`，以及消息／时间块操作接线。
- 范围导出 IPC：`beta_user_range_export_capabilities`、`beta_export_user_range`、`beta_user_range_export_status`、`beta_cancel_user_range_export`。
- 反复问题的执行规则见 [Beta 迭代门禁](beta-iteration-guards.md)。原件单独另存的 Android 恢复合同见 [原件导出恢复](beta-original-export-recovery.md)。

归档与范围导出接线时的工作树记录了 733 项 Beta 前端与 90 项 Native 回归通过。复查系统保存时，记录候选版本、设备、系统选择器结果、目标文件及重新打开后的内容。
