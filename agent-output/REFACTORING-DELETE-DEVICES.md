# ExoMind 重构方案 - 删除设备页面与多设备连接功能

> **目标**: 遵循架构 v4.0，删除旧的多设备连接功能，清空设置页面，为新架构腾出空间
> **日期**: 2026-02-09

---

## 1. 删除目标清单

### 1.1 需要删除的页面/路由

| 路由 | 文件 | 说明 |
|------|------|------|
| `/devices` | `src/routes.tsx` | 设备管理路由 |
| - | `src/components/Settings/DevicesPage.tsx` | 设备管理页面组件 |
| - | `src/components/Settings/DeviceList.tsx` | 设备列表组件 |

### 1.2 需要清空的页面

| 文件 | 操作 | 保留内容 |
|------|------|----------|
| `src/components/Settings/SettingsPage.tsx` | 清空内容 | 保留空壳组件 |

### 1.3 需要删除的多设备连接代码

#### 前端代码
| 文件 | 操作 | 关联 |
|------|------|------|
| `src/lib/p2p/*` | 删除 | P2P 单例类、类型定义 |
| `src/lib/sync/*` | 删除 | 设备发现、配对、消息同步 |
| `src/lib/pairing/*` | 删除 | 配对模块 |
| `src/lib/models/device.ts` | 删除 | Device 模型定义 |
| `src/hooks/usePairing.ts` | 删除 | 配对 Hook |
| `src/components/Chat/DevicePanel.tsx` | 删除 | 聊天侧边栏设备面板 |
| `src/components/Pairing/*` | 删除 | 配对弹窗组件 |
| `src/components/Settings/P2PSettings.tsx` | 删除 | P2P 设置组件 |
| `src/components/Settings/PairingCode.tsx` | 删除 | 配对码组件 |

#### 后端代码（Rust）
| 文件 | 操作 |
|------|------|
| `src-tauri/src/commands/p2p_commands.rs` | 删除 |
| `src-tauri/src/commands/pairing_commands.rs` | 删除 |
| `src-tauri/src/commands/network_commands.rs` | 删除 |
| `src-tauri/src/sync/ws_server.rs` | 删除 |

#### 测试代码
| 文件 | 操作 |
|------|------|
| `tests/unit/models/device.test.ts` | 删除 |
| `tests/components/device-panel.test.tsx` | 删除 |
| `tests/sync/device-discovery.test.ts` | 删除 |
| `tests/sync/device-pairing.test.ts` | 删除 |
| `tests/Settings.test.ts` | 删除（需要重建） |

---

## 2. 路由重构

### 2.1 当前路由（需要修改）

```tsx
// src/routes.tsx
const sidebarItems = [
  { title: "聊天", path: "/", icon: MessageCircle },
  { title: "MOSS测试", path: "/moss-test", icon: Mic },
  { title: "语音聊天", path: "/voice-chat", icon: MicVocal },
  { title: "ASR测试", path: "/asr-test", icon: Mic },
  { title: "设备", path: "/devices", icon: Smartphone },  // 删除
  { title: "设置", path: "/settings", icon: Settings },    // 保留但内容清空
];
```

### 2.2 目标路由

```tsx
const sidebarItems = [
  { title: "聊天", path: "/", icon: MessageCircle },
  { title: "MOSS测试", path: "/moss-test", icon: Mic },
  { title: "语音聊天", path: "/voice-chat", icon: MicVocal },
  { title: "ASR测试", path: "/asr-test", icon: Mic },
  // { title: "设备", path: "/devices", icon: Smartphone },  // 删除
  { title: "设置", path: "/settings", icon: Settings },    // 保留但简化
];
```

### 2.3 需要删除的导入

```tsx
// src/routes.tsx - 删除以下导入
import { Smartphone } from 'lucide-react';  // 如果只用于设备页
import { DevicesPage } from "@/components/Settings/DevicesPage";
```

---

## 3. 需要清理的依赖引用

### 3.1 chat-store.ts

检查并删除：
- 设备相关状态
- 设备相关操作

### 3.2 SettingsPage.tsx

当前功能需要清空：
- 网络状态展示
- 已配对设备列表
- 设备配对（生成/输入配对码）
- IP 直连连接

保留（可选）：
- 消息导出功能
- 数据备份功能
- 关于信息

### 3.3 Rust 后端

检查并清理：
- `lib.rs` 中的 p2p/pairing/sync 模块引用
- `tauri.conf.json` 中的相关权限配置

---

## 4. 执行步骤

### Step 1: 路由重构（优先级高）
1. 修改 `src/routes.tsx`
   - 从 sidebarItems 删除设备项
   - 删除 devicesRoute 定义
   - 清理相关导入

### Step 2: 删除设备页面组件
1. 删除 `src/components/Settings/DevicesPage.tsx`
2. 删除 `src/components/Settings/DeviceList.tsx`

### Step 3: 清空设置页面
1. 重写 `src/components/Settings/SettingsPage.tsx` 为空壳

### Step 4: 删除 P2P 模块
1. 删除 `src/lib/p2p/` 目录
2. 删除 `src/lib/sync/` 目录
3. 删除 `src/lib/pairing/` 目录
4. 删除 `src/lib/models/device.ts`

### Step 5: 删除配对相关 Hook 和组件
1. 删除 `src/hooks/usePairing.ts`
2. 删除 `src/components/Pairing/` 目录
3. 删除 `src/components/Settings/P2PSettings.tsx`
4. 删除 `src/components/Settings/PairingCode.tsx`

### Step 6: 删除设备面板
1. 删除 `src/components/Chat/DevicePanel.tsx`
2. 检查 `ChatPage.tsx` 中是否有引用并清理

### Step 7: 删除 Rust 后端命令
1. 删除 `src-tauri/src/commands/p2p_commands.rs`
2. 删除 `src-tauri/src/commands/pairing_commands.rs`
3. 删除 `src-tauri/src/commands/network_commands.rs`
4. 删除 `src-tauri/src/sync/ws_server.rs`
5. 更新 `src-tauri/src/commands/mod.rs`

### Step 8: 删除测试文件
1. 删除相关测试文件（可后续补充新测试）

### Step 9: 验证构建
1. 运行 `bun build` 验证无编译错误
2. 运行 `bun tauri build` 验证 Tauri 构建

---

## 5. 风险与注意事项

| 风险 | 应对措施 |
|------|----------|
| 误删有用代码 | 确认删除清单，逐项执行 |
| 编译错误 | 每步后运行 bun build 检查 |
| 路由错误 | 确保路由树正确更新 |
| 依赖缺失 | 检查 import 语句 |

---

## 6. 后续工作（不在本次范围）

- 重建 SettingsPage（遵循新架构）
- 重建测试用例
- 根据新架构 v4 实现新功能
