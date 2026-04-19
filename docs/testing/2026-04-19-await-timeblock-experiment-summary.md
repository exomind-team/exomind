# 2026-04-19 await 时间块、任务与提案评论监听实验总结

## 背景

本轮联测的目标是验证外部 Agent 通过 `POST /act/await` 监听无 scope 事件流时，能否正确区分：

- 任意下一事件 `next_event`
- 任意任务完成 `task_completed`
- 时间块状态变化 `timeblock_state_changed`
- 专注结束 `timeblock_stopped`
- 反馈完成后的时间块完成 `timeblock_ended`
- 提案新增评论 `proposal_comment_added`

本轮还顺带确认了一条重要前提：

- 人工联测时，这批事件实际落在 **无 scope 事件流**，不是 `profile-argon`
- 因此用于监听的正确入口是：

```text
POST /act/await
```

而不是：

```text
POST /act/await?user_id=profile-argon
```

## 三个容易混淆的词

### 1. 专注完成

当前应监听：

```text
timeblock_stopped
```

原因：

- 它对应 `POST /timeblocks/stop`
- Rust 真相是 active block 进入 `feedback_in_progress`
- 这是“专注动作结束，进入反馈阶段”，还不是 completed history

### 2. 时间块结束

当前仓库里这个词如果指的是 raw eventlog 文案“时间块结束: ...”，它对应的是：

```text
block_end
```

原因：

- `block_end` 是 stop 时写出的 EventLog 痕迹
- 它表示“进入反馈阶段”
- 它不是最终 completed

因此，`block_end` 不能作为“反馈完成”的主监听目标。

### 3. 时间块完成

当前应监听：

```text
timeblock_ended
```

原因：

- 它对应 `POST /timeblocks/end`
- 真相来源是 completed history
- 只有 feedback submit 完成、时间块真正进入 completed history 后才满足

结论：

- `timeblock_stopped = 专注完成`
- `block_end = raw eventlog 上的“进入反馈阶段”痕迹`
- `timeblock_ended = 反馈完成后的时间块完成`

## 两个时间块

本次需要总结的两个时间块分别是：

1. 历史时间块：`tb-e9960494-dfc8-4020-acd7-81e220753066`
2. 新时间块：`tb-13932a4c-6dc6-4b94-b9cc-6a42d1627984`

它们都只关联了同一个任务：

- `taskId`: `66857865-89df-443e-94ee-219a0b2428a7`
- `taskTitle`: `TMCP Task From Proposal 0419`

并且两块在最终 completed 结果里都把该任务写成：

```text
suspended
```

不是 `completed`，也不是 `cancelled`。

## 时间块 A：历史时间块

### 基本信息

- `timeblockId`: `tb-e9960494-dfc8-4020-acd7-81e220753066`
- 名称：`TMCP Task From Proposal 0419`
- 开始：`2026-04-19 21:18:29`
- 专注结束：`2026-04-19 22:06:35`
- 反馈提交 / 完成：`2026-04-19 22:10:30`

### 结构化结果

- 总时长：`52:01`
- 实际工作：`46:19`
- 暂停时长：`01:46`
- 反馈用时：`03:56`
- 任务结果：`TMCP Task From Proposal 0419 -> suspended`

### 过程中发生了什么

这个时间块是本轮 await 联测的主实验块。围绕它完成了这些动作：

- 先做了无 scope `next_event` 联调
- 监听到了真实的 `task_suspended`
- 做了 `timeblock_state_changed(paused -> running)` 联调
- 成功监听到了时间块恢复
- 做了 `timeblock_stopped` 联调
- 成功监听到了专注结束并进入 `feedback_in_progress`
- 随后时间块真正进入反馈阶段
- 反馈提交后，这个块进入 completed history

### 关键状态转移

- `pause @ 1776607126773`
- `resume @ 1776607148012`
- `pause @ 1776607424504`
- `resume @ 1776607509595`
- `feedback_start @ 1776607595132`
- `feedback_submit @ 1776607830637`
- `end @ 1776607830637`

### 与监听相关的关键事件

- `e87d8fe9-b307-404f-9824-8956ed30d678`
  - `task_suspended`
  - 内容：`任务挂起：TMCP Task From Proposal 0419`
  - 来源：`http:timeblocks/pause`

- `c06cb99c-b3e8-49a9-bde9-d781c9db7c3d`
  - `block_pause`
  - 内容：`时间块暂停: TMCP Task From Proposal 0419`

- `73673154-8c19-4e75-abe5-bb5edd4238c1`
  - `block_resume`
  - 内容：`时间块恢复: TMCP Task From Proposal 0419`

- `f5928017-30ab-49bc-a02b-5defb8aa19c7`
  - `block_end`
  - 内容：`时间块结束: TMCP Task From Proposal 0419`
  - 注意：这里只表示 stop / 进入反馈阶段

- `5b9e4cc3-6b87-416d-bd22-96247a471f81`
  - `block_feedback`
  - 对应 completed history 写入后的反馈报告

## 时间块 B：新时间块

### 基本信息

- `timeblockId`: `tb-13932a4c-6dc6-4b94-b9cc-6a42d1627984`
- 名称：`TMCP Task From Proposal 0419`
- 开始：`2026-04-19 22:10:49`
- 专注结束：`2026-04-19 22:12:29`
- 反馈提交 / 完成：`2026-04-19 22:12:34`

### 结构化结果

- 总时长：`01:45`
- 实际工作：`01:41`
- 反馈用时：`00:05`
- 任务结果：`TMCP Task From Proposal 0419 -> suspended`

### 过程中发生了什么

这个块是“修正监听流程后”的第二个实验块。

它出现的原因不是业务计划切换，而是联测过程里的一个操作影响：

- 在用户要求“先 `$show` GitHub 官网提醒一下”之后
- 不应该再额外停下来等待确认
- 但当时因为多等了一步，前一个时间块已经被结束
- 所以后续 `timeblock_ended` 的成功监听，实际命中的是这个新块

也正因为这样，这个块反而成了验证“反馈结束时的时间块完成监听”的直接证据块。

### 关键状态转移

- `start @ 1776607849017`
- `feedback_start @ 1776607949646`
- `feedback_submit @ 1776607954371`
- `end @ 1776607954371`

### 与监听相关的关键事件

- `78130c38-ea00-4134-b16d-6753a590e731`
  - `note`
  - 内容：`这是一个干扰事件`

- `2608944c-3dca-447c-add9-41ded3d754d0`
  - `note`
  - 内容：`干扰事件不应该被监听到`

- `89a0eebb-3c11-4e7b-a632-0c5f3864f40f`
  - `block_end`
  - 内容：`时间块结束: TMCP Task From Proposal 0419`
  - 仍然只表示 stop / 进入反馈阶段

- `d8aae499-0047-46ee-8940-09da11d08f8f`
  - `block_feedback`
  - 对应 feedback submit 后的反馈报告

- `fc9f9ffd-dbc1-4d58-bbba-fa8cc05ae96c`
  - `task_suspended`
  - 来源：`http:timeblocks/end`

## 追加实验：匿名域 `task_completed` 监听

### 实验前提

这轮追加实验发生在外心桌面实例崩盘并重启之后。

受管实例仍然是：

- `await-anon-0419`

但重启后的端口真值变成了：

- `Web 1630`
- `RT 27078`
- `bridge 9433`

因此这轮 `task_completed` 监听命中的真实 RT 不是之前的 `9334`，而是：

```text
http://127.0.0.1:27078
```

监听仍然使用匿名域、全程不传 `user_id`。

### await 请求与 SSE 过程

请求体：

```json
{
  "condition": {
    "type": "task_completed"
  },
  "timeoutSecs": 3600
}
```

SSE 过程摘要：

- 开始：`2026-04-19 23:06:13`
- `ready`：`2026-04-19 23:06:13`
- `heartbeat`：约每 `15s` 一次，共 `30` 次
- `fulfilled`：`2026-04-19 23:13:51`
- 总耗时：`07:37.744`
- 本轮未出现 `timeout`
- 本轮未出现 SSE `error`

### 命中的任务

- `taskId`: `66857865-89df-443e-94ee-219a0b2428a7`
- `taskTitle`: `TMCP Task From Proposal 0419`
- fulfilled 类型：`task_completed`
- 任务完成时刻：`2026-04-19 23:13:51`
- 最终状态：`completed`

fulfilled 原文里的任务快照已经证明：

- 任务确实由 `in_progress -> completed`
- 完成原因是：

```text
timeblock.end
```

- 这次完成关联的时间块是：

```text
tb-a5c2f68f-6934-404b-8f9d-5f33dcdceb1e
```

### 关联时间块与反馈

本轮完成块是：

- `timeblockId`: `tb-a5c2f68f-6934-404b-8f9d-5f33dcdceb1e`
- 名称：`测试，应该是25分钟的专注`
- 开始：`2026-04-19 23:12:56`
- 专注结束 / `feedback_start`：`2026-04-19 23:13:04`
- 反馈提交 / 完成：`2026-04-19 23:13:51`
- 关联任务：`TMCP Task From Proposal 0419`
- `taskStatusOutcomes`：`completed`

这次完成时的人类反馈原文是：

```text
任务已经完成，你回看一下时间块并总结其中的内容，并且如果你是subAgent，你让父Agent通过/show 展示这段内容（用弹窗）。
```

时间块反馈统计结果：

- 预期时长：`25:00`
- 总时长：`00:55`
- 实际工作：`00:08`
- 反馈用时：`00:46`
- 结论：`提前24:52完成`

### 关键事件链

- `31356668-c6f7-4698-a817-a1905891bbe8`
  - `task_resumed`
  - 时间：`2026-04-19 23:12:56`
  - 任务从 `suspended` 回到 `in_progress`

- `fc0c0710-c0d8-46b3-a209-6365143f6133`
  - `block_start`
  - 时间：`2026-04-19 23:12:56`
  - 时间块 `tb-a5c2f68f-6934-404b-8f9d-5f33dcdceb1e` 开始

- `50663491-aeb1-4a1d-ade3-88c6239f26cd`
  - `block_end`
  - 时间：`2026-04-19 23:13:04`
  - 这里只表示 stop / 进入反馈阶段，不等于 completed

- `78c8c1b9-448b-48c1-b106-bf13e1e62d94`
  - `block_feedback`
  - 时间：`2026-04-19 23:13:51`
  - 说明反馈已经提交，且 `task_status_outcomes` 把任务标记为 `completed`

- `3e618b41-9187-4cd9-b243-8060df226e48`
  - `task_completed`
  - 时间：`2026-04-19 23:13:51`
  - metadata 中带 `related_time_block_id = tb-a5c2f68f-6934-404b-8f9d-5f33dcdceb1e`

- `45277afc-e05a-43d1-883c-155bbe8e6599`
  - `note` + `task_completed`
  - 时间：`2026-04-19 23:13:51`
  - 内容就是本次任务完成后的反馈说明

### 这轮任务完成监听说明了什么

1. 匿名域 `task_completed` await 已经能在真实桌面实例里命中自然发生的任务完成。
2. `task_completed` 的命中并不是靠“看到某条 task 标签事件就立即 fulfill”，而是通过任务真相状态复核后 fulfill。
3. 当前 fulfilled payload 主要给的是 **任务快照**，不会直接把反馈文本内联到 payload 顶层。
4. 若要拿到“任务结束时的反馈原文”，当前最稳的做法是继续回读：
   - 关联 completed timeblock
   - `block_feedback`
   - `note/task_completed`
5. fulfilled 内嵌的 `task.time_block_ids` 在本轮命中时还没带上最终完成块 `tb-a5c2...`，但随后回读 `/tasks/:id` 已补齐，说明 fulfilled 快照与持久化最终态之间存在轻微时序差。

## 追加实验：匿名域 `proposal_comment_added` 人机闭环

### 实验前提

这轮追加实验仍发生在同一台重启后的受管实例上：

- `await-anon-0419`
- `Web 1630`
- `RT 27078`
- `bridge 9433`

监听仍然使用匿名域、全程不传 `user_id`。

这轮一开始曾按旧心智尝试把目标提案当作 `profile-argon` 域对象处理，但在这台 RT 上并没有命中对应提案；修正后回到匿名域读取，才确认真实目标是：

- `proposalId`: `prp-b1cdeded-9e5a-4a4a-92ec-7e16cde1747f`
- `title`: `TMCP proposal created rerun 1776598607`
- `status`: `pending`

监听开始前，这个提案已经存在 `2` 条评论；本轮目标是验证 await 能否等待后续新增的人类评论并一次 fulfill。

### await 请求与 SSE 过程

请求体：

```json
{
  "condition": {
    "type": "proposal_comment_added",
    "proposalId": "prp-b1cdeded-9e5a-4a4a-92ec-7e16cde1747f"
  }
}
```

SSE 过程摘要：

- 连接建立后先收到 `ready`
- 等待期间共收到 `3` 次 `heartbeat`
- 命中后收到 `fulfilled`
- 本轮未出现 `timeout`
- 本轮未出现 SSE `error`

### 命中的评论与 fulfilled 载荷

fulfilled 命中的结构化结果：

- fulfilled 类型：`proposal_comment_added`
- `proposalId`: `prp-b1cdeded-9e5a-4a4a-92ec-7e16cde1747f`
- 评论作者：`UI Reviewer`
- 评论时间：`2026-04-19T16:04:00.399360600Z`

命中的人类评论原文是：

```text
现在我们应该会追加一个记录。如果你是Agent，请你务必回看事件日志，看一下提案的执行方式是否有效，以及用show简单汇报一下这个await监听情况；如果你是subAgent，向调用你的Agent汇报一下你是怎么监听到这条评论的
```

这次 fulfilled 载荷额外证明了两点：

1. 顶层会返回正确的 `proposalId`
2. `data` 里不仅有新增的 `comment`，还有该提案的最新 `proposal` 快照

也就是说，`proposal_comment_added` 的 fulfill 真相并不是只把某条内部 signal 原样暴露出来，而是把“命中的评论 + 当前提案快照”一起带回给外部 Agent。

### 回读验证与子代理现象

fulfilled 返回之后，再次回读：

```text
GET /api/proposals/prp-b1cdeded-9e5a-4a4a-92ec-7e16cde1747f
```

可以确认：

- 目标提案确实仍是 `pending`
- 新评论已经真实持久化到该提案上
- 评论总数已从监听前的 `2` 条变为 `3` 条

因此，这轮实验已经形成了“人类追加评论 -> await fulfill -> proposal readback 确认”的完整闭环。

另外，本轮还顺带暴露了一个现象：Codex 后台子代理长时间挂起等待时，没有像前台手工 await 那样自然返回。但这更像是子代理编排 / 长任务稳定性问题，不应反向判定为 RT `proposal_comment_added` await 失败，因为前台直接 await 与后续 proposal 回读都已经给出正证据。

### 这轮提案评论监听说明了什么

1. 匿名域 `proposal_comment_added` await 已经能命中真实的人类追加评论。
2. fulfilled payload 会返回 `proposalId + comment + proposal`，足以让外部 Agent 直接拿到命中的评论和提案最新快照。
3. 若要做最终归属校验，最稳的口径仍然是 fulfill 后再回读一次 `/api/proposals/:id`。
4. 子代理长等待未回收是编排层现象，不构成 RT await 合同失效证据。

## 本轮 await 联测结论

### 1. 无 scope 监听是正确前提

最开始监听 `profile-argon` 没命中，不是 await 逻辑本身失效，而是监听 scope 错了。

本轮真实事件写入位置是：

```text
无 scope 事件流
```

### 2. `next_event` 能命中真实自然事件

修正到无 scope 后，`next_event` 能直接命中真实的人类操作带来的事件，不需要注入测试事件。

### 3. 条件化 await 会跳过干扰事件

在 `timeblock_stopped` / `timeblock_ended` 这类监听里，以下事件都没有造成误触发：

- 普通 `note`
- `task_resumed`
- `block_resume`

这说明 await 不是“看到任意新 EventLog 就 fulfill”，而是会按 Rust 侧的 feature 条件复核后再命中。

### 4. `timeblock_stopped` 和 `timeblock_ended` 的语义确实分开

已验证：

- `timeblock_stopped` 命中的是“专注结束，进入反馈阶段”
- `timeblock_ended` 命中的是“反馈完成，进入 completed history”

### 5. EventLog 只是痕迹，不是唯一真相

尤其对时间块来说：

- `block_end` 只是 stop / feedback phase 的痕迹
- `block_feedback` 更接近 completed 后的报告痕迹
- 真正的 `timeblock_ended` fulfill 依据仍然是 Rust await 对 completed history 的复核

### 6. `task_completed` 的反馈要通过关联块与事件链回读

这轮追加实测说明：

- `task_completed` await 已经能正确命中任务完成
- 完成块和 `task_completed` 自动事件之间的关联链已经存在
- 但“任务反馈文本”当前不直接内联在 fulfilled payload 顶层

因此，对 Agent 而言，当前更准确的执行口径是：

1. 先监听 `task_completed`
2. 命中后读取任务详情
3. 通过 `related_time_block_id` / `time_block_ids` 找到最终完成块
4. 从 `block_feedback` 与 `note/task_completed` 回读反馈原文

### 7. `proposal_comment_added` 已具备人机闭环

这轮追加实测说明：

- `proposal_comment_added` await 已经能在匿名域命中真实的人类追加评论
- fulfilled payload 当前会返回 `proposalId + comment + proposal`，而不只是某条底层 topic
- 对 Agent 而言，更稳的执行口径是：

1. 按 `proposalId` 监听 `proposal_comment_added`
2. 命中后优先使用 fulfilled 内的 `comment` 与 `proposal` 快照
3. 如需确认评论确实落在目标提案上，再回读 `/api/proposals/:id`
4. 不要把子代理长等待未回收直接当作 RT `await` 失败；应先用前台直连结果与资源回读做真相判断

## 对后续联测流程的直接要求

后续若用户要求：

1. 先 `$show` 某个页面提醒一下
2. 然后开始监听

则正确执行顺序应当是：

1. `$show`
2. 立即开始监听

不应再额外停下来等确认，否则可能让时间块生命周期继续推进，造成测试对象变化或误判。
