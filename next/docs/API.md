# 新外心 API · exomind-buffer/1

版本 `0.6.0-rebuild.1`。这是候选协议，不是旧 RT API 的别名。数据库 schema 1；未来变更必须升级或明示兼容范围。

## 连接与权限

每个 Runtime 只拥有一个空间。先从用户明确提供的私有连接文件取 `url/token/ca`，再 `GET /v1/hello` 验证 protocol、deviceId、spaceId。不要通过默认旧端口、用户名、profile、scopeKey 猜测作用域。

除 `/health`、静态网页和凭一次性邀请认证的 `/v1/pair/claim`，所有 API 使用 `Authorization: Bearer <token>`。JSON 写入需要 `Content-Type: application/json`。重定向不跟随；不使用关闭 TLS 校验的方式访问。

| 令牌 | 可用范围 |
|---|---|
| owner | 当前实例所有管理与业务操作；仅本机管理 |
| observer | hello、timeline/search、operation、current/views/current、单块、jobs、blob 读取 |
| writer | observer 读取＋capture、时间块、blob 上传；不能管理配对/权限/总结任务 |
| peer | GET hello/changes/checkpoint/已被当前空间引用的 blob；不调用用户命令 |

读取到的 actor 目前是设备 UUID。capture 的 source.accessRole/accessId 记录接入令牌类别，不应把 owner 自动解释为人类亲写。

## 共同响应

```ts
type Receipt = {
  id: string;
  durability: 'local_committed';
  replayed?: true;
  seq?: number;
  blockId?: string;
  summary?: 'queued';
};
type ApiFailure = { error: { code: string; message: string; details?: unknown } };
```

```json
{"id":"018c2f00-0000-7000-8000-000000000001","durability":"local_committed","seq":1}
```

`local_committed` 仅确认本机 SQLite 事务提交，不确认其他设备已收下。相同 ID＋同一种命令＋相同规范化内容＋同一来源可重试，返回 `replayed:true`；相同 ID 改内容得到409。不要因超时生成新 ID，先重试原请求或查 `/v1/operations/{id}`。同 ID 与远端事实冲突不能通过改 ID 掩盖。

常见故障：401 unauthorized；403 forbidden/space_mismatch；409 idempotency_conflict、active_block_exists、record_conflict、history_mismatch；400输入错误；500内部错误。失败响应不应改造成 `[]` 或“同步完成”。

## 记录与读取

```ts
type Attachment = { hash: string; size: number; name: string; mime: string };
type CaptureRequest = { id: string; text: string; files: Attachment[]; blockId: string | null };
```

```json
{"id":"018c2f00-0000-7000-8000-000000000001","text":"先记下，晚些整理。","files":[],"blockId":null}
```

`POST /v1/capture`。文本或附件至少一个非空；文本最长32768个 JS 字符单位；附件最多16，每个最多64MiB。blockId 若非null，必须引用本机已知开始事实。UI默认关联唯一进行中的块；HTTP调用方必须明确选择。

```ts
type Operation = {
  schema: 1; id: string; space: string; actor: string;
  kind: 'capture' | 'block.started' | 'block.ended' | 'block.feedback' | 'summary';
  at: number; payload: Record<string, unknown>; digest: string;
};
type TimelinePage = {
  items: (Operation & { localSeq: number })[];
  nextBefore: number | null;
  highwater: number;
};
```

```json
{"items":[],"nextBefore":null,"highwater":0}
```

`GET /v1/timeline?before=N` 按本机入库序号倒序，默认40条。`GET /v1/search?q=关键词&before=N` 搜索 JSON payload 文本，不是语义搜索或附件全文搜索。`before` 为严格小于，不是包含。新快照先取 hello.highwater，再从 before=highwater+1 开始，直到 nextBefore=null；检查游标下降。只有完成全部分页才能声称该快照完整。

`GET /v1/operations/{id}` 回读单个不变记录。不能以同样的 ID 修改其内容；本版尚无编辑/删除协议。

## 时间块

```ts
type StartRequest = { id: string; name: string; note?: string };
type EndRequest = { id: string; blockId: string; feedback?: string };
type FeedbackRequest = { id: string; blockId: string; text: string };
```

```json
{"id":"018c2f00-0000-7000-8000-000000000010","name":"休息","note":"暂时离开屏幕。"}
```

`POST /v1/blocks/start`；其 id 也是新的 blockId。本机已知活动块不为空时拒绝再开始；离线多设备并发开始会在同步后同时保留。

```json
{"id":"018c2f00-0000-7000-8000-000000000011","blockId":"018c2f00-0000-7000-8000-000000000010","feedback":"精神恢复一些。"}
```

`POST /v1/blocks/end`；结束写入与本机总结任务入队在同一事务。`POST /v1/blocks/feedback` 追加反馈；结束与补充是不同事实，不能覆盖前文。

`GET /v1/blocks/{id}` 返回名称、备注、startedAt、actor、`running|ended|end_conflict`、ends、feedback。没有结束记录则运行，一个则结束，两个以上则分叉。没有隐式最后时间戳胜出。

`GET /v1/current` 与 `GET /v1/views/current` 同义，后者为外部只读表面入口：

```ts
type CurrentSnapshot = {
  protocol: 'exomind-buffer/1'; deviceId: string; spaceId: string;
  observedAt: number; snapshotSeq: number;
  active: Array<{ id: string; name: string; note: string; startedAt: number; actor: string; state: 'running'; ends: []; feedback: Operation[] }>;
  conflict: boolean;
};
```

```json
{"protocol":"exomind-buffer/1","deviceId":"018c2f00-0000-7000-8000-000000000020","spaceId":"018c2f00-0000-7000-8000-000000000021","observedAt":1794300000000,"snapshotSeq":0,"active":[],"conflict":false}
```

只读不产生时间推进事实。计时显示是时间戳的投影；不能通过 UI 计时器自行结束业务状态。当前不实现暂停、倒计时、截止自动结束或任务关联。

## 附件上传与读取

先计算文件 SHA-256，再按以下顺序：

```text
POST /v1/blobs/begin                     {hash,size}
PUT  /v1/blobs/{hash}/chunks/{offset}     二进制，<=256KiB
POST /v1/blobs/{hash}/commit              {}
POST /v1/capture                        引用已完成附件
```

begin/write 返回已确认 offset（及大小/完成状态）；断线重试先 begin，按返回偏移继续。相同偏移的重复块必须字节相同；乱序/部分覆盖会被拒绝。commit校验完整长度和哈希。文件完成但记录尚未提交时可重复使用同一哈希，不重新上传。

`GET /v1/blobs/{hash}?offset=N&length=N` 返回二进制，最大256KiB。调用方依据Attachment.size循环读取、检查空进展与最终哈希。不存在/待补齐的附件返回错误，不是零字节成功。

metadata先到而blob未到是明确允许的远端状态。诊断/peer列表有 missingAttachments 数量。文件名只是展示名；播放列表里的本地路径不会被递归收集。

## 配对与同步管理（owner）

`POST /v1/pair/invitation {endpoint?,ca?}` 生成包含protocol/id/token/expires/endpoint/ca/deviceId/epochId/spaceId/name的邀请，10分钟有效。endpoint必须为对端可访问的地址；ca是PEM文本，不是本机文件路径。

`POST /v1/pair/join {invitation,endpoint?,ca?}` 接受完整邀请，同时声明自身回连地址。只有空白实例可以采用另一空间；原始记录不会被覆盖。返回paired=true只代表配对记录已写入，sync=not_yet_confirmed。

`POST /v1/pair/claim` 是join内部使用的一次性能力端点，不是通用匿名写入接口。同一邀请、相同请求在有效期内可重试；更改请求或使用已消费邀请会拒绝。

`GET /v1/peers` 返回items与missingAttachments，不包含密钥。状态：paired/catching_up/attachments_pending/caught_up/paused/revoked/error。

`POST /v1/peers/{id}/pause|resume|revoke|sync {}`；撤销后只能重新配对。`POST /v1/peers/{id}/endpoint {endpoint,ca?}` 保留身份/游标/密钥并更代请求。ca省略保留旧值，null清除自定义CA。误填地址会失败，不静默改身份。

同步读协议：`GET /v1/checkpoint?at=N` 返回epochId/at/hash；`GET /v1/changes?after=N&through=N` 返回不超过64个操作，以及from/to/through/fromHash/toHash/hasMore和设备、空间、协议身份。对端序号不是本机序号；每个peer独立保存cursor。应用页与cursor同事务；任一校验失败不跳过冲突页。流量可重复，业务效果幂等，不宣称网络严格只传一次。

连接无效、认证失败、历史回退、记录冲突分别暴露；不能用更大时间戳解决这些问题。同步后台单轮最多16页；大附件采用受限分块轮次，不阻塞本机文字保存。

## 总结与权限管理（owner）

`GET /v1/jobs` 返回本地任务items与providerConfigured。任务队列不跨设备复制；总结结果作为不变记录复制。

`POST /v1/jobs/{id}/cancel {}` 取消生成，不删除输入或已保存结果。`POST /v1/jobs/{id}/retry {}` 显式重试；自动重试上限3次，手动重试可重新花费模型额度。运行期间的异步结果只有run_id仍有效才可提交。

输出summary.payload包含blockId、triggerId、narrative、evidence、uncertainties、coverage。coverage明确total/included/omitted/snapshotSeq、complete/partial、attachments=metadata_only。本机快照完整不等于全部设备或现实活动完整。

`POST /v1/access-tokens {name,role:'observer'|'writer'}` 返回新id/role/token；token仅此时返回。用`POST /v1/access-tokens/{id}/revoke {}`撤销。没有令牌列表UI，创建时请保留接入ID。

`GET /v1/diagnostics` 返回脱去密钥和正文的运行事实，但仍含地址/设备身份，分享前需再次脱敏。
