# Beta 原件传输诊断

本模块补足“文字／原件元数据已经到达，但本机还没有字节”的取证入口。
它不负责配对、下载、重试或修改自动策略，也不将诊断读取当作传输进度。
Beta16/6016 的物理双端失败记录仍有效；下一精确候选的设备验证单独记录。

## 状态来源与范围

原件卡的“查看传输诊断”在打开时读一次，明确刷新才再读；关闭、隐藏或切换
档案／原件后，排队读取及晚结果均失去资格。不新增定时器、订阅或后台扫描。
已经发出的 Native 读取可能完成，但不会更新已关闭的详情。

单件字段来自已有 `beta_peer_original_status`：本机 availability、transfer phase、
字节偏移／长度、请求／来源 ID、规范失败码。原件 ID、SHA-256 和长度来自所选
记录中的 manifest，响应必须与当前档案和原件身份一致。

新 `beta_peer_original_auto_status` 只向可信主窗口提供本机全局快照：

| 字段 | 含义 |
|---|---|
| `network_enabled` | 本机 peer 网络是否启用 |
| `policy_enabled` | 本机自动获取策略是否启用 |
| `max_bytes` | 自动获取的单件最大字节数，不是文件最小门槛 |
| `active_outbound` | 当前活动获取请求数，包含手动／自动请求，不是上传字节数 |
| `deferred` | 队列当前是否标记延期处理，不是某件原件的失败证明 |
| `last_error_code` | 队列保留的规范错误码，缺失时不推断成功 |

全局队列、策略读取不是跨表原子快照，且队列字段没有逐件资格证明。
有 `0` 个活动请求、没有错误码或没有退避行，都不能证明某件已经入队／完成。
缺测、读取失败、接口未提供、真实零值与传输失败分别展示。

## 接口边界

- Native 命令不接受路径、token 或业务参数；复用 `trusted_window` 和 `work`
  的主窗口信任、退出围栏与 blocking worker 接缝。
- 读取复用 Host 的 `original_auto_queue_status`／`original_auto_policy`，不调用
  configure、fetch、cancel、wake 或配对操作。它不是外部 Agent HTTP 能力。
- DTO 只包含白名单标量；客户端拒绝额外字段。展示仅接受已知规范错误码，
  未知值不作为自由文本回显，不输出凭据、原件正文或用户路径。
- `peer_timeout` 说明等待超时；`tls_handshake_failed` 说明握手未成功；
  `pin_mismatch` 才表示所见身份与授权不符。握手错误不冒充身份已经变化，
  诊断不会放宽产品 TLS／Raw Public Key 校验。

普通 TCP connect 不能证明已经连接到正确 peer。物理联调已出现目标 listener 停止后
connect 仍迅速成功的反例；需以匹配身份的产品 TLS 和实际原件请求确认后续阶段。
辅助探测、构建、合成测试均不能代替字节到达、独立导出 hash 或系统打开验收。

## 维护与回归

入口为 `OriginalTransferDiagnostics.tsx`、`original-auto-diagnostics.ts`、
`original-acquisition.ts` 和 `beta_native_peers.rs`；Native 命令与根注册一同维护。
相关回归已接入 Beta Source Contracts：

```text
tests/unit/beta/original-acquisition.test.ts
tests/unit/beta/original-auto-diagnostics.test.ts
tests/unit/beta/original-transfer-diagnostics-ui.test.tsx
exomind-beta-host::original_auto_queue_status_reads_without_changing_policy_or_transfer_state
```

验收包含打开前不读取、关闭／隐藏前尚未派发的读取不再发出、晚结果不串档案、
未知字段／错误原文不泄漏，以及 Host 读取不改变策略、抑制、退避或原件状态。
必须保持队列／原件／来源三个范围可辨，不用队列总览代替单件完成。
