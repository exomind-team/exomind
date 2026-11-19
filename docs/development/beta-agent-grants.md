# Beta 外部 Agent 授权

这是冻结 Beta16 之后的源码增量。源码、Native 接线、实际剪贴板与候选验收分别记账，
当前进度见[持续完成计划](../plans/2026-11-19-beta16-frozen-and-beta-completion.md)。

## 权限与所有者

设备配对授权用于档案成员间复制；这里签发的是 HTTP Agent 的档案级权限，两者不能互换。
最小角色为 `observer`；`agent_note` 另可追加 Agent 说明和暂存原件，
`summary_producer` 另可提交外部摘要。读取也受档案、原件资格和撤销检查约束。
不支持从此入口签发 Human、任意自定义能力或 TTL。

Native 工作区内部也使用 Human authority。它不是外部 Agent 授权，不进入此管理列表，
也不能通过此接口查询或撤销；已有内部记录保留。本轮实际回归先复现了“列表混入内部
Human 后不再符合前端角色合同”，再在 Host 查询边界修复，不能靠前端放宽角色解决。

Host 持久保存授权及其撤销状态；Native vault 只持有一次性凭据材料。
Renderer 只能取得 metadata 与 opaque handle，不能取得 bearer。
凭据不进入 DOM、日志、诊断导出或报告。Native vault 最多 8 项、总预算 32 KiB。

## 签发、复制、恢复与撤销

签发绑定稳定的 grant ID、档案、角色和 Agent ID。回执未知时先按同一 ID 查证；
同一 ID 已存在不会再次签发 token。进程重启或材料已释放后，仍可看到授权 metadata，
但不能从 token hash 恢复原凭据。需要新凭据时，明确撤销旧授权后重新签发。

复制由 Native 显式写入系统剪贴板；失败保留材料供重试，成功也保留到显式释放、
关闭面板、切档或应用停止。释放材料不撤销授权，不清理用户剪贴板。
撤销会拒绝后续请求及失去提交资格的在途动作；不会删除已接受的事实、回执或他端副本。

当前复制入口交付凭据；API 端点与用途仍由运行位置入口查看。完整接入信息的一步交接、
真实外部 Agent 使用，以及尚未实现的 Wait/server export bundle，须继续分别验收，
不能仅凭“凭据已复制”宣称 Agent 已连接。

## 接口与回归

Host 的 `grant_management` 负责按档案筛选、固定 ID 签发和撤销。
Native 六个 `beta_grant_*` 命令负责可信窗口、关闭态和 vault 材料所有权。
Settings 显隐只关闭管理视图与释放其材料，不撤销业务权限。

回归覆盖档案隔离、角色、未知回执不重发、复制失败恢复、容量预留、材料释放与撤销差异，
以及内部 Human 与外部 Agent 管理分离。Windows Native 单测的剪贴板回调用合成替身；
它不替代真实系统剪贴板和完整用户叙事验收。
