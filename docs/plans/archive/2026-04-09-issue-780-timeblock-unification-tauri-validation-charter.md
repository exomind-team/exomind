# Issue #780 Timeblock Unification Tauri Validation Charter

## 目的

这份文档用于把 `#780` 的“统一时间块数据结构”从类型/路由/单测层，进一步收敛为一组真实用户可执行的桌面验收叙事。

目标不是再解释一次数据结构设计，而是指导一次真实的 ExoMind 外心桌面实例交互测试，确认统一后的时间块语义在 UI、RT、Tauri 桌面壳层之间保持一致。

## 本轮验收对象

- 单一语义源：`transitions`
- 活跃块 / 已完成块 / gap 块在桌面 UI 上的连续体验
- RT 路由守卫与桌面交互的一致性
- planner 启动工作片段与统一时间块结构的衔接
- 桌面实例 reload / RT 重启后的恢复性

## 这轮不验什么

- 多设备 mesh 级联同步的全链路人工验收
- 旧 legacy storage 全量迁移 UI
- 所有历史时间块详情页的视觉回归

这些仍可单独继续扩展，但不应阻塞本轮“统一数据结构是否在桌面主链可用”的判断。

## 前置准备

### 代码前置

- `bunx tsc --noEmit`
- 相关 TS 单测通过
- 相关 Rust `--lib timeblock` 单测通过

### 环境前置

- 启动一个独立的 Tauri dev 外心实例
- 确认该实例拥有独立 web / hmr / RT 端口
- 确认 embedded RT 已启动
- 优先使用当前 dev 实例目录，不把 `%APPDATA%/com.exomind.app` 误判为当前实例真相

### 取证前置

每条叙事至少记录以下任意 2 项证据：

- 桌面截图或录屏时间点
- RT HTTP 返回
- Tauri / RT 日志片段
- localStorage / 当前实例数据目录状态
- MCP / raw bridge 交互结果

## 用户叙事

### 叙事 1：从空闲进入一个新的 active 时间块

用户打开桌面应用，在“当下”或等价入口启动一个新的倒计时专注块。

期望：

- UI 立即进入 active block 展示
- 名称、模式、目标时长显示正确
- RT 中当前 active block 存在
- active block 的真相源以 `transitions=[start]` 为起点，而不是依赖旧 `phase/paused/...` 字段拼装

重点观察：

- UI 是否出现“开始了但状态栏仍像空闲”这类割裂
- active block reload 后是否仍保持一致

### 叙事 2：运行中暂停，再继续

用户在运行中的时间块点击暂停，再点击继续。

期望：

- 暂停时倒计时/计时显示冻结
- 恢复后继续推进
- 不出现“paused=true 但 transitions 仍像 running”或反过来的割裂
- RT 守卫正确：已暂停时不能再次 pause，未暂停时不能 resume

重点观察：

- UI 与 RT 的 phase 是否一致
- pause/resume 后 reload，桌面是否仍能恢复成正确状态

### 叙事 3：结束行动，进入反馈，再提交反馈

用户点击“结束”，进入反馈阶段，填写反馈并提交。

期望：

- 点击“结束”后进入 feedback in progress，而不是立即丢失当前块
- 提交反馈后，完成块进入 completed 列表
- 当前 active 位置切换成 gap block，而不是悬挂在一个已结束 active block 上
- 后续再开始新块时，不会因为旧 completed active 还残留在 active 槽位而被错误阻塞

重点观察：

- `feedback_start` 与 `end` 之间的 UI 过渡是否清晰
- 提交后 active 区域是否真的代表“新 gap”，而不是“旧 active 的终态影子”

### 叙事 4：已结束 active / gap 不应阻塞下一个新块开始

用户刚完成一个块，或者当前正处于自动 gap，随后再次开始一个新块。

期望：

- 新块可以正常开始
- planner 或主计时入口不会误报“已有 active timeblock”
- 桌面 UI 不会因为读取到 transition-only terminal block 而卡死在不可操作状态

重点观察：

- 这是统一结构后的关键回归点，应显式验一次

### 叙事 5：从 Today Planner 启动工作片段

用户在 Today Planner 内启动一个 work segment。

期望：

- 生成的 active block 带上 `sourcePlannedBlockId`
- 完成后 completed block 仍保留该 provenance
- planner 视图状态与 timeblock 主视图状态一致

重点观察：

- planner start 不应因为 gap / terminal active 判定不一致而被误阻塞

### 叙事 6：桌面 reload / RT 重启后的恢复

用户在 active block 运行中或 gap 存在时，执行窗口 reload 或 RT 重启，再回到页面继续观察。

期望：

- active block 或 gap 能恢复到与 RT 一致的状态
- 不会把 terminal active 重新误当成 running active
- 不会出现 completed block 被重新注入 active 槽位

重点观察：

- 这是 Tauri 桌面壳层最容易把“统一结构”打回两套语义的地方

## 判定标准

### 通过

- 以上 6 条叙事在桌面实例上可顺序跑通
- UI、RT、路由守卫、planner 衔接无明显割裂
- 未发现“只有 transitions 正确，但 UI/恢复逻辑仍依赖旧字段导致行为错误”的问题

### 不通过

出现以下任一情况即可判定本轮不通过：

- completed active 仍被 UI 当成 current active
- pause/resume/feedback 阶段 UI 与 RT 守卫不一致
- planner start 被 terminal active/gap 错误阻塞
- reload / RT 重启后恢复出错误 phase

## 建议执行顺序

1. 启动独立 Tauri dev 实例
2. 确认 web / RT / bridge 端口
3. 先跑叙事 1~4
4. 再跑 planner 叙事
5. 最后跑 reload / RT 重启叙事
6. 把结果同步回 `#780`

## 同步到 Issue 的摘要建议

同步时至少带上：

- 本次使用的实例名与端口
- 已跑过的叙事编号
- 每条叙事 PASS / FAIL / BLOCKED
- 若 blocked，阻塞点是在：
  - Tauri MCP transport
  - app 启动
  - RT 启动
  - UI 行为
  - 还是数据语义本身
