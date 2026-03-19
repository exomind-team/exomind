# 批次 C2：前端 UI Bug 修复

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#570, #589

---

## Context

两个独立的前端 UI bug，改动互不干扰：
1. **#570**：Markdown 外链点击后替换了当前 App 页面，应在默认浏览器/新标签页打开
2. **#589**：档案入口横屏仍用 Drawer，应改为 Dialog；深色模式缺失

---

## 步骤 1：#570 Markdown 外链在默认浏览器打开

### 1.1 新建或复用外链打开工具

先搜索项目中是否已有 `shell.open` / `openExternal` / `window.open` 的统一工具函数。

**如果已有**：直接复用。

**如果没有**，新建：

```ts
// src/lib/utils/open-external.ts

export async function openExternalUrl(url: string): Promise<void> {
  // Tauri 环境
  if (window.__TAURI__) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }

  // Web 环境
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
}
```

**注意**：检查 Tauri 2.0 的 shell 插件 API。可能是 `@tauri-apps/plugin-shell` 或 `@tauri-apps/api/shell`，取决于项目中已有的 Tauri 插件配置。

### 1.2 统一 Markdown 渲染中的链接处理

找到所有 Markdown 渲染入口（如 `react-markdown` 组件的使用处），统一配置 `a` 标签的 click 处理：

```tsx
// 在所有 react-markdown 使用处的 components 配置中：
components={{
  a: ({ href, children, ...props }) => {
    if (href && isExternalUrl(href)) {
      return (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(href);
          }}
          className="text-[#C75B3A] underline hover:text-[#B24D2F]"
        >
          {children}
        </a>
      );
    }
    // 内部链接走 SPA 路由
    return <a {...props} href={href}>{children}</a>;
  },
}}
```

**更好的方案**：如果 react-markdown 在多处使用，提取一个 `MarkdownContent` 包装组件统一配置 `components`，避免散落。

### 1.3 验证

```bash
npx tsc --noEmit
```

**手动验证**：
- 事件日志中点击 Markdown 外链（http/https） → 在系统浏览器打开 ✓
- Tauri 端同上 ✓
- 内部链接（/tasks/xxx） → 正常 SPA 导航，不打开新窗口 ✓
- `javascript:` 或其他协议 → 不执行（安全） ✓

---

## 步骤 2：#589 档案入口横屏模态 + 深色模式

### 2.1 响应式容器切换

**文件**：找到 `SwitchAccountSheet` 或档案入口组件（检查 `src/ui/app/components/` 下的 account/profile 相关文件）。

**改动**：用 `useIsDesktop()` hook 判断屏幕尺寸，横屏渲染 `Dialog`，竖屏渲染 `Drawer`。

```tsx
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Drawer, DrawerContent } from '@/components/ui/drawer';

const isDesktop = useIsDesktop();

// 横屏用 Dialog
if (isDesktop) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="...">
        <AccountSwitchContent />
      </DialogContent>
    </Dialog>
  );
}

// 竖屏用 Drawer
return (
  <Drawer open={open} onOpenChange={onOpenChange}>
    <DrawerContent className="...">
      <AccountSwitchContent />
    </DrawerContent>
  </Drawer>
);
```

### 2.2 深色模式适配

**文件**：同上档案入口组件

搜索所有硬编码浅色样式（如 `text-stone-*`、`bg-white`、`border-gray-*`），替换为支持 dark: 前缀的样式：

```
text-stone-700   → text-[#57534E] dark:text-[#A8A29E]
bg-white         → bg-white dark:bg-[#1C1917]
border-gray-200  → border-[#E7E5E4] dark:border-[#292524]
```

参考项目中已有的深色模式配色方案（`#1C1917` 背景、`#FAFAF9` 文字、`#292524` 边框等）。

### 2.3 验证

```bash
npx tsc --noEmit
```

**手动验证**：
- 横屏点击档案入口 → Dialog 模态窗 ✓
- 竖屏点击档案入口 → Drawer 底部抽屉 ✓
- 深色模式下所有文字、背景、边框正常 ✓
- 浅色模式下不回归 ✓

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/lib/utils/open-external.ts` | **可能新建**（如果不存在） | #570 |
| Markdown 渲染组件 | 链接 click handler | #570 |
| 档案入口组件（SwitchAccountSheet 等） | Dialog/Drawer 切换 + dark mode | #589 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要改动 Markdown 解析逻辑** | 只改链接的打开方式，不改解析 |
| **不要删除 Drawer 组件** | 竖屏仍需要 Drawer |
| **不要修改档案切换的业务逻辑** | 只改容器形态和主题，不改切换/创建逻辑 |

## ⚠️ 容易出错的关键点

1. **Tauri shell.open API 版本**：Tauri 2.0 的 shell 插件 API 可能与 1.x 不同，检查 `src-tauri/Cargo.toml` 和已有代码中的用法
2. **`window.__TAURI__` 检测**：确认项目中判断 Tauri 环境的标准方式
3. **react-markdown 可能在多处使用**：搜索所有 `<ReactMarkdown` 或 `<Markdown` 使用处，确保统一配置
4. **深色模式样式不要用 `dark:` 前缀以外的方式**：不要用 JS 动态切换类名，用 Tailwind 的 `dark:` 前缀
5. **Dialog/Drawer 的 shadcn/ui 导入路径**：检查项目中已有的导入方式（`@/components/ui/dialog` 等）

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 外链-Web | 点击 Markdown http 链接 | 新标签页打开 | #570 |
| 外链-Tauri | 点击 Markdown http 链接 | 系统浏览器打开 | #570 |
| 内链 | 点击 /tasks/xxx 链接 | SPA 导航 | #570 |
| 档案-横屏 | 横屏点击档案入口 | Dialog 模态窗 | #589 |
| 档案-竖屏 | 竖屏点击档案入口 | Drawer 底部抽屉 | #589 |
| 档案-深色 | 深色模式查看档案界面 | 颜色正常 | #589 |
| 档案-浅色 | 浅色模式查看档案界面 | 不回归 | #589 |
| tsc | `npx tsc --noEmit` | 零错误 | 全部 |

---

## 完成回填

（Codex 执行完毕后在此填写）
