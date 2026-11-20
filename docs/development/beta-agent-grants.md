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

复制由 Native 显式写入系统剪贴板；失败保留材料供重试，成功也保留到显式清除本机材料、
撤销授权或应用停止。关闭面板、切档只停止观察，不销毁 Native 中的材料，
重新打开后可按原 grant ID 查证并继续复制。清除材料不撤销授权，不清理用户剪贴板。
撤销会拒绝后续请求及失去提交资格的在途动作；不会删除已接受的事实、回执或他端副本。

“复制接入信息”由 Native 将 `exomind-beta/1`、运行中的实际 `/beta/v1` 地址、设备 ID、
当前档案真实显示名/UUID、grant ID/角色/Agent ID 与 bearer 凭据组合为 JSON，并直接写入
系统剪贴板。Renderer 仍只拿 opaque handle 和 metadata；复制失败保留材料供同一 handle 重试。
listener 仅绑定 loopback，其他设备不能直接访问该 API。复制成功只确认剪贴板写入，不代表
外部 Agent 已连接或已读取。

Host 的 `access/check` 现在把 `wait` 与 `export_bundle` 列为真实支持能力。Wait 只等待
同一档案的 profile local sequence 前进，最多 30 秒、全 Host 同时最多 4 个请求；它不模拟
旧 Runtime 的 `/act/await` 条件语义。Export bundle 固定 Core timeline highwater，按请求页数和
JSON 字节预算返回明确 coverage；默认仅原件 metadata，只有显式选择并通过 lifecycle permit
与 hash 校验的原件才附字节。这是受限的 Beta Agent bundle，不是 Markdown/目录导出或全备份。

Wait/bundle 的 HTTP 回归已通过并提交。接入信息、授权 UI 与真实剪贴板/候选验收分别记录；
不能仅凭“接入信息已复制”或模块源码存在宣称 Agent 已连接。

## 接口与回归

Host 的 `grant_management` 负责按档案筛选、固定 ID 签发和撤销。
Native `beta_grant_*` 命令负责可信窗口、关闭态、vault 材料所有权与接入 JSON 的系统剪贴板交付。
Settings 默认只显示「管理 Agent 授权」入口，打开后才读取列表。显隐只关闭观察，材料由
Native 的有界 vault 持有。清除本机接入材料是独立确认动作；其回执未确认时不假报已清除。
旧凭据材料不可得不禁止为其他 Agent 创建独立授权；当前签发回执未知时仍先查证同一 ID。
旧视图的迟到回执不能关闭新档案的表单，或把已由新视图查证完成的意图重新改为未知。

回归覆盖档案隔离、角色、未知回执不重发、复制失败恢复、容量预留、材料释放与撤销差异，
以及内部 Human 与外部 Agent 管理分离。Windows Native 单测的剪贴板回调用合成替身；
它不替代真实系统剪贴板和完整用户叙事验收。

前端 client/state/panel/Settings 四组共 38 项通过；Native 授权与接入信息组 7 项通过。
视图关闭/迟到成功错误销毁材料、旧未知结果覆盖新确认，以及旧材料全局阻止新授权，均有
先失败再通过的回归。共享 ledger 的版本检查和观察通知防止旧回执回退新状态；撤销状态
在迟到签发与列表结果中保持单调。退出应用清除 vault 仍保留原授权，和关闭管理界面分别处理。

早期电脑窗口中的系统剪贴板和普通写入均返回 AccessDenied；后续真实复制已成功，
并核对 observer、档案、grant、实际回环端点及材料保留，没有输出凭据正文。间歇环境错误
不应销毁已有材料或再次签发授权；关闭、清除和撤销的完整窗口路径仍分别验收。

375 像素宽度下，授权名称曾被并排操作挤成竖排。卡片现于窄屏纵向排列信息与动作，
标识详情允许断行；几何回归按实际字体测量完整名称宽度，并继续操作到材料清除确认。
鼠标/暗色与触摸/浅色路径由独立 Edge 布局门禁执行，不代表 Native 权限或剪贴板验收。
