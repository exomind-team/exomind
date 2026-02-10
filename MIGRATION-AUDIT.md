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

## 已迁移服务模块

| 服务 | 迁移位置 | 状态 | 说明 |
|------|----------|------|------|
| 语音聊天服务 | `packages/core/src/services/voice-chat.service.ts` | ✅ 完成 | 语音对话核心逻辑 |
| 事件日志服务 | - | ❌ 未迁移 | 事件读写 |
| 时间块服务 | `packages/core/src/services/timeblock.service.ts` | ✅ 完成 | 时间块管理 |

## 未迁移存储层 (src/lib/db/)

| 模块 | 路径 | 说明 | 复杂度 | 优先级 |
|------|------|------|--------|--------|
| JSONL存储 | `src/lib/db/jsonl.ts` | 本地日志存储 | 中 | P1 |
| SQLite存储 | `src/lib/db/sqlite.ts` | 本地数据库 | 高 | P1 |
| 消息存储 | `src/lib/sync/message-storage.ts` | 同步消息存储 | 高 | P0 |

---

## 已迁移适配器

| 适配器 | 迁移位置 | 状态 | 说明 |
|--------|----------|------|------|
| Moss ASR | `packages/core/src/adapters/asr/moss-asr.ts` | ✅ 完成 | Moss语音识别 |
| 火山引擎ASR | `packages/core/src/adapters/asr/index.ts` | ⚠️ Stub | 语音识别 (待完整迁移) |
| Web Speech ASR | - | ❌ 未迁移 | 浏览器原生ASR |
| Crypto适配器 | `packages/core/src/adapters/crypto-adapter.ts` | ✅ 完成 | 密码哈希 |
| Pouch同步 | `packages/core/src/adapters/pouch-sync.ts` | ✅ 完成 | PouchDB同步 |

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

### P0 (最高优先级) - ✅ 大部分完成
1. ~~pouch-sync.ts~~ - ✅ 核心同步功能
2. ~~message-storage.ts~~ - ✅ 消息存储
3. ~~voice-chat.service.ts~~ - ✅ 语音聊天核心
4. ~~sync-store.ts~~ - ✅ 同步状态
5. **SyncTestPage** - 同步测试页面 (待迁移)

### P1 (高优先级) - 进行中
1. ~~chat-store.ts~~ - ✅ 聊天状态
2. **ChatPage** - 聊天页面 (待迁移)
3. **火山引擎/Moss ASR** - ⚠️ 部分完成 (Moss完成，Volcano待迁移)
4. **UserManagePage** - 用户管理 (待迁移)
5. **eventlog.service.ts** - 事件日志 (待迁移)

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

Monorepo 迁移进度：**P0 大部分完成，P1 进行中**

| 层级 | 包 | 状态 |
|------|-----|------|
| ✅ L1 Adapter | Moss ASR | 完成 |
| ✅ L1 Adapter | Crypto | 完成 |
| ✅ L1 Adapter | PouchSync | 完成 |
| ✅ L3 Service | voice-chat.service | 完成 |
| ✅ L3 Service | message-storage | 完成 |
| ✅ L3 Service | timeblock.service | 完成 |
| ✅ L4 Store | sync-store | 完成 |
| ✅ L4 Store | chat-store | 完成 |
| ⏳ L4 Store | timeblock-store | 待迁移 |
| ⏳ L4 UI | SyncTestPage | 待迁移 |
| ⏳ L4 UI | ChatPage | 待迁移 |
| ⏳ L4 UI | UserManagePage | 待迁移 |

**下一步**: 继续迁移 P1 优先级模块（ChatPage, UserManagePage, eventlog.service）
