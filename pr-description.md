## 问题描述

在浏览器开发环境中，PouchDB 9.x 导致以下错误：

```
Uncaught TypeError: Class extends value #<Object> is not a constructor or null
at index-browser.es.js:346:23
```

## 根本原因

1. **PouchDB 9.x 浏览器入口文件依赖 Node.js 内置模块 `events`**
2. **ChatPage 顶层导入 `EventStorage` 类**，导致 Vite 在模块加载时立即加载 PouchDB

## 修复方案

### 1. Vite alias 配置 (vite.config.ts)
```typescript
resolve: {
  alias: {
    // PouchDB 使用浏览器版本
    "pouchdb": path.resolve(__dirname, "./node_modules/pouchdb/lib/index-browser.js"),
    // polyfill for events (required by index-browser.js)
    "events": path.resolve(__dirname, "./node_modules/events/events.js"),
    "buffer": path.resolve(__dirname, "./node_modules/buffer/index.js"),
    "process": path.resolve(__dirname, "./node_modules/process/browser.js"),
  },
}
```

### 2. 动态导入 (event-storage.ts)
- 使用 `async import('pouchdb')` 延迟加载
- `getEventStorage()` 单例模式

### 3. ChatPage 动态获取
```typescript
const { getEventStorage } = await import('@/lib/storage/event-storage');
const storage = await getEventStorage(userId);
```

## 变更文件

| 文件 | 变更 |
|------|------|
| `vite.config.ts` | 添加 PouchDB 浏览器版本 alias + polyfills |
| `src/lib/storage/event-storage.ts` | 动态导入 PouchDB + 单例模式 |
| `src/components/Chat/ChatPage.tsx` | 动态获取 getEventStorage |

## 验证结果

- ✅ 页面能正常渲染
- ✅ PouchDB 动态导入测试通过
- ✅ ChatPage 使用动态导入
- ✅ 事件能成功保存到 PouchDB

## 任务状态

| 任务 | 负责人 | 状态 |
|------|--------|------|
| 分析问题根本原因 | @investigator | ✅ 完成 |
| 修复兼容性问题 | @fixer | ✅ 完成 |
| 验证修复结果 | @tester | ✅ 完成 |

---

*此 PR 由 Agent Team 自动创建*
