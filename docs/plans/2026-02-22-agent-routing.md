# Agent 路由接入 + 导航入口 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Agent 页面接入路由系统，在主导航添加入口，并在设置开发者模式下提供启用开关。

**Architecture:** 新增 `AgentsPage` 骨架组件，在 `routes-new.tsx` 注册 `/agents` 路由，导航栏从 2 项扩展为 3 项（当下 / Agent / 设置），设置页开发者模式区域新增"启用 Agent 页面"开关，由独立 config 函数管理。

**Tech Stack:** React 18, TypeScript, TanStack Router, Tailwind CSS, lucide-react, localStorage config pattern

---

## 设计参考（来自 Pencil 设计稿 node: 70HBU）

Agent 列表页关键视觉：
- Header: "Agents" 标题 + 右侧圆形 `+` 按钮（`#F5F0ED` 背景）
- Card Area: 垂直排列的 Agent 卡片，每张高 140px，圆角 20，毛玻璃效果
  - 卡片内：渐变光晕背景 + Avatar（渐变圆形图标）+ 名称/描述/状态 Meta
  - 三个示例 Agent：Governor（shield 图标）、Growth Coach（heart 图标）、Task System（bot 图标）
- Nav Bar: 3 项 — 当下(target)、**Agent(bot, 激活色 #C75B3A)**、设置(settings)
- 配色：激活 `#C75B3A`，非激活 `#A8A29E`，背景 `#FAF7F5`

---

## Task 1: 新增 agent-page-enabled config

**Files:**
- Create: `src/config/agent-page-enabled.ts`

**Step 1: 创建 config 文件**

```typescript
const KEY = 'exomind:agentPageEnabled';
const EVENT = 'exomind:agent-page-enabled-changed';

export function getAgentPageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(KEY) === 'true';
}

export function setAgentPageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: enabled }));
}

export function subscribeAgentPageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    listener(event.newValue === 'true');
  };
  const handleCustom = (event: Event) => {
    listener(Boolean((event as CustomEvent<boolean>).detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(EVENT, handleCustom);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(EVENT, handleCustom);
  };
}
```

**Step 2: Commit**

```bash
git add src/config/agent-page-enabled.ts
git commit -m "feat: add agent-page-enabled config [agent-page-enabled.ts]"
```

---

## Task 2: 创建 AgentsPage 骨架组件

**Files:**
- Create: `src/ui/new/pages/AgentsPage.tsx`

**Step 1: 创建页面组件**

按设计稿实现 Agent 列表页骨架（静态数据，无真实 Agent 逻辑）：

```tsx
import { Bot, Heart, Plus, Shield } from 'lucide-react';

type AgentCardProps = {
  icon: React.ReactNode;
  name: string;
  desc: string;
  model: string;
  status: string;
  gradientFrom: string;
  gradientTo: string;
  glowColor: string;
};

function AgentCard({ icon, name, desc, model, status, gradientFrom, gradientTo, glowColor }: AgentCardProps) {
  return (
    <div className="relative h-[140px] w-full overflow-hidden rounded-[20px]">
      {/* BG Glow */}
      <div
        className="absolute left-4 top-[18px] h-[120px] w-[321px] rounded-[20px] blur-lg"
        style={{ background: `linear-gradient(145deg, ${glowColor}, ${gradientTo})` }}
      />
      {/* Card Content */}
      <div
        className="absolute inset-2 flex items-start gap-[14px] rounded-[20px] border border-white/50 p-[16px_18px] backdrop-blur-2xl"
        style={{ background: 'rgba(255,255,255,0.63)' }}
      >
        {/* Avatar */}
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[22px]"
          style={{ background: `linear-gradient(145deg, ${gradientFrom}, ${gradientTo})` }}
        >
          {icon}
        </div>
        {/* Info */}
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-[#1C1917]">{name}</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600">{status}</span>
          </div>
          <span className="text-xs text-[#A8A29E]">{desc}</span>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-[11px] text-[#C4B5A5]">{model}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const MOCK_AGENTS: AgentCardProps[] = [
  {
    icon: <Shield size={22} className="text-white" />,
    name: 'Governor',
    desc: '系统守护者 · 抑制冲动决策',
    model: 'Claude Opus',
    status: '活跃',
    gradientFrom: '#E8866F',
    gradientTo: '#C75B3A',
    glowColor: '#EDADA0',
  },
  {
    icon: <Heart size={22} className="text-white" />,
    name: 'Growth Coach',
    desc: '成长教练 · 长期目标追踪',
    model: 'Claude Sonnet',
    status: '待机',
    gradientFrom: '#7CB9E8',
    gradientTo: '#4A90C4',
    glowColor: '#A8D4F0',
  },
  {
    icon: <Bot size={22} className="text-white" />,
    name: 'Task System',
    desc: '任务分解与执行 · 优先级管理',
    model: 'Claude Haiku',
    status: '活跃',
    gradientFrom: '#8FBC8F',
    gradientTo: '#5A9A5A',
    glowColor: '#B5D5B5',
  },
];

export function AgentsPage() {
  return (
    <div className="flex h-full flex-col bg-[#FAF7F5]">
      {/* Status Bar placeholder */}
      <div className="h-[54px] shrink-0" />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3">
        <span className="text-[18px] font-semibold text-[#1C1917]">Agents</span>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-[18px] bg-[#F5F0ED]"
        >
          <Plus size={18} className="text-[#1C1917]" />
        </button>
      </div>

      {/* Card Area */}
      <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto px-5 pt-2 pb-4">
        {MOCK_AGENTS.map((agent) => (
          <AgentCard key={agent.name} {...agent} />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/ui/new/pages/AgentsPage.tsx
git commit -m "feat: add AgentsPage skeleton component [AgentsPage.tsx]"
```

---

## Task 3: 注册路由 + 更新导航

**Files:**
- Modify: `src/routes-new.tsx`

**Step 1: 读取文件确认当前内容**

确认 `src/routes-new.tsx` 的 import 区域、navItems 数组、路由注册和 addChildren 调用。

**Step 2: 修改文件**

在 `src/routes-new.tsx` 做以下 4 处改动：

**改动 1 — 新增 import（在现有 import 后追加）：**
```tsx
import { Bot } from 'lucide-react';
import { AgentsPage } from '@/ui/new/pages/AgentsPage';
import { getAgentPageEnabled, subscribeAgentPageEnabledChanges } from '@/config/agent-page-enabled';
```

**改动 2 — NewLayout 函数内，在 navItems 定义前新增 state：**
```tsx
const [agentPageEnabled, setAgentPageEnabled] = useState(() => getAgentPageEnabled());

useEffect(() => {
  return subscribeAgentPageEnabledChanges(setAgentPageEnabled);
}, []);
```
同时在文件顶部 import 中补充 `useState, useEffect`（来自 react）。

**改动 3 — navItems 数组改为动态：**
```tsx
const navItems = [
  { title: '当下', path: '/eventlog', icon: Target },
  ...(agentPageEnabled ? [{ title: 'Agent', path: '/agents', icon: Bot }] : []),
  { title: '设置', path: '/settings', icon: Settings },
];
```

**改动 4 — 新增路由定义（在 newMossTestRoute 后）：**
```tsx
const newAgentsRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents',
  component: function NewAgents() {
    return <AgentsPage />;
  },
});
```

**改动 5 — addChildren 加入新路由：**
```tsx
const newRouteTree = newRootRoute.addChildren([
  newHomeRoute,
  newEventlogRoute,
  newSettingsRoute,
  newUserManageRoute,
  newAsrTestRoute,
  newMossTestRoute,
  newAgentsRoute,
]);
```

**Step 3: Commit**

```bash
git add src/routes-new.tsx
git commit -m "feat: register /agents route and add nav entry [routes-new.tsx]"
```

---

## Task 4: 设置页添加"启用 Agent 页面"开关

**Files:**
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`

**Step 1: 新增 import**

在现有 developer-mode import 后追加：
```tsx
import {
  getAgentPageEnabled,
  setAgentPageEnabled,
} from '@/config/agent-page-enabled';
```

**Step 2: 新增 state（在 developerMode state 附近）**

```tsx
const [agentPageEnabled, setAgentPageEnabledState] = useState<boolean>(
  () => getAgentPageEnabled()
);
```

**Step 3: 新增 handler**

```tsx
const handleAgentPageToggle = (checked: boolean) => {
  setAgentPageEnabled(checked);
  setAgentPageEnabledState(checked);
};
```

**Step 4: 在开发者模式展开区域插入新 SettingRow**

在现有 `{developerMode && (` 块内，找到最后一个 `<Divider />` 后，追加：

```tsx
<Divider />
<SettingRow
  icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
  label="启用 Agent 页面"
  right={
    <Switch
      checked={agentPageEnabled}
      onCheckedChange={handleAgentPageToggle}
    />
  }
/>
```

注意：`Bot` 已在现有 import 中（`import { Bot, ... } from 'lucide-react'`），确认存在即可。

**Step 5: Commit**

```bash
git add src/ui/new/pages/NewSettingsPage.tsx
git commit -m "feat: add agent-page toggle in developer settings [NewSettingsPage.tsx]"
```

---

## Task 5: 验证

**Step 1: 类型检查**

```bash
cd D:\project\.vibe-kanban-workspaces\7cbd-gh-208-feat-agen\exomind
bun run build
```

期望：无 TypeScript 错误。

**Step 2: 手动验证流程**

1. 打开应用，底部导航只有「当下」和「设置」两项
2. 进入设置 → 开启「开发者模式」
3. 看到「启用 Agent 页面」开关出现
4. 打开「启用 Agent 页面」
5. 底部导航出现「Agent」入口（中间位置）
6. 点击「Agent」→ 跳转到 `/agents`，显示 Agent 列表页骨架
7. 关闭「启用 Agent 页面」→ 导航入口消失，直接访问 `/agents` 仍可访问（路由已注册）

**Step 3: 最终 push**

```bash
git push
```
