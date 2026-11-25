# 架构导览

从一次具体操作开始读。桌面用户发送一条带图记录时，窗口捕获输入，草稿控制器冻结待提交内容，Native 检查调用窗口，Host 检查档案资格，Core 在 SQLite 事务中保存事件与回执。复制作业随后按目标设备补齐事实和原件。[草稿控制器](../../src/beta/drafts.ts) · [Native 入口](../../src-tauri/src/beta_native.rs) · [Host](../../crates/exomind-beta-host/src/lib.rs) · [Core 事务](../../crates/exomind-core/src/store.rs)

## 0.6 Beta 的责任边界

| 要回答的问题 | 权威与阅读入口 |
|---|---|
| 哪个档案、哪次操作、哪条记录 | `profile_id` 界定档案。`command_id` 用于重试和查回执。`event_id` 跨副本标识事件。`local_seq` 是某一副本的读取位置。[Core 提交合同](../development/v0.6-beta-core-contract.md) |
| 改字后会发哪一稿，主窗和浮窗谁执行命令 | UI 各自管理焦点和选区。草稿 revision、固定命令和在途回执保护用户新的输入。Native 工作区让两个窗口各自作为客户端。[Native 工作区](../development/beta-native-workspace.md) |
| 连到哪一个 RT、谁有权读或复制 | 稳定 `device_id` 和本次 `runtime_id` 表达不同生命期。Host 分别核验设备成员与档案级 Agent grant。保存的连接配置、实际拨号路径和当前会话分别可查。[B1a 接线边界](../plans/2026-11-22-beta26-b1a-connection-store.md) · [档案授权](../development/beta-agent-grants.md) |
| 另一台能否接手 | Core 保留各来源的事实和证明，Host 按授权补齐。用户需分别知道指定事件、时间块父链和原件字节的情况。打开与系统分享由宿主给出其可观察的结果。[复制合同](../development/beta-multiorigin-sync.md) · [原件生命周期](../development/beta-original-lifecycle.md) |
| 新设备能从哪些材料恢复 | 单档案往返包保留可携带事实、来源证明和能读到的原件；选取内容导出提供 Markdown、manifest 及所选附件。接收端保有自己的运行身份和授权。[备份、选取导出与恢复](../development/beta-user-exports.md) |

产品边界、实际代码位置和验证层级可沿以下三处继续阅读。[架构原则](principles.md) · [Beta 模块维护入口](../../src/beta/README.md) · [版本状态与工作队列](../AI-CONTEXT.md)

## 历史与研究资料

- **旧 Runtime / Alpha 血缘**。v4 分层、Port/Service、Pouch、Mesh/Signal 与 SSE 的资料用于旧版本维护和解释共享 UI 的来源。[历史架构总览](overview.md) · [历史同步分析](ARCH-SYNC.md) · [ECS 通信栈](ECS-communication-stack.md) · [存储和 WebSocket 决策](DECISIONS/)
- **EDS、CRDT 与 Pin**。人写定义讨论数据的语义可移植性。β28 的存储提供器、活动文件夹、保留策略和接力验收以批注后计划为起点。[Pinned/Unpinned 原文](<【人写】2026-04-14 - EDS中数据的可同步性，对应的Pinned属性以及样例.md>) · [研究对照](pinned-unpinned-academic-analysis.md) · [当前迭代计划](../plans/2026-11-25-beta-iteration-after-user-review.md)
- **Agent Workbench、SignalPool 与长期规格**。这些材料保留各自的设计日期、验证范围与职责。[共享图谱](agent-workbench-shared-graph-spec.md) · [统一基础规格](agent-runtime-unified-foundation-spec.md) · [SignalPool](ARCH-signal-pool-agent-process.md)
