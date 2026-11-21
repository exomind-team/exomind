# Beta 单档案往返包

2026-11-20：Core/Host 公共 API 已完成首轮回归；前端入口与 IPC 客户端已有组合回归。
Native 档案往返命令、私有路径边界与持久任务已接线，旧 Native 仍会明确显示不支持。
此文不代表已打包候选或 Android 文件链路通过。历史 Beta19 不含本功能。

## 用户动作和数据边界

`.exomind-profile` 是单档案离线往返包，区别于选取记录的 Markdown/manifest 导出、
Agent bundle 和整个 SQLite 的备份。v1 使用无压缩分帧格式，不解包文件系统路径。
事实保留原事件 ID、作者、设备、来源链和摘要；原件分块读写并校验长度及 SHA-256。

导入先预览，显示冲突、缺失原件、来源证明是否完整，再由 Human 明确确认。新设备保留
自身身份；不导入源端密钥、Agent/peer 授权、令牌、命令回执或本机计时 deadline。
导入历史不等于授权设备，也不等于启动历史中的倒计时或付费模型调用。
预览中的档案名来自包内展示元数据，不作为设备或作者身份保证；异常长或空名称不进入
展示 DTO，仍保留实际档案 ID 供核对。

同一事件 ID 的不同内容不得覆盖目标事实。重复导入相同事实不增加事件，不伪造接收端
命令回执。同 DeviceId 只接纳现存本地来源中的精确重复；不能把它用作身份恢复捷径。
预览绑定包 hash、包 request ID、目标运行实例和目标状态；换包后须重新预览。

## 完成层次

| 字段 | 含义 |
|---|---|
| `facts_complete` | 包内已冻结的来源事实完整 |
| `proofs_complete` | 对应原作者签名证明完整 |
| `bytes_complete` | 包携带所有引用原件字节 |
| `target_bytes_complete` | 目标已有或允许接纳全部所需原件 |
| `complete` | 上述各层均完整 |

缺证明的资料可以在明确的 Human 离线导入下保留，但不会因此变成已验证来源。
缺原件的包仍携带事实和缺件清单，不能标成完整备份。目标已释放或彻底清理的原件
不会因导入旧包而暗中复活；源端生命周期事实只作为历史或明确跟进请求处理。

读取、预览和导入均有字节、条目、来源和事实预算。超限明确失败，不能把截断的前
100 条当作完整档案。调用方须固定输入；Native 接线使用私有不可变暂存包，不允许
Renderer 传入任意文件路径。取消或失败可能留下已接受历史，恢复前重新预览和对账，
不能声称整次导入自动回滚。Native 进程中断与系统选择器恢复另由任务层负责。

## 责任与回归

- Core `replication/profile_archive.rs`：Human 历史接纳能力、同 ID 比较及来源导入。
- Host `profile_archive.rs`：包 framing、签名验证、预算、预览和原件 permit/stage。
- Core `summaries/store.rs`：模型执行还须本机接纳凭据，归档控制事实不能单独取得资格。
- Native：文件选择、私有暂存、任务持有、持久回执及重新选址已接线；系统选择器、进程
  中断恢复与 Android SAF 仍待精确候选/设备验收。
- 前端：档案管理中的“档案备份与导入”；关闭只停止观察，预览后另行确认。新设备
  无需先创建目标档案；导入成功刷新列表，不自动切换档案或清除当前草稿。原件/来源
  不完整与 ID 冲突分别展示；Native 受理回执不被显示为文件已经保存。

最小公共 API 验证：

```text
cargo test --locked -p exomind-core --test profile_archive_admission
cargo test --locked -p exomind-beta-host --test profile_archive_public_api
cargo test --locked -p exomind-core --test summaries
cargo test --locked -p exomind-core --test replication
```

本轮实际执行分别为 3、6、20、17 项，全部通过。公共 API 组包括跨 105 条事实分页、
跨多个 256 KiB 分块的原件往返、重复与冲突、损坏包、预览后换包、缺证明、取消和
预算失败。Windows Job 终态为退出 0 且自有进程清理确认；这不代替完整 Native/UI
或真实 Android 文件系统验收。后续新增回归以实际运行记录为准。
