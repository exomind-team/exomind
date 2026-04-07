import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

function installStorageStub(storage: Record<string, string>): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        for (const key of Object.keys(storage)) {
          delete storage[key];
        }
      },
      key: (index: number) => Object.keys(storage)[index] ?? null,
      get length() {
        return Object.keys(storage).length;
      },
    },
  });
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('pty terminal preferences（PTY 终端偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    storage = {};
    installStorageStub(storage);
    isTauriMock.mockResolvedValue(false);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults to the configured waiting-input idle timeout（默认等待输入超时正确）', async () => {
    const module = await import('@/config/pty-terminal-preferences');

    expect(module.DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS).toBe(60);
    expect(module.getPtyWaitingInputIdleTimeoutSeconds()).toBe(
      module.DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
    );
    expect(module.getPtyTerminalReplayLimitKb()).toBe(
      module.DEFAULT_PTY_TERMINAL_REPLAY_LIMIT_KB,
    );
  });

  it('clamps timeout values and notifies subscribers（超时会被约束并广播）', async () => {
    const module = await import('@/config/pty-terminal-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribePtyWaitingInputIdleTimeoutSecondsChanges(listener);

    expect(module.setPtyWaitingInputIdleTimeoutSeconds(999)).toBe(
      module.MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
    );
    expect(storage[module.PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS_STORAGE_KEY]).toBe('600');

    expect(module.setPtyWaitingInputIdleTimeoutSeconds(-5)).toBe(
      module.MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
    );
    expect(storage[module.PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS_STORAGE_KEY]).toBe('1');
    expect(listener).toHaveBeenLastCalledWith(1);

    unsubscribe();
  });

  it('clamps replay limit values and derives scrollback lines（历史回放上限会被约束并映射到 scrollback 行数）', async () => {
    const module = await import('@/config/pty-terminal-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribePtyTerminalReplayLimitKbChanges(listener);

    expect(module.setPtyTerminalReplayLimitKb(4096)).toBe(
      module.MAX_PTY_TERMINAL_REPLAY_LIMIT_KB,
    );
    expect(storage[module.PTY_TERMINAL_REPLAY_LIMIT_KB_STORAGE_KEY]).toBe('2048');

    expect(module.setPtyTerminalReplayLimitKb(64)).toBe(
      module.MIN_PTY_TERMINAL_REPLAY_LIMIT_KB,
    );
    expect(storage[module.PTY_TERMINAL_REPLAY_LIMIT_KB_STORAGE_KEY]).toBe('128');
    expect(listener).toHaveBeenLastCalledWith(128);
    expect(module.resolvePtyTerminalScrollbackLines(256)).toBeGreaterThan(1000);

    unsubscribe();
  });

  it('reads runtime-backed timeout before localStorage mirror（优先读取 Runtime 中的等待输入超时）', async () => {
    storage['exomind:ptyWaitingInputIdleTimeoutSeconds'] = '18';
    storage['exomind:ptyTerminalReplayLimitKb'] = '512';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:ptyWaitingInputIdleTimeoutSeconds': '42',
      'exomind:ptyTerminalReplayLimitKb': '768',
    });

    const module = await import('@/config/pty-terminal-preferences');

    expect(module.getPtyWaitingInputIdleTimeoutSeconds()).toBe(42);
    expect(module.getPtyTerminalReplayLimitKb()).toBe(768);
  });

  it('persists timeout through runtime config transport and keeps local mirror（等待输入超时写入 Runtime 并保留本地镜像）', async () => {
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        key: 'exomind:ptyWaitingInputIdleTimeoutSeconds',
        value: '45',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
      authSecret: 'secret-123',
    });

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    const module = await import('@/config/pty-terminal-preferences');

    expect(module.setPtyWaitingInputIdleTimeoutSeconds(45)).toBe(45);
    await flushMicrotasks();

    expect(storage[module.PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS_STORAGE_KEY]).toBe('45');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/config/exomind%3AptyWaitingInputIdleTimeoutSeconds');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT');
  });

  it('persists replay limit through runtime config transport and keeps local mirror（历史回放上限写入 Runtime 并保留本地镜像）', async () => {
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        key: 'exomind:ptyTerminalReplayLimitKb',
        value: '384',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
      authSecret: 'secret-123',
    });

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    const module = await import('@/config/pty-terminal-preferences');

    expect(module.setPtyTerminalReplayLimitKb(384)).toBe(384);
    await flushMicrotasks();

    expect(storage[module.PTY_TERMINAL_REPLAY_LIMIT_KB_STORAGE_KEY]).toBe('384');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/config/exomind%3AptyTerminalReplayLimitKb');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT');
  });
});
