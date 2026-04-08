# 语音运行时智能体第一阶段实施计划

> 实施本计划时，按任务顺序逐项执行、逐项测试，不跳步。

**目标**

为 ExoMind 新增一套独立的“语音运行时智能体”能力。第一阶段先交付桌面端可用的 `Voice Runtime Lab` 页面，接入豆包 `O2.0` 实时语音能力，支持本地持续监听、按需上云、前台长连、实时字幕、供应商原始事件观测、信号驱动播报，并保证现有快捷键语音链路不受影响。

**整体方案**

这一期不先做悬浮窗，先做桌面端一级页面。页面既是正式风格的实验台，也是完整联调面板。设置页只放轻量开关和跳转入口；详细参数、供应商原始事件、实时状态、调试能力都先放在 `Voice Runtime Lab` 页面里。等页面联通、测试稳定后，再复用同一套状态与组件裁出悬浮窗。

**技术边界**

- 只做桌面端主开发链路，移动端默认不显示该页面入口。
- `Phase 1` 只接一个供应商：豆包 `O2.0` 实时语音。
- 保留两层感知数据：
  - 供应商原始感知
  - 标准化语音感知
- 感知层可以黑盒，标准化结果、信号发布、播报策略必须白盒。
- 现有快捷键语音链路完全保留，不在本计划中重构。

---

## 一、已确认决策

### 1. 功能定位

- 新能力是独立功能，不是现有快捷键语音的增强版。
- `Voice Runtime Agent` 作为信号网络中的一个独立节点存在。
- 最终文本仍然进入现有 `voice.input.transcript` 主链路。

### 2. 供应商与模式

- 第一阶段唯一供应商：`doubao-o2-realtime`
- 三档模式：
  - `off`
  - `push-to-talk`
  - `ambient`

### 3. 云端会话策略

第一阶段要把“远端长连”能力纳入 MVP，但只做前台版本，不承诺后台常驻。

- `on-demand`
  - 本地持续监听
  - 本地 `VAD` 命中后才建立或使用云端会话
- `foreground-persistent`
  - 页面打开且前台可见时，保持云端实时会话长连
  - 页面离开前台或关闭后，按策略释放

后续再考虑：

- `background-persistent`
  - 后台常驻长连
  - 不属于本期范围

### 4. 页面与入口

- 第一阶段主验收面是独立页面，不是悬浮窗。
- 页面路由建议为：`/voice-runtime`
- 页面入口只在桌面端显示。
- 入口受开发者开关控制。
- 设置页提供：
  - 功能总开关
  - 模式切换
  - 云端会话策略
  - 供应商选择
  - 打开实验页入口

### 5. 悬浮窗策略

- 悬浮窗不删除，但从第一阶段主阻塞项里降级。
- 顺序改为：
  1. 页面
  2. 设置页轻入口
  3. Provider 与 Agent 联通
  4. 自动化测试
  5. 再做悬浮窗

---

## 二、第一阶段交付范围

### 必须交付

- 桌面端一级页面：`Voice Runtime Lab`
- 开发者开关控制页面入口显示
- 设置页轻量入口
- `off / push-to-talk / ambient`
- `on-demand / foreground-persistent`
- 豆包 `O2.0` Provider 接入
- 本地 `VAD`
- 用户说话时可打断当前播报
- 页面内展示：
  - 当前运行状态
  - 中间字幕
  - 最终文本
  - 供应商原始事件
  - 标准化感知结果
  - 播报测试区
- 信号驱动播报：
  - `voice.runtime.speak.request`
  - `voice.runtime.speak.cancel`
- 自动化测试覆盖核心状态机、Provider 映射、页面状态展示

### 暂不交付

- 后台常驻长连
- 多人识别 / 说话人分离
- 声纹 / 主人识别
- AI Registry 正式整合
- 与 `Now Workbench Overlay` 合并
- 正式悬浮窗交付

---

## 三、页面信息架构

第一阶段页面不是临时调试页，而是正式风格的实验台。视觉风格对齐当前新 UI，复用现有页面壳和卡片布局风格。

### 页面建议区块

#### 1. 运行总览

展示：

- 功能开关
- 当前模式
- 当前供应商
- 当前云端策略
- 当前连接状态
- 当前麦克风状态
- 当前是否正在播报
- 当前是否正在监听

#### 2. 运行参数

先把详细参数都放进这一块，后续再决定哪些下沉到设置页。

包含：

- 模式选择
- 云端会话策略选择
- Provider 选择
- 模型参数
- 打断策略
- 自动播报开关
- 本地 `VAD` 阈值与时间窗
- 连接超时、重连、前台释放策略等

#### 3. 实时转写与感知

展示：

- 中间字幕
- 最终文本
- 说话状态
- 打断状态
- 情绪、语气、置信度等标准化字段

#### 4. 供应商原始事件面板

展示：

- `StartSession`
- 连接建立事件
- 原始实时事件流
- 原始 `payload`
- 错误事件
- 原始响应时间线

#### 5. 播报与信号测试

展示：

- 手动发送 `speak.request`
- 手动发送 `speak.cancel`
- 文本播报测试
- 打断测试
- 观察 Provider 播报状态

---

## 四、数据模型

### 1. 供应商原始感知

```ts
type ProviderRawPerception = {
  provider: string;
  model: string;
  eventType: string;
  payload: Record<string, unknown>;
  capturedAt: string;
};
```

说明：

- 原始事件完整保留，不做裁剪。
- 页面里需要能直接查看这一层。

### 2. 标准化语音感知

```ts
type NormalizedVoicePerception = {
  traceId: string;
  provider: 'doubao-o2-realtime';
  transcript: string;
  isFinal: boolean;
  emotion?: string;
  arousal?: number;
  speakingStyle?: string;
  confidence?: number;
  providerMeta?: Record<string, unknown>;
};
```

说明：

- 标准化结构是后续认知 Agent 使用的主入口。
- 页面里需要同时展示“原始层”和“标准化层”。

### 3. 新增主题

建议新增：

- `voice.stream.partial`
- `voice.runtime.state.updated`
- `voice.runtime.mode.changed`
- `voice.runtime.speak.request`
- `voice.runtime.speak.cancel`

---

## 五、配置与入口设计

### 1. 设置页只放轻量入口

设置页第一阶段只放这些内容：

- `voice-runtime-enabled`
- `voice-runtime-mode`
- `voice-runtime-provider`
- `voice-runtime-cloud-session-policy`
- `voice-runtime-auto-speak-enabled`
- `voice-runtime-lab-nav-enabled`
- `open-voice-runtime-lab`

说明：

- 详细参数先不要堆进设置页。
- 详细参数全部在 `Voice Runtime Lab` 页面内调整。

### 2. 页面入口开关

页面入口建议由开发者设置项控制：

- 默认关闭
- 打开后，桌面端侧边栏出现 `语音实验` 或 `语音运行时` 入口
- 移动端默认不显示

---

## 六、代码落点建议

### 页面与路由

- 新建：`src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx`
- 修改：`src/routes.tsx`
- 视情况新增页面拆分组件目录：
  - `src/ui/app/pages/voice-runtime/components/`

### 设置配置

- 新建：`src/config/voice-runtime-mode.ts`
- 新建：`src/config/voice-runtime-settings.ts`
- 新建：`src/config/voice-runtime-lab-preferences.ts`
- 修改：`src/ui/app/config/settings/settings-registry.ts`
- 修改：`src/ui/app/components/settings/settings-custom-items.tsx`

### Provider 抽象

- 新建：`src/lib/voice-runtime/providers/types.ts`
- 新建：`src/lib/voice-runtime/types.ts`
- 新建：`src/lib/voice-runtime/providers/doubao-e2e-realtime-provider.ts`
- 新建：`src/config/voice-runtime-doubao.ts`

### Agent 主服务

- 新建：`src/services/voice-runtime-agent.service.ts`
- 新建：`src/lib/voice-runtime/normalize-perception.ts`
- 新建：`src/lib/voice-runtime/local-vad.ts`
- 新建：`src/lib/voice-runtime/speak-bridge.ts`
- 修改：`src/lib/constants/signal-topics.ts`
- 修改：`src/lib/services/voice-signal.service.ts`

### 后续悬浮窗预留

先只预留，不在第一阶段主任务中完成：

- `voice-runtime-overlay.html`
- `src/voice-runtime-overlay-main.tsx`
- `src/pages/VoiceRuntimeOverlayPage.tsx`
- `src/services/voice-runtime-overlay.service.ts`

---

## 七、实施任务拆分

### 任务 1：重构计划基线，先把“桌面页面优先”的骨架搭起来

**涉及文件**

- 新建：`src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx`
- 修改：`src/routes.tsx`
- 测试：`tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx`

**步骤**

1. 先写失败测试，断言：
   - 存在 `/voice-runtime` 路由
   - 页面只作为桌面端开发入口使用
   - 页面有基础区块骨架
2. 运行测试，确认失败：
   - `bunx vitest run tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx`
3. 写最小实现：
   - 新增页面
   - 在路由里注册页面
   - 页面使用现有统一风格的页面壳
4. 再跑测试，确认通过

### 任务 2：先把设置页轻量入口和开发者开关立起来

**涉及文件**

- 新建：`src/config/voice-runtime-mode.ts`
- 新建：`src/config/voice-runtime-settings.ts`
- 修改：`src/ui/app/config/settings/settings-registry.ts`
- 修改：`src/ui/app/components/settings/settings-custom-items.tsx`
- 测试：
  - `tests/unit/config/voice-runtime-mode.test.ts`
  - `tests/unit/config/voice-runtime-settings.test.ts`

**步骤**

1. 写失败测试，断言：
   - 存在三档模式
   - 存在云端会话策略
   - 存在开发者入口开关
   - 设置页有“打开实验页”入口
2. 运行测试，确认失败
3. 写最小实现
4. 运行测试，确认通过

### 任务 3：定义 Provider 接口、原始层与标准化层

**涉及文件**

- 新建：`src/lib/voice-runtime/providers/types.ts`
- 新建：`src/lib/voice-runtime/types.ts`
- 修改：`src/lib/constants/signal-topics.ts`
- 测试：`tests/unit/lib/voice-runtime/types.test.ts`

**步骤**

1. 写失败测试，断言：
   - `ProviderRawPerception` 存在
   - `NormalizedVoicePerception` 存在
   - 新主题常量存在
2. 运行测试，确认失败
3. 写最小实现
4. 运行测试，确认通过

### 任务 4：实现豆包 `O2.0` Provider 最小可用骨架

**涉及文件**

- 新建：`src/lib/voice-runtime/providers/doubao-e2e-realtime-provider.ts`
- 新建：`src/config/voice-runtime-doubao.ts`
- 测试：`tests/unit/lib/voice-runtime/providers/doubao-e2e-realtime-provider.test.ts`

**步骤**

1. 写失败测试，断言：
   - 能建立连接
   - 能发送 `StartSession`
   - 能发送音频块
   - 能接收原始事件
   - 能执行打断
2. 运行测试，确认失败
3. 写最小实现
4. 运行测试，确认通过

### 任务 5：实现本地 `VAD` 与云端策略切换

**涉及文件**

- 新建：`src/lib/voice-runtime/local-vad.ts`
- 修改：`src/services/voice-runtime-agent.service.ts`
- 测试：
  - `tests/unit/lib/voice-runtime/local-vad.test.ts`
  - `tests/unit/services/voice-runtime-agent.service.test.ts`

**步骤**

1. 写失败测试，断言：
   - `on-demand` 模式下未命中语音时不上云
   - 命中后才建立或利用会话
   - `foreground-persistent` 模式下前台可保持连接
   - 页面失焦或策略切换时正确释放
2. 运行测试，确认失败
3. 写最小实现
4. 运行测试，确认通过

### 任务 6：实现 `Voice Runtime Agent` 主状态机

**涉及文件**

- 新建：`src/services/voice-runtime-agent.service.ts`
- 新建：`src/lib/voice-runtime/normalize-perception.ts`
- 修改：`src/lib/services/voice-signal.service.ts`
- 测试：`tests/unit/services/voice-runtime-agent.service.test.ts`

**步骤**

1. 写失败测试，断言：
   - 能消费 Provider 原始事件
   - 能产出标准化感知
   - `partial` 发布到 `voice.stream.partial`
   - `final` 发布到 `voice.input.transcript`
   - 用户说话时能打断当前播报
2. 运行测试，确认失败
3. 写最小实现
4. 运行测试，确认通过

### 任务 7：做正式风格的 `Voice Runtime Lab` 页面

**涉及文件**

- 新建：`src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx`
- 新建：
  - `src/ui/app/pages/voice-runtime/components/RuntimeStatusCard.tsx`
  - `src/ui/app/pages/voice-runtime/components/RuntimeControlsCard.tsx`
  - `src/ui/app/pages/voice-runtime/components/TranscriptCard.tsx`
  - `src/ui/app/pages/voice-runtime/components/ProviderRawEventsCard.tsx`
  - `src/ui/app/pages/voice-runtime/components/SpeakTestCard.tsx`
- 测试：`tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx`

**步骤**

1. 写失败测试，断言页面具备五大区块
2. 运行测试，确认失败
3. 写最小实现：
   - 正式风格卡片布局
   - 页面内可调整详细参数
   - 页面内可查看原始事件与标准化结果
4. 运行测试，确认通过

### 任务 8：接入信号驱动播报

**涉及文件**

- 新建：`src/lib/voice-runtime/speak-bridge.ts`
- 修改：`src/services/voice-runtime-agent.service.ts`
- 测试：`tests/unit/lib/voice-runtime/speak-bridge.test.ts`

**步骤**

1. 写失败测试，断言：
   - 能响应 `voice.runtime.speak.request`
   - 能响应 `voice.runtime.speak.cancel`
   - 未收到信号时不会主动开口
2. 运行测试，确认失败
3. 写最小实现
4. 运行测试，确认通过

### 任务 9：路由入口与桌面导航联通

**涉及文件**

- 修改：`src/routes.tsx`
- 测试：`tests/unit/routes/voice-runtime-route.test.tsx`

**步骤**

1. 写失败测试，断言：
   - 桌面端在开发者开关开启时显示入口
   - 移动端默认不显示
   - 设置页能跳转到实验页
2. 运行测试，确认失败
3. 写最小实现
4. 运行测试，确认通过

### 任务 10：第一阶段全量验证

**步骤**

1. 跑聚焦测试：

```bash
bunx vitest run tests/unit/config/voice-runtime-mode.test.ts tests/unit/config/voice-runtime-settings.test.ts tests/unit/lib/voice-runtime/types.test.ts tests/unit/lib/voice-runtime/providers/doubao-e2e-realtime-provider.test.ts tests/unit/lib/voice-runtime/local-vad.test.ts tests/unit/lib/voice-runtime/speak-bridge.test.ts tests/unit/services/voice-runtime-agent.service.test.ts tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx tests/unit/routes/voice-runtime-route.test.tsx
```

2. 跑相关回归：

```bash
bunx vitest run tests/unit/services/voice-shortcut.service.test.ts tests/unit/pages/VoiceOverlayPage.test.tsx
```

3. 跑类型检查：

```bash
bunx tsc --noEmit
```

4. 跑构建：

```bash
bun run build
```

---

## 八、验收标准

第一阶段验收以“页面可用、链路联通、测试通过”为准。

### 产品验收

- 桌面端存在独立页面：`/voice-runtime`
- 页面入口受开发者开关控制
- 设置页提供轻量开关与跳转入口
- 页面内能配置详细参数
- 支持：
  - `off`
  - `push-to-talk`
  - `ambient`
- 支持：
  - `on-demand`
  - `foreground-persistent`
- 页面内可看到：
  - 运行状态
  - 中间字幕
  - 最终文本
  - 原始事件
  - 标准化结果
  - 播报测试状态
- 用户说话能打断当前播报
- 最终文本进入现有 `voice.input.transcript`
- 现有快捷键语音能力无回归

### 技术验收

- Provider 原始事件完整保留
- 标准化感知结构稳定输出
- 自动化测试覆盖核心路径
- 页面风格对齐当前正式 UI，不是临时调试页

---

## 九、第二阶段预告

这部分不阻塞当前实施，只作为后续方向记录：

- 复用页面状态与组件，裁出独立悬浮窗
- 支持后台常驻长连
- 多人识别 / 声纹 / 主人识别
- 接第二个实时语音供应商
- 进入统一 AI Provider 体系
- 与 `Now Workbench Overlay` 做后续整合
