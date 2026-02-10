# Monorepo 迁移遗漏报告

> 生成时间: 2026-02-10
> 分支: refactor/monorepo-migration

---

## 摘要

| 类别 | 已迁移 | 未迁移 | 总计 |
|------|--------|--------|------|
| 页面 | 1 | 8 | 9 |
| UI 组件 | 11 | 0 | 11 |
| 功能组件 | 0 | 5 | 5 |
| 服务模块 | 1 | 5+ | 6+ |
| 适配器 | 1 | 4+ | 5+ |
| 状态存储 | 0 | 3+ | 3+ |

---

## 未迁移页面 (8个)

| 页面 | 路径 | 依赖 | 复杂度 | 优先级 |
|------|------|------|--------|--------|
| 语音聊天页面 | `src/pages/VoiceChatPage.tsx` | voice-chat.service, ASR适配器 | 高 | P0 |
| ASR测试页面 | `src/pages/ASRTestPage.tsx` | ASR端口, 火山引擎 | 中 | P1 |
| MOSSA SR测试页 | `src/pages/MOSSASRTestPage.tsx` | Moss ASR适配器 | 中 | P1 |
| 设置页面 | `src/components/Settings/SettingsPage.tsx` | 设置存储 | 低 | P2 |
| 同步测试页面 | `src/ui/pages/SyncTestPage.tsx` | sync-store, 冲突解决 | 高 | P0 |
| 用户管理页面 | `src/ui/pages/UserManagePage.tsx` | sync-store, crypto | 中 | P1 |
| 聊天页面 | `src/components/Chat/ChatPage.tsx` | chat-store, 消息存储 | 中 | P1 |
| 时间块组件 | `src/components/TimeBlockWidget.tsx` | timeblock服务, store | 中 | P2 |

---

## 未迁移功能组件 (5个)

| 组件 | 路径 | 依赖 | 复杂度 | 优先级 |
|------|------|------|--------|--------|
| 语音输入按钮 | `src/components/VoiceInputButton.tsx` | ASR端口 | 中 | P1 |
| 语音消息输入 | `src/components/VoiceMessageInput.tsx` | voice-chat.service | 中 | P1 |

---

## 未迁移服务模块 (src/lib/services/)

| 服务 | 路径 | 说明 | 复杂度 | 优先级 |
|------|------|------|--------|--------|
| 语音聊天服务 | `src/lib/services/voice-chat.service.ts` | 语音对话核心逻辑 | 高 | P0 |
| 事件日志服务 | `src/lib/services/eventlog.service.ts` | 事件读写 | 中 | P1 |
| 时间块服务 | `src/lib/services/timeblock.service.ts` | 时间块管理 | 中 | P1 |

---

## 未迁移存储层 (src/lib/db/)

| 模块 | 路径 | 说明 | 复杂度 | 优先级 |
|------|------|------|--------|--------|
| JSONL存储 | `src/lib/db/jsonl.ts` | 本地日志存储 | 中 | P1 |
| SQLite存储 | `src/lib/db/sqlite.ts` | 本地数据库 | 高 | P1 |
| 消息存储 | `src/lib/sync/message-storage.ts` | 同步消息存储 | 高 | P0 |

---

## 未迁移适配器 (src/lib/adapters/)

| 适配器 | 路径 | 说明 | 复杂度 | 优先级 |
|--------|------|------|--------|--------|
| 火山引擎ASR | `src/lib/adapters/asr/volcano-engine-asr.ts` | 语音识别 | 高 | P1 |
| Web Speech ASR | `src/lib/adapters/asr/web-speech-asr.ts` | 浏览器原生ASR | 中 | P2 |
| Moss ASR | `src/lib/adapters/asr/moss-asr.ts` | Moss语音识别 | 高 | P1 |
| Crypto适配器 | `src/adapters/crypto-adapter.ts` | 密码哈希 | 中 | P1 |
| Pouch同步 | `src/adapters/pouch-sync.ts` | PouchDB同步 | 高 | P0 |

---

## 未迁移状态存储 (src/lib/stores/)

| Store | 路径 | 说明 | 复杂度 | 优先级 |
|-------|------|------|--------|--------|
| 聊天存储 | `src/lib/stores/chat-store.ts` | 聊天状态管理 | 中 | P1 |
| 时间块存储 | `src/lib/stores/timeblock-store.ts` | 时间块状态 | 低 | P2 |
| 同步存储 | `src/ui/stores/sync-store.ts` | 同步状态管理 | 高 | P0 |

---

## 未迁移环境/端口 (src/lib/environment/)

| 模块 | 路径 | 说明 | 复杂度 | 优先级 |
|------|------|------|--------|--------|
| ASR端口 | `src/lib/ports/asr-port.ts` | 语音识别接口 | 中 | P1 |
| LLM端口 | `src/lib/ports/llm-port.ts` | LLM接口 | 中 | P1 |
| ASR接口 | `src/lib/environment/interfaces/asr.port.ts` | ASR接口定义 | 中 | P1 |

---

## 建议迁移顺序

### P0 (最高优先级)
1. **pouch-sync.ts** - 核心同步功能，其他功能依赖
2. **message-storage.ts** - 消息存储，语音聊天依赖
3. **voice-chat.service.ts** - 语音聊天核心
4. **sync-store.ts** - 同步状态
5. **SyncTestPage** - 同步测试页面

### P1 (高优先级)
1. **chat-store.ts** - 聊天状态
2. **ChatPage** - 聊天页面
3. **火山引擎/Moss ASR** - 语音识别适配器
4. **UserManagePage** - 用户管理
5. **eventlog.service.ts** - 事件日志

### P2 (中优先级)
1. **SettingsPage** - 设置页面
2. **TimeBlockWidget** - 时间块组件
3. **Web Speech ASR** - 浏览器原生
4. **crypto-adapter.ts** - 密码加密

---

## 依赖关系图

```
sync-store.ts (P0)
    │
    ├── pouch-sync.ts (P0)
    │       └── message-storage.ts (P0)
    │
    └── UserManagePage (P1)
            └── crypto-adapter.ts (P2)

voice-chat.service.ts (P0)
    │
    ├── chat-store.ts (P1)
    │       └── ChatPage (P1)
    │
    ├── 火山引擎ASR (P1)
    └── Moss ASR (P1)
            └── ASRTestPage (P1)
```

---

## 总结

Monorepo 迁移当前仅完成了基础框架搭建：
- ✅ packages/shared (工具函数、类型定义)
- ✅ packages/core (基础接口、环境)
- ✅ packages/ui (基础UI组件、首页)
- ❌ 大部分核心业务逻辑未迁移

建议按依赖顺序逐步迁移，优先完成同步模块和语音聊天功能。
