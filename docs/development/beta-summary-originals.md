# Beta 回顾原件与本机外发同意

状态：源码已接通，并通过本机 Host、HTTP、Native 和 Web 验证；后继候选尚待冻结验收。依据是已批准决定 Q27：文字自动，原件按需选择给模型。

Core 的 selection、冻结材料、来源头和 artifact 保持原合同。选件 ID 与输出中记录的
`read_original_ids` 是可复制事实；provider 配置与向它发送原件的同意属于本机 Host。
Host-only consent 绑定原请求或控制身份、选择摘要、provider revision 与原始字节上限。
每次执行及重启恢复都要重新核对本机资格。其他设备或档案导入带来的任务需要本机同意。
通用 UI 意图的撤下不能移除 Host 的执行资格记录，也不能让旧许可套用于新控制或新选择。

`SummaryOriginalSelection` 在明确点击后核对 `summary_originals` 能力、读取模型配置和
固定分页的时间线文件信息，不读原件正文。新请求默认不选原件；勾选文件与批准外发是
两个动作。确认展示目标 origin、model、件数、原始总字节和批准上限。换范围、切档案、
重新核对配置、取消勾选都会清除同意；迟到结果只能回到原有有效范围。

已有选件任务的重试、恢复、更新另存与接管沿用原选件，在本次确认中重新核对文件及
provider，再取得本轮同意。取消控制沿用原合同。当前执行路径只接受 PNG/JPEG/WebP，
原始总字节最多 256 KiB，编码后的完整请求另按服务输入上限核对；其他格式明确提示。Host 仍须以原件 permit、长度与完整 SHA
核对字节，任何缺件、超预算或资格变化都应在 provider dispatch 前收束。

UI 的“已提供给本次模型请求”同时要求冻结材料已选择、校验可用，且输出记录该 ID。
该标签描述请求材料，不证明模型理解。旧回顾、原文与匹配更正保留，读取不触发模型重跑。

维护入口是 `summary_jobs.rs`、`summary_material.rs`、`model_provider.rs`、本机 intent store、
`summary-client.ts` 和 `summary-intent-journal.ts`。Host facade、HTTP/Native wrappers、能力
声明与 UI 必须作为完整接线交付。低权 Agent 的读取和摘要历史聚合不取得外发许可。

回归分别覆盖 Host 的精确图片字节/请求摘要及恢复资格、UI 的独立同意和 scope fence、
StrictMode 提交、控制续轮以及旧 Host 能力拒绝。源码结果与精确候选、真实 provider 的
质量签收分别记录，不能仅靠本机 mock provider 宣称完整 Beta 或实际模型质量通过。
