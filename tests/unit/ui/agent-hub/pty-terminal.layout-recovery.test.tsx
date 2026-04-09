import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyTerminal } from '@/ui/app/components/PtyTerminal';
import { __resetPtyInputTransportPoolForTests } from '@/ui/app/components/pty-input';

const xtermState = vi.hoisted(() => {
  const constructedOptions: Array<Record<string, unknown>> = [];
  const terminal = {
    rows: 24,
    cols: 80,
    options: {} as Record<string, unknown>,
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    refresh: vi.fn(),
    getSelection: vi.fn(() => ''),
    attachCustomKeyEventHandler: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
  };

  const fitAddon = {
    fit: vi.fn(),
  };

  return { constructedOptions, terminal, fitAddon };
});

const websocketState = vi.hoisted(() => {
  type SocketPlan = {
    autoOpen?: boolean;
    autoReady?: boolean;
    autoCloseAfterOpen?: boolean;
    closeDelayMs?: number;
    readyMessage?: unknown;
  };

  const defaultReadyMessage = () => ({
    type: 'ready' as const,
    protocol_version: 3,
    capabilities: {
      input_ack: true,
      resize: true,
      resize_ack: true,
      output_stream: true,
      output_cursor: true,
    },
  });

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    private readonly plan: SocketPlan;

    constructor(public readonly url: string) {
      this.plan = socketPlans.shift() ?? {};
      instances.push(this);
      setTimeout(() => {
        if (this.readyState !== MockWebSocket.CONNECTING || this.plan.autoOpen === false) {
          return;
        }
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
        if (this.plan.autoReady !== false) {
          this.emitMessage(this.plan.readyMessage ?? readyMessage);
        }
        if (this.plan.autoCloseAfterOpen) {
          setTimeout(() => {
            this.emitClose();
          }, this.plan.closeDelayMs ?? 0);
        }
      }, 0);
    }

    send = vi.fn((payload: string) => {
      this.sent.push(payload);
      const parsed = JSON.parse(payload) as { type?: string; resize_seq?: number };
      if (parsed.type === 'resize' && typeof parsed.resize_seq === 'number') {
        setTimeout(() => {
          this.emitMessage({
            type: 'resize_ack',
            resize_seq: parsed.resize_seq,
          });
        }, resizeAckDelayMs);
      }
    });

    close = vi.fn(() => {
      if (this.readyState === MockWebSocket.CLOSED) {
        return;
      }
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code: 1000, reason: '', wasClean: true } as CloseEvent);
    });

    emitMessage(payload: unknown) {
      this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
    }

    emitClose(code = 1006) {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code, reason: '', wasClean: false } as CloseEvent);
    }
  }

  const instances: MockWebSocket[] = [];
  const socketPlans: SocketPlan[] = [];
  let readyMessage = defaultReadyMessage();
  let resizeAckDelayMs = 0;

  return {
    instances,
    socketPlans,
    defaultReadyMessage,
    get readyMessage() {
      return readyMessage;
    },
    set readyMessage(next: ReturnType<typeof defaultReadyMessage>) {
      readyMessage = next;
    },
    get resizeAckDelayMs() {
      return resizeAckDelayMs;
    },
    set resizeAckDelayMs(next: number) {
      resizeAckDelayMs = next;
    },
    WebSocketCtor: MockWebSocket,
  };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown> = {}) {
      this.options = { ...options };
      xtermState.constructedOptions.push(this.options);
      xtermState.terminal.options = this.options;
    }

    rows = xtermState.terminal.rows;
    cols = xtermState.terminal.cols;
    loadAddon = xtermState.terminal.loadAddon;
    open = xtermState.terminal.open;
    write = xtermState.terminal.write;
    clear = xtermState.terminal.clear;
    reset = xtermState.terminal.reset;
    focus = xtermState.terminal.focus;
    dispose = xtermState.terminal.dispose;
    refresh = xtermState.terminal.refresh;
    getSelection = xtermState.terminal.getSelection;
    attachCustomKeyEventHandler = xtermState.terminal.attachCustomKeyEventHandler;
    onData = xtermState.terminal.onData;
    onResize = xtermState.terminal.onResize;
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = xtermState.fitAddon.fit;
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));

async function flushUi(ms = 0): Promise<void> {
  await act(async () => {
    if (ms > 0) {
      await vi.advanceTimersByTimeAsync(ms);
    }
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PtyTerminal layout recovery（终端布局恢复）', () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let resizeObservers: Array<() => void> = [];
  let sizeReady = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetPtyInputTransportPoolForTests();
    xtermState.constructedOptions.length = 0;
    xtermState.terminal.options = {};
    websocketState.instances.length = 0;
    websocketState.socketPlans.length = 0;
    websocketState.readyMessage = websocketState.defaultReadyMessage();
    websocketState.resizeAckDelayMs = 0;
    resizeObservers = [];
    sizeReady = false;

    vi.stubGlobal('requestAnimationFrame', (((callback: FrameRequestCallback) => setTimeout(() => callback(16), 16)) as unknown as typeof requestAnimationFrame));
    vi.stubGlobal('cancelAnimationFrame', ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame);
    vi.stubGlobal('WebSocket', websocketState.WebSocketCtor as unknown as typeof WebSocket);

    originalResizeObserver = globalThis.ResizeObserver;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly callback: ResizeObserverCallback;

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          resizeObservers.push(() => this.callback([], this as unknown as ResizeObserver));
        }

        observe() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver,
    );

    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return sizeReady ? 960 : 0;
      },
    });

    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return sizeReady ? 540 : 0;
      },
    });
  });

  afterEach(() => {
    __resetPtyInputTransportPoolForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();

    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    }
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  });

  it('waits for measurable layout before opening the output websocket（容器可测量后才连接输出 WS）', async () => {
    render(<PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-1" />);

    await flushUi(60);
    expect(websocketState.instances).toHaveLength(1);

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);

    expect(websocketState.instances).toHaveLength(2);
    expect(websocketState.instances[1]?.url).toContain('/pty/pty-layout-1/ws');
    expect(websocketState.instances[0]?.url).toContain('mode=input');
    expect(websocketState.instances[1]?.url).toContain('mode=output');
    expect(xtermState.fitAddon.fit).toHaveBeenCalled();
    expect(xtermState.terminal.refresh).toHaveBeenCalled();
  });

  it('keeps the output websocket alive after ready beyond the initial timeout window（ready 后不会被初始超时定时器误杀）', async () => {
    render(<PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-timeout-cleared" />);

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);

    const outputSocket = websocketState.instances[1];
    expect(outputSocket).toBeTruthy();

    await flushUi(4_100);

    expect(outputSocket!.close).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pty-terminal-error')).not.toBeInTheDocument();
  });

  it('waits for the resize acknowledgement before opening the output websocket（会在 resize 确认后才连接输出 WS）', async () => {
    websocketState.resizeAckDelayMs = 200;

    render(<PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-resize-ack" />);

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(websocketState.instances).toHaveLength(1);

    await flushUi(220);
    expect(websocketState.instances).toHaveLength(2);
  });

  it('retries initial output websocket failures before reporting disconnect（首个输出 WS 失败会先重试再上报断开）', async () => {
    const onInitialConnectionFailure = vi.fn();
    websocketState.socketPlans.push(
      {},
      { autoReady: false, autoCloseAfterOpen: true },
      { autoReady: false, autoCloseAfterOpen: true },
      { autoReady: false, autoCloseAfterOpen: true },
    );

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-2"
        onInitialConnectionFailure={onInitialConnectionFailure}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(onInitialConnectionFailure).not.toHaveBeenCalled();

    await flushUi(250);
    expect(onInitialConnectionFailure).not.toHaveBeenCalled();

    await flushUi(250);
    expect(onInitialConnectionFailure).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pty-terminal-error')).toBeInTheDocument();
  });

  it('fails fast when the initial output websocket times out（初始输出 WS 超时时应退出加载态并上报失败）', async () => {
    const onInitialConnectionFailure = vi.fn();
    websocketState.socketPlans.push({}, { autoOpen: false });

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-timeout"
        onInitialConnectionFailure={onInitialConnectionFailure}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(screen.getByTestId('pty-terminal-loading')).toBeInTheDocument();

    await flushUi(4_100);
    expect(onInitialConnectionFailure).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pty-terminal-error')).toHaveTextContent('响应超时');
  });

  it('fails fast when the initial output websocket reports a fatal error before ready（首个输出 WS 在 ready 前返回致命错误时应直接阻断）', async () => {
    const onInitialConnectionFailure = vi.fn();
    websocketState.socketPlans.push({}, { autoReady: false });

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-fatal-before-ready"
        onInitialConnectionFailure={onInitialConnectionFailure}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(websocketState.instances).toHaveLength(2);

    act(() => {
      websocketState.instances[1]!.emitMessage({
        type: 'error',
        code: 'not_found',
        message: 'missing pty',
      });
    });
    await flushUi();

    expect(onInitialConnectionFailure).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pty-terminal-error')).toHaveTextContent('当前 PTY 不存在');

    await flushUi(600);
    expect(websocketState.instances).toHaveLength(2);
  });

  it('falls back to connecting without a measurable layout so loading cannot hang forever（布局长期不可测时也不能无限卡在加载中）', async () => {
    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-no-measure-timeout"
      />,
    );

    await flushUi(1_300);
    expect(websocketState.instances).toHaveLength(2);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();
  });

  it('does not recreate the output websocket when only the failure callback identity changes（仅失败回调变更时不应重建输出 WS）', async () => {
    const { rerender } = render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-stable-callback"
        onInitialConnectionFailure={() => {}}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);
    expect(websocketState.instances).toHaveLength(2);

    rerender(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-stable-callback"
        onInitialConnectionFailure={() => {}}
      />,
    );
    await flushUi(60);
    expect(websocketState.instances).toHaveLength(2);
  });

  it('shows the non-zero exit code in the EOF banner（非零退出码会显示在退出提示中）', async () => {
    render(<PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-exit-code" />);

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);

    const outputSocket = websocketState.instances[1];
    expect(outputSocket).toBeTruthy();
    act(() => {
      outputSocket!.emitMessage({
        type: 'eof',
        offset: 0,
        code: 23,
      });
    });
    await flushUi();

    expect(xtermState.terminal.write).toHaveBeenCalledWith(
      '\r\n\x1b[90m[Process exited with code 23]\x1b[0m\r\n',
    );
  });

  it('keeps the generic EOF banner for zero or unknown exit code（零或未知退出码保持通用提示）', async () => {
    const { rerender } = render(
      <PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-exit-code-default-a" />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);

    act(() => {
      websocketState.instances[1]!.emitMessage({ type: 'eof', offset: 0, code: 0 });
    });
    await flushUi();

    rerender(
      <PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-exit-code-default-b" />,
    );
    await flushUi(80);
    act(() => {
      websocketState.instances[3]!.emitMessage({ type: 'eof', offset: 0, code: null });
    });
    await flushUi();

    expect(xtermState.terminal.write).toHaveBeenNthCalledWith(
      1,
      '\r\n\x1b[90m[Process exited]\x1b[0m\r\n',
    );
    expect(xtermState.terminal.write).toHaveBeenNthCalledWith(
      2,
      '\r\n\x1b[90m[Process exited]\x1b[0m\r\n',
    );
  });

  it('does not re-show the loading overlay while reconnecting after a successful first connect（首次连通后重连不应重新盖回加载层）', async () => {
    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-reconnect-loading"
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();

    act(() => {
      websocketState.instances[1]!.emitClose();
    });
    await flushUi(40);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();
  });

  it('does not escalate a failed reconnect into the initial failure overlay（重连失败不应被误判成首次加载失败）', async () => {
    const onInitialConnectionFailure = vi.fn();
    websocketState.socketPlans.push({}, {}, { autoReady: false, autoCloseAfterOpen: true }, {});

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-reconnect-pre-ready-failure"
        onInitialConnectionFailure={onInitialConnectionFailure}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);
    expect(screen.queryByTestId('pty-terminal-error')).not.toBeInTheDocument();

    act(() => {
      websocketState.instances[1]!.emitClose();
    });
    await flushUi(40);
    await flushUi(600);

    expect(screen.queryByTestId('pty-terminal-error')).not.toBeInTheDocument();
    expect(onInitialConnectionFailure).not.toHaveBeenCalled();
    expect(websocketState.instances.length).toBeGreaterThanOrEqual(3);
  });

  it('updates scrollback in place without recreating the terminal（历史回放上限变更时原位更新而不重建终端）', async () => {
    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-scrollback-update"
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(80);
    expect(websocketState.instances).toHaveLength(2);

    const preferences = await import('@/config/pty-terminal-preferences');
    const previousReplayLimitKb = preferences.getPtyTerminalReplayLimitKb();
    const nextReplayLimitKb = previousReplayLimitKb + 128;

    try {
      await act(async () => {
        preferences.setPtyTerminalReplayLimitKb(nextReplayLimitKb);
      });

      expect(xtermState.terminal.options.scrollback).toBe(
        preferences.resolvePtyTerminalScrollbackLines(nextReplayLimitKb),
      );
      expect(websocketState.instances).toHaveLength(2);
    } finally {
      await act(async () => {
        preferences.setPtyTerminalReplayLimitKb(previousReplayLimitKb);
      });
    }
  });

  it('does not enforce a fixed 200px minimum height on the terminal surface（终端表面不再强制固定最小高度）', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/ui/app/components/PtyTerminal.tsx'),
      'utf8',
    );

    expect(source).not.toContain('min-h-[200px]');
    expect(source).toContain('className="relative h-full w-full min-h-0"');
  });
});
