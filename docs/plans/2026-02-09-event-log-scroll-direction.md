# 事件日志消息刷新方式调整

**日期**: 2026-02-09
**状态**: 待实施

## 背景

当前事件日志页面（ChatPage.tsx）采用"最新消息在顶部"的展示方式，与 Telegram/微信等主流即时通讯工具的"最新消息在底部"体验不一致。需要调整为更符合用户习惯的展示方式。

## 目标

将事件日志消息刷新方式改为 Telegram/微信 风格：
- **当前**: 新消息 prepend 到顶部，滚动到顶部
- **目标**: 新消息 append 到末尾，自动滚动到底部

## 约束条件

1. **保持服务层不变**: EventLogService 保持降序存储（最新在前）
2. **渲染层处理**: 所有排序逻辑在 UI 层处理
3. **无额外 UI 元素**: 不添加回到顶部/底部按钮
4. **历史加载保持现状**: 启动时加载所有历史，后续再优化虚拟滚动

## 设计方案

### 核心变更

| 变更点 | 当前实现 | 改为 |
|--------|---------|------|
| 事件数组顺序 | 降序 [最新, ..., 最旧] | 升序 [最旧, ..., 最新] |
| 新事件插入 | prepend [newEvent, ...prev] | append [...prev, newEvent] |
| 自动滚动 | scrollIntoView({ block: 'start' }) | scrollIntoView({ block: 'end' }) |

### 数据流

```
服务层 (EventLogService)
    │
    │ loadEvents() 返回 [最新, ..., 最旧]
    ▼
┌────────────────────────┐
│  ChatPage.tsx          │
│  ──────────────────    │
│  1. 加载时反转数组      │
│     [...loaded].reverse()│
│     → [最旧, ..., 最新] │
│                        │
│  2. 渲染时直接遍历      │
│     (升序，自然显示)    │
│                        │
│  3. 新事件 append       │
│     [...prev, newEvent]│
│                        │
│  4. 滚动到底部          │
│     scrollIntoView(    │
│       { block: 'end' })│
└────────────────────────┘
```

### 代码变更

#### 1. 加载事件时反转数组 (ChatPage.tsx:30-32)

```typescript
// 当前
const loadEvents = async () => {
  const loaded = await eventLogService.loadEvents();
  setEvents(loaded);
};

// 改为
const loadEvents = async () => {
  const loaded = await eventLogService.loadEvents();
  // 反转为升序 [最旧, ..., 最新]
  setEvents([...loaded].reverse());
};
```

#### 2. 新事件回调改为 append (ChatPage.tsx:40-48)

```typescript
// 当前
const unsubscribe = eventLogService.onEvent((newEvent) => {
  setEvents(prev => {
    const exists = prev.some(e => e.id === newEvent.id);
    if (exists) return prev;
    return [newEvent, ...prev];  // prepend 到顶部
  });
});

// 改为
const unsubscribe = eventLogService.onEvent((newEvent) => {
  setEvents(prev => {
    const exists = prev.some(e => e.id === newEvent.id);
    if (exists) return prev;
    return [...prev, newEvent];  // append 到末尾（底部）
  });
});
```

#### 3. 滚动改为到底部 (ChatPage.tsx:55-59)

```typescript
// 当前
useEffect(() => {
  if (events.length > 0) {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}, [events]);

// 改为
useEffect(() => {
  if (events.length > 0) {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}, [events]);
```

### 不需要变更的部分

- **分组逻辑**: `reduce` 遍历顺序不变，日期分组自然按时间顺序
- **服务层**: EventLogService 保持降序存储，不影响其他使用方
- **事件图标/颜色逻辑**: 不涉及展示顺序

## 测试用例

| 场景 | 操作 | 预期结果 |
|------|------|----------|
| 初始加载 | 打开页面 | 显示历史消息，最新消息在底部 |
| 新事件到达 | 添加事件 | 新消息 append 到末尾，自动滚动可见 |
| 发送消息 | 输入内容发送 | 新消息显示在底部 |
| 语音输入 | 语音识别添加 | 新消息显示在底部 |

## 后续优化

- [ ] 虚拟滚动（大数据量性能优化）
- [ ] 分页加载（按需加载历史消息）
- [ ] 消息已读标记（可选功能）

## 风险与注意事项

1. **首次加载闪烁**: 加载时反转会触发渲染，消息会"闪"到正确位置
   - 解决方案: 数据量小，影响可忽略
2. **滚动时机**: 新消息到达时立即滚动，用户可能正在查看历史
   - 解决方案: 后续可考虑用户主动滚动时暂停自动滚动
