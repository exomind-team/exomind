import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDeveloperModeEnabled: vi.fn(),
  getDevtoolsEnabled: vi.fn(),
  erudaInit: vi.fn(),
  erudaDestroy: vi.fn(),
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: mocks.getDeveloperModeEnabled,
}));

vi.mock('@/config/devtools-mode', () => ({
  getDevtoolsEnabled: mocks.getDevtoolsEnabled,
}));

vi.mock('eruda', () => ({
  default: {
    init: mocks.erudaInit,
    destroy: mocks.erudaDestroy,
  },
}));

describe('devtools runtime（开发者工具注入）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.getDeveloperModeEnabled.mockReturnValue(false);
    mocks.getDevtoolsEnabled.mockReturnValue(false);
  });

  it('does not initialize when switches are off（关闭时不初始化）', async () => {
    const { syncDevtoolsWithSettings } = await import('@/lib/debug/devtools-runtime');
    await syncDevtoolsWithSettings();

    expect(mocks.erudaInit).not.toHaveBeenCalled();
    expect(mocks.erudaDestroy).not.toHaveBeenCalled();
  });

  it('initializes once when repeatedly synced（重复同步只初始化一次）', async () => {
    mocks.getDeveloperModeEnabled.mockReturnValue(true);
    mocks.getDevtoolsEnabled.mockReturnValue(true);
    const { syncDevtoolsWithSettings } = await import('@/lib/debug/devtools-runtime');

    await syncDevtoolsWithSettings();
    await syncDevtoolsWithSettings();

    expect(mocks.erudaInit).toHaveBeenCalledTimes(1);
  });

  it('destroys after toggled off（关闭后销毁）', async () => {
    mocks.getDeveloperModeEnabled.mockReturnValue(true);
    mocks.getDevtoolsEnabled.mockReturnValue(true);
    const { syncDevtoolsWithSettings } = await import('@/lib/debug/devtools-runtime');

    await syncDevtoolsWithSettings();
    expect(mocks.erudaInit).toHaveBeenCalledTimes(1);

    mocks.getDevtoolsEnabled.mockReturnValue(false);
    await syncDevtoolsWithSettings();
    await syncDevtoolsWithSettings();

    expect(mocks.erudaDestroy).toHaveBeenCalledTimes(1);
  });
});
