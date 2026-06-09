# Issue #571 + #652 Mobile Focus Continuity Plan

## 目标

把手机端专注连续性的两条核心断点收敛成一条实现路线：

- `#652`：当用户停留在 `当下 / 专注` 页面且时间块进行中时，支持显式控制“保持亮屏”。
- `#571`：当倒计时专注在后台结束时，用户仍能收到可靠提醒并播发提示音；默认可从通知稳定回到 `当下 / 专注`，并可选开启“自动拉起 App 并定位专注页”。

这份计划只处理“手机端专注连续性”的主链，不把问题继续扩散为全平台所有提醒、所有悬浮窗、所有后台能力的一次性总包。

## 先做什么，不做什么

### 本计划要做

- 为手机端 `当下 / 专注` 页面补一条内建的前台 keep-awake 能力，并直接在页面运行态暴露显式开关。
- 为 Android 补一条原生倒计时结束调度链，摆脱前端 `requestAnimationFrame + Audio(url)` 的单点依赖。
- 让“后台结束仍能播发提示音”成为默认能力，继续复用现有结束音开关与预设语义，而不是新增独立的“后台提示音”设置。
- 为倒计时结束通知补一条“通知点击 -> 回到 App -> 路由到 `当下 / 专注`”的 handoff 链。
- 把“后台结束后自动拉起 App 并定位 `当下 / 专注`”设计成显式设置项，默认关闭，平台不支持时自动回退到通知点击路径。
- 让时间块结束提醒保持现有时间块语义，不额外引入一套第二真相。

### 本计划明确不做

- 不把 `#571` 默认升级为“像闹钟一样强抢前台”的无条件 `full-screen intent` 方案。
- 不把 `#652` 扩展成所有页面、所有窗口、所有悬浮层统一常亮。
- 不把 Android RT keepalive 前台服务误当成“专注页常亮”或“倒计时结束提醒”能力。
- 不在第一版同时追平桌面端所有后台提醒差异；第一实现焦点是 Android 手机主链。

## 现状摘要

### `#652` 现状

- `当下 / 专注` 入口是 [src/ui/app/pages/NowPage.tsx](../ui/app/pages/NowPage.tsx) 中的 `focus` tab，页面本体挂载 [src/ui/app/components/FocusTimerWidget.tsx](../ui/app/components/FocusTimerWidget.tsx)。
- 当前运行态 UI 只有背景音、暂停/继续、结束等控制，没有 keep-awake 开关，也没有常亮状态反馈。
- Android 侧已有 RT keepalive 插件与前台服务，但它们服务于后台 RT 连通，不服务于前台页面阻止熄屏。

### `#571` 现状

- 倒计时结束现在仍由 [src/ui/app/components/FocusTimerWidget.tsx](../ui/app/components/FocusTimerWidget.tsx) 的 `requestAnimationFrame` 驱动，在本地跑到 `remaining <= 0` 时才 `new Audio(...)` 播放结束音。
- [src/lib/services/timeblock.service.ts](../lib/services/timeblock.service.ts) 管的是时间块状态迁移，不负责 Android 原生后台调度；`updateElapsed()` 当前也是空实现。
- Android Manifest 还没有 `POST_NOTIFICATIONS`、`USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM`、`WAKE_LOCK`、`RECEIVE_BOOT_COMPLETED`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK` 等相关权限。
- `MainActivity` 现在只处理键盘状态桥接，没有 `onNewIntent()` 路由 handoff。

## 核心判断

### 判断 1：这两个 issue 相关，但不是同一种技术问题

```text
#652 = 前台页面电源策略控制
#571 = 后台时间事件调度与提醒
```

`#652` 的本质是“当前页面是否阻止系统熄屏”。

`#571` 的本质是“系统在未来某个时间点是否还能可靠裁决专注结束并提醒用户”。

两者都属于“专注连续性”，但底层归属不同：

- `#652` 归前台 Activity / 页面状态。
- `#571` 归系统调度 / 通知 / 原生音频。

### 判断 2：外心现在最大的问题不是缺声音，而是“时间到了”仍由 UI 裁决

```text
现在：
UI 帧循环 -> 归零 -> 播音

应该：
系统调度 -> 到点 -> Receiver / Notification / Audio
```

只要“倒计时结束”还依赖 WebView 跑帧，后台提醒就不可能真正可靠。

### 判断 3：自动拉前台不应作为默认行为，但可以做成显式可选能力

Android 10+ 已把后台启动 Activity 变成例外路径。对 ExoMind 来说，第一阶段稳定、政策安全、用户可理解的默认能力应是：

```text
后台结束 -> 通知出现 -> 用户点击 -> 回到 App -> 定位到当下/专注
```

`full-screen intent` 只适合作为用户显式开启后的可选增强，不应该成为 `#571` 的默认验收标准，也不能替代默认通知回开链路。

## 总体方案

```text
Track A: Focus Awake
  route=/eventlog(focus) + active block + user toggle
      -> page keep-awake controller
      -> Android window keep screen on

Track B: Focus End Alert
  active countdown block
      -> native exact alarm schedule
      -> BroadcastReceiver at due time
      -> notification + background end-sound chain
      -> notification tap handoff
      -> MainActivity/onNewIntent
      -> frontend route to /eventlog

Track C: Optional Auto Foreground
  user setting enabled + platform permits
      -> alarm-class escalation path
      -> bring app to foreground
      -> route to /eventlog(focus)
      -> fallback to notification tap when unavailable
```

## 架构拆解

### Track A：`#652` 前台 keep-awake

#### 设计原则

- keep-awake 是 `当下 / 专注` 运行态的内建能力，入口直接放在页面里，而不是埋进二级设置页。
- keep-awake 只在“用户显式开启 + 当前正在 `当下 / 专注` + 存在进行中的时间块”时生效。
- 离开 `当下 / 专注`、时间块结束、用户关闭开关时，立即释放。
- Android 上优先用 Activity window flag，不依赖浏览器 Wake Lock API 当唯一实现。

#### 推荐实现

1. 在 `FocusTimerWidget` 或 `NowPage` 的专注运行态直接暴露“保持亮屏”按钮，并把用户选择持久化为例如 `focusKeepAwakeEnabled` 的本地偏好。
2. 亮屏按钮状态必须可见，至少区分：
   - 已开启 keep-awake
   - 当前可用但未开启
   - 当前环境不支持或调用失败
3. 新增 `FocusKeepAwakeController`，统一计算期望状态：
   - 当前路由是 `/eventlog`
   - 当前 tab 是 `focus`
   - 存在 active block
   - active block 仍处于 `running` / `paused` / `feedback_in_progress` 的允许阶段
   - 用户已打开 keep-awake 开关
4. Android 侧新增 Tauri command 或 mobile plugin：
   - `focus_keep_awake_set(enabled: boolean)`
   - `enabled=true` 时对当前 `Activity` 设置 `FLAG_KEEP_SCREEN_ON`
   - `enabled=false` 时清除该 flag
5. Web / 桌面端可先做 no-op 或浏览器能力探测，但不阻塞 Android 主链交付。

#### 这一轨的关键边界

- 它是“前台页面常亮”，不是后台保活。
- 它不应该调用 RT keepalive 插件，也不应该要求前台服务常驻通知。

### Track B：`#571` 后台倒计时结束提醒

#### 设计原则

- 时间块结束时刻必须从当前时间块真相字段推导，而不是复制第二套 countdown state。
- 所有调度必须围绕现有时间块生命周期事件同步，不允许 native scheduler 独自维护另一份 block 状态。
- 到点处理必须幂等，避免前台 UI 与原生 Receiver 双触发。
- “后台结束仍能播发提示音”是默认主链能力，不新增单独的后台提示音开关；继续复用现有 `countdownEndSoundEnabled` / `countdownEndSoundPresetId` 语义。

#### 推荐实现

1. 新增 Android native scheduler plugin，职责仅限：
   - `scheduleTimeblockEnd(...)`
   - `cancelTimeblockEnd(...)`
   - `rescheduleTimeblockEnd(...)`
2. 用当前已有时间块真相字段推导到点时间：
   - `startTime`
   - `targetMinutes`
   - `lastResumedAt`
   - `accumulatedRunMs`
   - `pauseAccumulatedMs`
   - `phase`
3. 在这些动作上同步 native 调度：
   - 开始 countdown block
   - 暂停
   - 恢复
   - 加一分钟 / 改时长
   - 点击结束进入反馈
   - 提交反馈 / block 真结束
4. Android 侧实现：
   - `AlarmManager` 精确闹钟
   - `BroadcastReceiver` 接收到点广播
   - Receiver 到点后先校验当前 active block 是否仍是原 block 且仍处于应提醒阶段
   - 校验通过后发送通知，并按现有结束音设置决定是否播音；必要时启动短时媒体前台服务播音
5. 第一阶段通知策略：
   - Android 先把“后台结束一定有声音兜底 + 点击回开”做稳
   - 第一落点允许先使用系统通知声音兜底，但它仍属于默认背景提示音能力，不是临时额外开关
   - 自定义提示音预设的原生直放保留为后续保真增强

#### 幂等策略

- 调度 ID 绑定到 `startId + expectedEndAt`。
- Receiver 触发后先读取当前 active block；若 block 已进入 feedback / completed 或已经不是同一 `startId`，直接 no-op。
- 前台 UI 在归零时继续走 `markEnding()`，但必须在状态迁移后同步 cancel native alarm。

### Track C：可选自动拉起并回到 `当下 / 专注`

#### 设计原则

- 默认路径仍是“用户点击通知后回 App 并定位专注页”。
- “后台结束后自动拉起 App 并定位专注页”做成显式设置项，例如 `autoOpenFocusOnTimeblockEnd`，默认关闭。
- 只有用户明确开启且平台权限允许时，才尝试 alarm-class 的自动前台路径。
- 平台不支持、权限被拒、设备策略不允许时，必须自动回退到通知点击路径。
- handoff 设计要兼容 `MainActivity` 已存在的 `singleTask` 模式。

#### 推荐实现

1. 默认通知 `PendingIntent` 带 route/action payload，例如：
   - `targetRoute=/eventlog`
   - `targetTab=focus`
   - `source=timeblock-ended`
   - `blockStartId=...`
2. `MainActivity` 补：
   - `onCreate(intent)` 首次解析
   - `onNewIntent(intent)` 复用已有实例解析
3. WebView 已就绪时：
   - 沿用现有键盘桥样式
   - `evaluateJavascript("window.dispatchEvent(new CustomEvent('exomind:native-intent', ...))")`
4. WebView 未就绪时：
   - 参照 `main-window-shortcut` 现有样板
   - 维护一份 pending handoff
   - 前端 `App` 初始化后主动消费
5. 前端新增 `native-intent-handoff.service.ts`
   - 启动时读取 pending action
   - route 到 `getEventlogPathForTab('focus')`
6. 若用户开启 `autoOpenFocusOnTimeblockEnd`：
   - Android 侧再尝试 alarm-class escalation，例如 `full-screen intent` 或受系统允许的前台拉起路径
   - 仅在权限、设备策略、前台拉起条件均满足时执行
   - 失败时无条件降级为普通通知，不影响提醒本身

## 分阶段实施

## Phase 0：铺底，不做复杂 UX

### 目标

- 先建立配置、命令、状态归属，不急着做完全部交互。

### 任务

- 明确哪些是默认能力，哪些是可选设置：
  - 默认能力：专注页 keep-awake、后台结束提示音
  - 可选设置：后台结束自动拉起 App 并定位专注页
- 明确 keep-awake 与 background alert 的设置归属，避免新增重复开关。
- 为 Android 新增缺失权限声明的计划位。
- 为时间块结束提醒定义调度 payload 结构。

### 产出

- 配置项
- 原生命令接口
- manifest 权限清单

## Phase 1：先交付 `#652`

### 目标

- 用最小代价先打通“专注页显式常亮”。

### 任务

- 在 `FocusTimerWidget` 运行态补“保持亮屏”按钮与状态反馈。
- 新增 `FocusKeepAwakeController`。
- Android 侧补 `focus_keep_awake_set(enabled)`。
- 前端 route / active block / toggle 三者联动。
- 不支持时给出明确降级提示。

### 验收

- 手机端进入 `当下 / 专注` 并开始专注后，用户可显式开启/关闭常亮。
- 返回后台、切换页面、时间块结束后，常亮自动释放。

## Phase 2：交付 `#571` 的最小可用版

### 目标

- 先做到“后台结束有声音与通知兜底，通知点回专注页”。

### 任务

- Android Manifest 补：
  - `POST_NOTIFICATIONS`
  - `WAKE_LOCK`
  - `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM`
  - `RECEIVE_BOOT_COMPLETED`
- 打通后台结束提示音默认链路，至少保证：
  - `countdownEndSoundEnabled=true` 时后台结束有声音
  - 若自定义资源暂未 native 化，先用系统通知声兜底
- 新增 native scheduler plugin。
- 用 `AlarmManager` + `BroadcastReceiver` 打通到点通知。
- 通知点击带 payload 回到 App。
- `MainActivity` 接入 `onNewIntent()` handoff。

### 验收

- App 在后台或锁屏时，倒计时结束后用户能收到系统通知。
- App 在后台或锁屏时，若结束音开关开启，倒计时结束后用户能听到提示音或等价系统声音兜底。
- 点击通知后回到 `当下 / 专注`。
- 同一条结束提醒不会重复触发。

## Phase 3：补自定义提示音与资源 native 化

### 目标

- 让默认背景提示音能力与当前前台提示音设置保持资源级一致，而不是长期停留在系统通知默认音兜底。

### 任务

- 重新整理 timer end sound 资源，使 native 可直接读取。
- 把 `countdownEndSoundEnabled` / `countdownEndSoundPresetId` 映射到原生侧可消费状态。
- 必要时引入短时 `mediaPlayback` foreground service。

### 验收

- Android 后台结束时，优先按用户配置播音；不支持时回退到通知默认音。

## Phase 4：把自动拉起专注页做成可选设置

### 目标

- 在默认提醒主链稳定后，把“后台结束自动拉起 App 并定位 `当下 / 专注`”做成受控、可降级、默认关闭的设置项。

### 任务

- 新增显式设置项，例如 `autoOpenFocusOnTimeblockEnd`。
- 单独处理 alarm-class 前台拉起路径所需能力：
  - `USE_FULL_SCREEN_INTENT`
  - lockscreen / heads-up 行为
  - Play 审核与权限授予路径
- 把“设置已开启但平台不支持”的降级反馈写清楚。

### 结论要求

- 默认关闭，只有用户显式开启才尝试。
- 失败时回退到普通通知，不影响默认提醒主链。

## 文件级落点建议

### 前端

- [src/ui/app/components/FocusTimerWidget.tsx](../ui/app/components/FocusTimerWidget.tsx)
- [src/ui/app/pages/NowPage.tsx](../ui/app/pages/NowPage.tsx)
- [src/config/timer-preferences.ts](../config/timer-preferences.ts)
- 新增：
  - `src/config/focus-keep-awake.ts`
  - `src/ui/app/components/FocusKeepAwakeButton.tsx`
  - `src/ui/app/components/FocusKeepAwakeController.tsx`
  - `src/services/native-intent-handoff.service.ts`

### TypeScript service

- [src/lib/services/timeblock.service.ts](../lib/services/timeblock.service.ts)
- [src/lib/timeblock/countdown-progress.ts](../lib/timeblock/countdown-progress.ts)

### Android / Tauri

- [src-tauri/gen/android/app/src/main/AndroidManifest.xml](../../src-tauri/gen/android/app/src/main/AndroidManifest.xml)
- [src-tauri/gen/android/app/src/main/java/com/exomind/app/MainActivity.kt](../../src-tauri/gen/android/app/src/main/java/com/exomind/app/MainActivity.kt)
- [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs)
- 可新增：
  - `src-tauri/gen/android/app/src/main/java/com/exomind/app/FocusKeepAwakePlugin.kt`
  - `src-tauri/gen/android/app/src/main/java/com/exomind/app/TimeblockAlarmReceiver.kt`
  - `src-tauri/gen/android/app/src/main/java/com/exomind/app/TimeblockAlarmService.kt`

## 验证计划

## 自动化验证

- TypeScript：
  - 继续补时间块结束时刻推导测试
  - 补 handoff service 单测
  - 补 keep-awake controller 单测
- Rust / mobile glue：
  - 至少保证 command 注册与 payload 序列化有测试

## 手测矩阵

- Android 真机，前台专注：
  - 开启 keep-awake
  - 关闭 keep-awake
  - 离开专注页
  - 时间块结束后自动释放
- Android 真机，后台提醒：
  - App 切后台
  - 锁屏
  - 专注结束
  - 提示音出现
  - 通知出现
  - 点击通知回到 `当下 / 专注`
- Android 真机，可选自动拉起：
  - 开启 `autoOpenFocusOnTimeblockEnd`
  - 专注结束
  - 若系统允许则自动拉起并定位 `当下 / 专注`
  - 若系统不允许则确认自动降级为普通通知
- 异常场景：
  - 暂停后等待
  - 恢复后重算
  - 改时长 / 加一分钟
  - 手动结束进入反馈

## 风险与对策

- `SCHEDULE_EXACT_ALARM` 权限在 Android 14+ 收口。
  - 对策：第一版同时准备“权限不可用时的通知兜底 / 降级说明”。
- 前端 UI 与 native receiver 可能重复触发结束逻辑。
  - 对策：用 `startId + expectedEndAt` 做调度 ID，并在 receiver 端二次校验当前 block phase。
- 提示音资源当前是前端 URL，不适合原生直接播。
  - 对策：先用系统通知声音把默认背景提示音链路做通，再在 Phase 3 做自定义音资源 native 化。
- keep-awake 与 RT keepalive 语义容易混淆。
  - 对策：配置项、命令名、UI 文案全程避免复用 keepalive 命名。
- 自动拉起前台受 Android 版本、权限、设备策略三重约束。
  - 对策：它只作为显式设置项存在，默认关闭，且必须有普通通知降级链路。

## 推荐推进顺序

1. 先做 `#652`
2. 再做 `#571` 的默认后台提示音 + 通知版
3. 然后补 `#571` 的自定义提示音资源 native 化
4. 最后做“自动拉起并定位专注页”的可选设置

原因很简单：

- `#652` 独立、低耦合、回报快。
- `#571` 真正难点在 native scheduler 与提醒资源下沉。
- 自动拉前台是另一类系统边界，应该挂在默认主链之后，以设置项方式受控落地。

## 同步建议

- `#652` 完成后，评论中应强调：这解决的是“专注页前台常亮”，不是后台提醒。
- `#571` 完成最小版后，评论中应强调：默认实现是“后台提示音 + 通知 + 点击回专注页”；自动拉前台是显式设置项，不是默认行为。
- 自动拉前台若后续落地，应在评论中明确权限条件、降级行为与默认关闭状态。
