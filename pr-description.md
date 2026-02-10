## 问题描述

在浏览器开发环境中，PouchDB 9.x 导致以下错误：

```
Uncaught TypeError: Class extends value #<Object> is not a constructor or null
at index-browser.es.js:346:23
```

## 根本原因

PouchDB 9.x 浏览器入口文件依赖 Node.js 内置模块 `events`，在浏览器环境中不存在。

## 修复方案

1. **动态导入 PouchDB**：使用 `async import('pouchdb')` 延迟加载
2. **避免顶层导入**：ChatPage 不在顶层直接导入 EventStorage 类
3. **安装 events polyfill**：添加 `events` 包作为显式依赖

## 变更文件

| 文件 | 变更 |
|------|------|
| `vite.config.ts` | 添加 buffer/process polyfill 配置 |
| `package.json` | 添加 `events` 依赖 |
| `src/lib/storage/event-storage.ts` | 动态导入 PouchDB |
| `tests/unit/pouchdb-import.test.ts` | 添加验证测试 |

## 验证结果

- ✅ 页面能正常渲染
- ✅ PouchDB 动态导入测试通过
- ⚠️ 浏览器控制台仍有警告（研究中）

## 待解决问题

| 问题 | 状态 | 说明 |
|------|------|------|
| 浏览器中 PouchDB 操作报错 | 🔄 调查 | 页面能加载但 addEvent 时报错 |

## 任务状态

| 任务 | 负责人 | 状态 |
|------|--------|------|
| 分析问题根本原因 | @investigator | ✅ 完成 |
| 修复兼容性问题 | @fixer | ✅ 完成 |
| 验证修复结果 | @tester | 🔄 进行中 |

---

*此 PR 由 Agent Team 自动创建*
