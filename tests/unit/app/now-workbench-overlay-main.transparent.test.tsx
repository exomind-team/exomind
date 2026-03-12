import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({
  render: renderMock,
}));

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: createRootMock,
  },
  createRoot: createRootMock,
}));

describe('now-workbench-overlay main entry（当下工作台悬浮窗入口）', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    document.body.innerHTML = '<div id="root"></div>';
    renderMock.mockReset();
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
  });

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
  });
});
