# Beta26 一键邀请投递

> 设计日期 2026-11-22。B1a 的持久化部分已有[独立交付记录](2026-11-22-beta26-b1a-connection-store.md)。双向发起与接收的产品工作排入 [β28 计划](2026-11-25-beta-iteration-after-user-review.md#rt-身份link-与事件接力)。
> 上游设计：[Beta26 外心环境与多连接设计](2026-11-21-beta26-environments-connections-design.md)

## 用户确认的交互

- 邀请方在档案内定点选择环境并点击“邀请”；这次点击就是发送方确认并立即定点发送到该设备。
- 接收方收到“设备 X 邀请你加入档案 Y，是否加入？”的可核对邀请弹层；点击“确认加入”就是接收方授权，随后自动完成 claim、成员确认和首次同步。
- 主路径不再要求复制完整邀请、输入配对码、手填地址或第二次发送方确认。
- 关闭弹层表示稍后处理，不表示拒绝；拒绝、过期、不可达、成员已接受和首次
  数据同步完成必须是不同状态。
- 自动投递不可用时，保留同一次签发邀请的文本复制退路；不能静默或重复签发。

## 安全边界

投递到达不等于授权。接收端在接受前必须验证：

1. TLS 对端 pin 与邀请 issuer pin 一致；
2. proposal 的收件 device/pin 是本机；
3. 邀请签名、proposal 签名、secret hash 和邀请摘要一致；
4. 邀请未过期，protocol/Core schema 兼容；
5. 后续 claim/rejoin 仍通过当前档案成员、generation、replacement 和撤销检查。

发现候选、连接可达、邀请已送达、成员资格已接受和数据同步完成分别展示。
投递失败或 timeout 只表示未知，不表示对端拒绝。

## 持久模型

连接层完成后新增有界 table：

- `peer_invitation_proposals`：proposal ID、方向、本机/远端环境、pin、
  invitation ID 与摘要、有效期、投递/决定/membership/首次同步阶段、最后错误、
  创建/更新时间。
- 私有 `invitation_blob`：仅保存 pending 投递所需的签名邀请文本，接受或终态
  处理后立即清除。

原始邀请 secret 是短期私有数据：

- 最长保存到原邀请 expiry；
- 仅 Host 内部投递和一次性接受读取；
- 不进入 UI DTO、EventLog、开发日志、错误文本、遥测、普通导出或脱敏诊断；
- proposal 规模、文本字节和保留条数均有硬上限；
- 终态记录保留 7 天用于解释与排障，不保留 secret。

## 状态

投递状态：`queued → sending → delivered | unreachable`。失败可重试同一
proposal/invitation，不生成新 secret。

决定状态：`pending → accepting → membership_ready → sync_pending → accepted`；
另有 `refused`、`expired`、`membership_denied`。

`membership_ready` 只证明成员握手完成。首次同步必须另行显示
`sync_pending | complete | failed`，不能把成员接受写成数据已同步。

幂等键：

- 相同 proposal ID + 相同摘要返回原状态；
- 相同 proposal ID + 不同 payload 拒绝；
- 相同 invitation ID + 不同 proposal 只允许明确的产品恢复语义；
- 重投不延长 expiry，终态不会因迟到 ACK 回退。

## 服务消息

通过 pinned peer TLS 增加 proposal service。消息至少绑定：

- proposal ID；
- recipient device/pin；
- 完整一次签名邀请；
- invitation digest 与 secret hash；
- issued/expiry；
- 独立 proposal signature domain。

入站服务不得创建 route、membership、grant 或 profile 数据。接收端先持久化再
返回 delivered；ACK 丢失后重投返回同一状态。

## UI 关闭

- 附近环境卡提供“邀请”，发送后可看到 queued/sending/delivered/unreachable；
- 接收方持久收件弹层显示来源环境、档案名、邀请阶段、有效期和接受/拒绝；
- 接受过程每一步有状态、取消边界与诊断；
- 首次同步失败不撤销已建立的 membership，提供立即同步、换连接和诊断；
- Beta25 兼容退路显示为“复制旧版邀请”，并明确它尚未自动送达。

## 验收反例

- pin、issuer、recipient、签名、摘要、secret hash、协议或 schema 任一不符；
- proposal 过期后重投不续期；
- 重复入站、丢 ACK、重启和终态后迟到消息；
- 接受前拒绝不得产生 membership；
- 接受后同步失败必须与“尚未加入”分开；
- 原始邀请 secret 不出现在任何日志、UI、诊断、导出或 EventLog；
- 旧 Beta25 无新 service 时只能走文本兼容路径，不能伪报自动投递成功。
