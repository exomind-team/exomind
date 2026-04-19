# 2026-04-19 未打开档案任务时间线 Tauri MCP 实测记录

## 目标

在真实 Tauri 桌面窗口中验证以下结论，而不是只停留在代码阅读或单测：

1. “未打开档案”状态下，任务域实际落到 `anonymous` scope。
2. 任务时间线已经只依赖任务域 `statusTransitions` 渲染。
3. 新结构下，不再依赖 EventLog 或旧时间块索引回退。
4. 旧空历史任务在无回退策略下会被继续忽略，而不是运行时补历史。

## 现场真值

- 受管实例：`proposal-tmcp-0419`
- Web：`1620`
- Embedded RT：`9324`
- Tauri MCP bridge：`9423`
- 主窗口标题：`ExoMind [dev] [Web:1620 RT:9324]`
- 主窗口路由：`/tasks/timeline`
- 档案状态：
  - `localStorage['exomind:profile-session'] === null`
  - 桌面侧边栏显示：`未打开档案`

## 重要前情

本轮第一次接管到的是一台旧桌面实例，不应把那次结果当作最终结论：

- 旧 `exomind.exe` 写入时间：`2026-04-19 01:30:43`
- 当时仓库最新提交时间：`2026-04-19 02:10:43+08:00`

在旧实例里，匿名任务路由返回体还没有带出 `status_transitions`，因此先停止旧实例，再重新用最新工作树编译并拉起当前实例，后续结果以下面这台新实例为准。

## 实测步骤与结果

### 1. 匿名态与任务时间线页面可真实进入

- 在真实窗口中确认侧边栏账号入口显示“未打开档案”。
- 任务时间线路由可正常进入：`/tasks/timeline`。
- 页面没有因为缺 profile session 崩溃或跳错页。

结果：

- 通过。

### 2. 新建并流转一条匿名任务，验证时间线只读 `statusTransitions`

通过 RT 匿名作用域创建并流转一条新任务：

- marker：`TMCP_ANON_TIMELINE_FRESH_1776558618783`
- task id：`8f056e3f-8629-44e4-9556-cc409ae0bc85`

状态流转：

1. `task.create -> pending`
2. `task.transition -> in_progress`
3. `task.transition -> completed`

RT 回读结果：

- 返回体中存在完整 `status_transitions`
- 共 3 条 transition
- 最终 `status=completed`

时间线页结果：

- 页面显示 `任务：1 / 泳道：1`
- 存在真实时间线元素：
  - `timeline-title-8f056e3f-8629-44e4-9556-cc409ae0bc85`
  - `timeline-segment-8f056e3f-8629-44e4-9556-cc409ae0bc85-0`
  - `timeline-terminal-8f056e3f-8629-44e4-9556-cc409ae0bc85`
- 点击 segment 后，详情面板成功打开，显示：
  - `进行中`
  - `完成`

结果：

- 通过。

### 3. 创建只有初始 pending 历史的匿名任务，验证“显示待办段”开关

创建任务：

- marker：`TMCP_ANON_PENDING_ONLY_1776558680360`
- task id：`ed5c3f98-2d09-4991-8a7a-d46f9bc04204`

RT 回读结果：

- `status=pending`
- `status_transitions` 只有 1 条初始 `task.create`

时间线页默认状态：

- 该任务默认不显示
- 页面统计仍是 `任务：1 / 泳道：1`

打开“显示待办段”后：

- 该任务出现在时间线
- 页面统计变为 `任务：2 / 泳道：1`

结果：

- 通过。

### 4. 创建进行中任务，验证非终态段与刷新后恢复

创建并推进任务：

- marker：`TMCP_ANON_INPROGRESS_1776558830384`
- task id：`51bc153a-6874-4e09-8f16-dd6ce5b5536a`

状态流转：

1. `task.create -> pending`
2. `task.transition -> in_progress`

RT 回读结果：

- `status=in_progress`
- `status_transitions` 共 2 条

时间线页结果：

- 页面显示 `任务：3 / 泳道：2`
- 该任务真实出现在时间线标题集合中
- 点击 segment 后详情面板显示：
  - `待办`
  - `进行中`
  - 当前状态 `in_progress`

随后执行页面刷新：

- `TMCP_ANON_TIMELINE_FRESH_1776558618783` 仍存在
- `TMCP_ANON_PENDING_ONLY_1776558680360` 仍存在
- `TMCP_ANON_INPROGRESS_1776558830384` 仍存在
- 刷新后详情面板关闭，但时间线内容保留

结果：

- 通过。

### 5. 旧空历史任务继续被忽略

旧任务：

- marker：`TMCP_ANON_TIMELINE_1776558381805`
- task id：`39c855b9-85f7-4061-90b8-fb1add5cb4d9`

RT 回读结果：

- `status=completed`
- `status_transitions=[]`

时间线页结果：

- 页面不显示该任务
- 在“显示待办段”开启后仍不显示

结论：

- 这类旧空历史任务不会被运行时自动补历史。
- 行为符合“删除兼容回退后，只认新状态历史结构”的当前策略。

## 额外澄清

侧边栏“任务”项旁边显示的 `2` 不是任务数量，而是提案箱紧凑 badge：

- selector：`proposal-desktop-compact-badge`
- 含义：待处理 proposal 数量

因此不能把这个数字和任务时间线统计混为一谈。

## 结论

本轮真实 Tauri MCP 验收表明：

1. 未打开档案状态下，任务域使用 `anonymous` scope 是真实产品行为。
2. 任务时间线已经可以只依赖任务域 `statusTransitions` 正常工作。
3. `pending` 是否渲染，已由页面显式开关控制，而不是回退逻辑控制。
4. 旧空历史任务继续被忽略，符合“无运行期兼容回退”的当前设计。

## 与 `#929` 的关系

这轮实测直接支持 `#929` 的以下收口结论：

- 任务时间线只认任务域状态历史
- 不再依赖 EventLog / 旧时间块索引做运行时回退
- 在匿名默认档案语义下，新结构同样可以真实工作
