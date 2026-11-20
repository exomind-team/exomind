# Core11：有界历史读取与更正来源

本合同描述源码能力。冻结 Beta19/6019 使用 Core10，不能把本合同当作该包的验收结果。
Core11 是本轮尚未发布的 schema；跨端事实交换前严格拒绝 Core8/9/10，升级联调须两端
使用匹配候选。本机升级通过事务新增索引，不重写旧事实、回执或旧摘要。
旧库的生成方式见 [Core10 固定历史输入](beta-core10-migration-fixture.md)。

数据库版本与 Native 功能接口版本分别校验。原件生命周期的 IPC 仍为 schema 1，
Core10/11 均提供相同 DTO；客户端保留实际 `core_schema`，接受这两个已验证版本。
不能因数据库新增索引而禁用原件管理，也不能把未知版本自动当作已兼容。对应回归
覆盖 Core11 被旧客户端拒绝的行为红灯、Core10 保留、未知版本拒绝与恢复/管理面板。

## 历史与日历窗口

默认展示全部历史；日、周、月是用户主动选择的浏览范围。前端按本机 IANA 时区计算
半开 UTC 毫秒窗口 `[from_ms, to_ms)`，默认周一为周起点。跨夏令时的日可以是 23 或
25 小时，不能用固定 24 小时平移。窗口变化会重新取得固定 highwater；分页沿用该快照，
晚到的旧窗口结果不能替换当前页。标签返回快照也绑定模式和时间边界。

Core 的 `timeline_period_page` 与 Host `/beta/v1/profiles/:profile/timeline/period`
组合时间、正文和标签查询。时间块按 `effective_at_ms` 归入窗口，记录仍保留原
`occurred_at_ms`，不借范围读取改写事实。旧的无窗口分页接口保留；客户端先检查
`timeline_period` 与 `typed_timeline` 能力，旧服务不支持时明确说明可用范围。

每页另有 4096 个候选和 16 MiB body 工作预算。超预算返回
`timeline_period_budget_exceeded`，不返回一页伪完整结果。预算在正文/标签过滤前计费，
不能建议用户“加标签就一定能消除超预算”；可缩小日历窗口或返回全部历史逐页读取。

## 回顾冻结的更正

用户已决定：冻结前的原文与匹配更正分别进入模型材料，保留各自来源，不覆盖原文。
新内置回顾材料含独立的 `correction/1`，绑定同档案、目标事件、目标 digest 和 origin
cursor；多个并发更正都保留。被输入预算排除的原文及其更正一起排除，coverage 明示
未读材料。新材料使用 v4 提示；旧 v3 artifact 继续以原 digest 验证，不重新生成或改写。

匹配候选通过 Core11 的 `summary_correction_target_digest_sequence` 索引读取：
每目标最多 64 个、总共 256 个匹配候选、192 KiB 更正正文。索引先限定 profile、目标、
digest 和冻结范围，在读取正文前核算长度；冲突 digest 不消耗匹配材料预算。单个目标
达到上限后继续处理其他目标。`local_seq` 只用于本地遍历，不能作为跨来源真伪或新旧
裁决；跨设备冻结后变化仍以 `snapshot.origin_heads` 判断。

外部 Agent summary 的证据种类以及 Agent bundle 的排除集合保持既有合同。Agent 要读
完整授权历史，应使用相应分页接口并保留 cursor，不能把一个有界 bundle 当作全部历史。

## 精确核对来源

Core `correction_event` 按事件主键读至多一行，验证规范事实与 digest，采用数据库的
真实 `local_seq`。Host 的 `GET /beta/v1/profiles/:profile/corrections/:event` 先核对档案
读取授权；只有成功但不存在时返回 `200 null`，拒绝访问、损坏或存储失败仍为错误。
Native 命令为 `beta_correction_event`，能力声明为 `correction_source`。

来源弹窗分别显示更正内容、目标尚未到达或校验冲突。用户主动查看原文时才精确读取
目标并核对 `target_digest`；原件清单仅表示元数据，不能冒充读过图片、音视频或文件。
关闭、换档案或服务身份变化后，迟到结果不再取得显示资格；旧服务缺能力时不跨协议兜底。
