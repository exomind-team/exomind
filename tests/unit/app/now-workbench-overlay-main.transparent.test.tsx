import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const renderMock = vi.fn();
const nowWorkbenchOverlayPageMock = vi.fn(() => null);
const createRootMock = vi.fn(() => ({
  render: renderMock,
}));

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: createRootMock,
  },
  createRoot: createRootMock,
}));

vi.mock('@/pages/NowWorkbenchOverlayPage', () => ({
  NowWorkbenchOverlayPage: nowWorkbenchOverlayPageMock,
}));

describe('now-workbench-overlay main entry（当下工作台悬浮窗入口）', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    document.body.innerHTML = '<div id="root"></div>';
    renderMock.mockReset();
    nowWorkbenchOverlayPageMock.mockClear();
    createRootMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('forces transparent page chrome for overlay window（强制页面外层透明）', async () => {
    await import('@/now-workbench-overlay-main');

    expect(document.documentElement.style.background).toBe('transparent');
    expect(document.body.style.background).toBe('transparent');
    expect(document.body.style.overflow).toBe('hidden');
    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(1);
  }, 15000);

  it('renders runtime overlay page instead of static preview props（入口不应写死静态预览数据）', async () => {
    await import('@/now-workbench-overlay-main');

    const rootElement = renderMock.mock.calls[0]?.[0] as {
      props?: {
        children?: {
          props?: Record<string, unknown>;
        };
      };
    };

    expect(rootElement?.props?.children?.props).toEqual({});
  }, 15000);

  it('keeps a tracked html entry for the overlay window（悬浮窗必须有独立 HTML 入口且不可被忽略）', () => {
    const htmlEntryPath = resolve(process.cwd(), 'now-workbench-overlay.html');
    const gitignorePath = resolve(process.cwd(), '.gitignore');

    expect(existsSync(htmlEntryPath)).toBe(true);
    expect(readFileSync(htmlEntryPath, 'utf8')).toContain('/src/now-workbench-overlay-main.tsx');
    expect(readFileSync(gitignorePath, 'utf8')).toContain('!now-workbench-overlay.html');
  });
});
