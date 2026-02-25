# Clipboard 调研报告（Tauri 复制回归）

日期：2026-02-25  
范围：定位「Tauri 端复制失败」根因，并给出可验证修复。

## 1. 现象与复现

- 现象：Tauri 端点击「复制」失败。
- 对照：历史可用版本为 `0.3.3-build.20260223T1558`（commit: `181a74e4fc3f59814e6b98283a42ce710f82aebe`）。

## 2. 历史基线（可用版本）代码路径

在 `181a74e` 中，`MessageActions` 直接使用 Web Clipboard API：

```tsx
const handleCopy = useCallback(async () => {
  try {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  } catch (err) {
    console.error('[MessageActions] clipboard.writeText failed:', err);
    toast({ title: '复制失败，请重试', variant: 'destructive' });
  }
}, [content]);
```

该路径不依赖 Tauri plugin invoke 的 ACL 授权。

## 3. 回归引入点（重构后）

在 commit `091f5eb`（`refactor(clipboard): move clipboard I/O into service and runtime adapters`）后，复制/粘贴改为走 service + tauri adapter：

```ts
export class TauriClipboardAdapter implements IClipboardPort {
  async readText(): Promise<string> {
    const text = await invoke<string>('plugin:clipboard-manager|read_text');
    return typeof text === 'string' ? text : '';
  }

  async writeText(text: string): Promise<void> {
    await invoke('plugin:clipboard-manager|write_text', { text });
  }
}
```

## 4. ACL 配置证据（关键根因）

重构时 capability 配置是：

```json
{
  "permissions": [
    "core:default",
    "opener:default",
    "clipboard-manager:default",
    "mcp-bridge:default"
  ]
}
```

而生成的 ACL schema 明确说明：

```json
{
  "identifier": "default",
  "description": "No features are enabled by default ... Clipboard interaction needs to be explicitly enabled.",
  "permissions": []
}
```

并且 `allow-read-text` / `allow-write-text` 才是实际开放命令的权限：

```json
{
  "identifier": "allow-write-text",
  "commands": {
    "allow": ["write_text"],
    "deny": []
  }
}
```

结论：`clipboard-manager:default` 不会授予 `write_text/read_text`，导致 invoke 路径失败。

## 5. 根因结论

这是一个“路径切换 + 权限未显式开放”的回归：

1. 旧版：`navigator.clipboard.writeText`（可工作）  
2. 新版：`invoke('plugin:clipboard-manager|write_text')`（需要 ACL 显式授权）  
3. 配置仍是 `clipboard-manager:default`（实际不授权命令）  
4. 结果：Tauri 复制失败

## 6. 修复方案与代码

### 6.1 修复 ACL：显式开放读写文本

`src-tauri/capabilities/default.json`：

```json
{
  "permissions": [
    "core:default",
    "opener:default",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "mcp-bridge:default"
  ]
}
```

### 6.2 修复适配器：invoke 失败时回退 Web Clipboard

`src/lib/adapters/clipboard-tauri-adapter.ts`：

```ts
export class TauriClipboardAdapter implements IClipboardPort {
  isAvailable(): boolean {
    return true;
  }

  async readText(): Promise<string> {
    try {
      const text = await invoke<string>('plugin:clipboard-manager|read_text');
      return typeof text === 'string' ? text : '';
    } catch (tauriError) {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function') {
        return navigator.clipboard.readText();
      }
      throw tauriError;
    }
  }

  async writeText(text: string): Promise<void> {
    try {
      await invoke('plugin:clipboard-manager|write_text', { text });
      return;
    } catch (tauriError) {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return;
      }
      throw tauriError;
    }
  }
}
```

## 7. 回归防护测试

新增 `tests/unit/adapters/clipboard-tauri-adapter.test.ts`，覆盖四类场景：

```ts
it('uses tauri invoke for write by default', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const adapter = new TauriClipboardAdapter();
  await adapter.writeText('copy-from-tauri');
  expect(invoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', { text: 'copy-from-tauri' });
});

it('falls back to navigator clipboard write when tauri invoke fails', async () => {
  const tauriError = new Error('clipboard command denied');
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.mocked(invoke).mockRejectedValue(tauriError);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const adapter = new TauriClipboardAdapter();
  await adapter.writeText('copy-from-web');
  expect(writeText).toHaveBeenCalledWith('copy-from-web');
});
```

## 8. 验证证据

已执行并通过：

```bash
npx vitest run tests/unit/adapters/clipboard-tauri-adapter.test.ts tests/unit/adapters/clipboard-web-adapter.test.ts tests/unit/services/clipboard.service.test.ts
npx vitest run tests/unit/components/MessageActions.test.tsx tests/unit/ui/new-now-input-row.test.tsx
npx tsc --noEmit
npx vite build
```

说明：仓库当前 `npx vitest run` 全量仍有大量历史失败项（与本次 clipboard 改动无直接关系），本次报告以 clipboard 相关链路专项通过为准。

## 9. 影响面说明

本次修复影响的 clipboard 功能入口：

- 聊天气泡复制：`src/components/Chat/MessageActions.tsx`
- 新输入区粘贴：`src/ui/new/components/NewNowInputRow.tsx`
- ASR 测试页复制：`src/pages/MOSSASRTestPage.tsx`

这些入口通过同一 service 层调用，都会受益于本次 ACL + adapter fallback 修复。
