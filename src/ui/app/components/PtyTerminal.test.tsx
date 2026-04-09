import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyTerminal } from './PtyTerminal';
import { __resetPtyInputTransportPoolForTests } from './pty-input';

const hoisted = vi.hoisted(() => {
  const defaultReadyMessage = () => ({
    type: 'ready' as const,
    protocol_version: 2,
    capabilities: {
      input_ack: true,
      resize: true,
      resize_ack: true,
    },
  });

  class MockTerminal {
    rows = 24;
    cols = 80;
    writes: Array<string | Uint8Array> = [];
    options: Record<string, unknown> = {};
    private onDataHandler: ((data: string) => void) | null = null;
    private onResizeHandler: ((size: { rows: number; cols: number }) => void) | null = null;

    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    refresh = vi.fn();
    dispose = vi.fn();
    getSelection = vi.fn(() => '');
    attachCustomKeyEventHandler = vi.fn(() => true);
    write = vi.fn((data: string | Uint8Array) => {
      this.writes.push(data);
    });

    onData(handler: (data: string) => void) {
      this.onDataHandler = handler;
      return { dispose: vi.fn() };
    }

    onResize(handler: (size: { rows: number; cols: number }) => void) {
      this.onResizeHandler = handler;
      return { dispose: vi.fn() };
    }

    emitData(data: string) {
      this.onDataHandler?.(data);
    }

    emitResize(rows: number, cols: number) {
      this.rows = rows;
      this.cols = cols;
      this.onResizeHandler?.({ rows, cols });
    }
  }

  class MockResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    trigger(target?: Element) {
      this.callback([], (target ?? this) as unknown as ResizeObserver);
    }
  }

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

    constructor(public readonly url: string) {
      websocketInstances.push(this);
      setTimeout(() => {
        if (this.readyState !== MockWebSocket.CONNECTING) {
          return;
        }
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
        this.emitMessage(readyMessage);
      }, 0);
    }

    send = vi.fn((payload: string) => {
      this.sent.push(payload);
      const parsed = JSON.parse(payload) as {
        type?: string;
        input_seq?: number;
        resize_seq?: number;
      };
      if (autoAckInput && parsed.type === 'input' && typeof parsed.input_seq === 'number') {
        setTimeout(() => {
          this.emitMessage({
            type: 'ack',
            input_seq: parsed.input_seq,
          });
        }, 0);
      }
      if (autoAckResize && parsed.type === 'resize' && typeof parsed.resize_seq === 'number') {
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

  const terminalInstances: MockTerminal[] = [];
  const resizeObserverInstances: MockResizeObserver[] = [];
  const websocketInstances: MockWebSocket[] = [];
  let readyMessage = defaultReadyMessage();
  let autoAckInput = true;
  let autoAckResize = true;
  let resizeAckDelayMs = 0;

  class MockTerminalConstructor extends MockTerminal {
    constructor() {
      super();
      terminalInstances.push(this);
    }
  }

  class MockFitAddon {
    fit = vi.fn();
  }

  class MockWebLinksAddon {}

  class MockResizeObserverConstructor extends MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      resizeObserverInstances.push(this);
    }
  }

  return {
    terminalInstances,
    resizeObserverInstances,
    websocketInstances,
    defaultReadyMessage,
    get readyMessage() {
      return readyMessage;
    },
    set readyMessage(next: ReturnType<typeof defaultReadyMessage>) {
      readyMessage = next;
    },
    get autoAckInput() {
      return autoAckInput;
    },
    set autoAckInput(next: boolean) {
      autoAckInput = next;
    },
    get autoAckResize() {
      return autoAckResize;
    },
    set autoAckResize(next: boolean) {
      autoAckResize = next;
    },
    get resizeAckDelayMs() {
      return resizeAckDelayMs;
    },
    set resizeAckDelayMs(next: number) {
      resizeAckDelayMs = next;
    },
    TerminalCtor: MockTerminalConstructor,
    FitAddonCtor: MockFitAddon,
    WebLinksAddonCtor: MockWebLinksAddon,
    ResizeObserverCtor: MockResizeObserverConstructor,
    WebSocketCtor: MockWebSocket,
  };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: hoisted.TerminalCtor,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: hoisted.FitAddonCtor,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: hoisted.WebLinksAddonCtor,
}));

class MockStreamReader {
  private queuedResults: ReadableStreamReadResult<Uint8Array>[] = [];
  private pendingResolvers: Array<
    (result: ReadableStreamReadResult<Uint8Array>) => void
  > = [];

  read = vi.fn(() => {
    if (this.queuedResults.length > 0) {
      return Promise.resolve(this.queuedResults.shift()!);
    }
    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
      this.pendingResolvers.push(resolve);
    });
  });

  releaseLock = vi.fn();

  pushText(text: string) {
    this.enqueue({
      done: false,
      value: new TextEncoder().encode(text),
    });
  }

  close() {
    this.enqueue({
      done: true,
      value: undefined,
    });
  }

  private enqueue(result: ReadableStreamReadResult<Uint8Array>) {
    const resolver = this.pendingResolvers.shift();
    if (resolver) {
      resolver(result);
      return;
    }
    this.queuedResults.push(result);
  }
}

function withElementClientSize(width: number, height: number) {
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return width;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return height;
    },
  });

  return () => {
    if (widthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }

    if (heightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  };
}

async function flushUi(ms = 0): Promise<void> {
  await act(async () => {
    if (ms > 0) {
      await vi.advanceTimersByTimeAsync(ms);
    }
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function settleInteractiveStartup(): Promise<void> {
  const observer = hoisted.resizeObserverInstances[hoisted.resizeObserverInstances.length - 1];
  expect(observer).toBeTruthy();

  act(() => {
    observer!.trigger();
  });

  await flushUi(20);
  await flushUi(20);
  await flushUi(80);
  expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();
}

describe('PtyTerminal', () => {
  let streamReader: MockStreamReader;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetPtyInputTransportPoolForTests();
    hoisted.terminalInstances.length = 0;
    hoisted.resizeObserverInstances.length = 0;
    hoisted.websocketInstances.length = 0;
    hoisted.readyMessage = hoisted.defaultReadyMessage();
    hoisted.autoAckInput = true;
    hoisted.autoAckResize = true;
    hoisted.resizeAckDelayMs = 0;
    streamReader = new MockStreamReader();

    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/stream')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          body: {
            getReader: () => streamReader,
            cancel: vi.fn(),
          },
        } as unknown as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 204,
      } as unknown as Response);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'requestAnimationFrame',
      (((callback: FrameRequestCallback) => setTimeout(() => callback(16), 16)) as unknown as typeof requestAnimationFrame),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame,
    );
    vi.stubGlobal(
      'ResizeObserver',
      hoisted.ResizeObserverCtor as unknown as typeof ResizeObserver,
    );
    vi.stubGlobal(
      'WebSocket',
      hoisted.WebSocketCtor as unknown as typeof WebSocket,
    );
  });

  afterEach(() => {
    __resetPtyInputTransportPoolForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('batches rapid terminal input into a single WS frame（快速输入应合并成一次 WS 输入）', async () => {
    const restoreClientSize = withElementClientSize(960, 640);
    const view = render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:4317"
        ptyId="pty-fast-input"
        interactive
      />,
    );

    await settleInteractiveStartup();

    const terminal = hoisted.terminalInstances[hoisted.terminalInstances.length - 1];
    const websocket = hoisted.websocketInstances[hoisted.websocketInstances.length - 1];
    expect(terminal).toBeTruthy();
    expect(websocket).toBeTruthy();

    act(() => {
      terminal!.emitData('h');
      terminal!.emitData('i');
    });
    await flushUi();

    const framesBeforeFlush = websocket!.sent
      .map((frame) => JSON.parse(frame) as { type?: string })
      .filter((frame) => frame.type === 'input');
    expect(framesBeforeFlush).toEqual([]);

    await flushUi(20);

    const inputFrames = websocket!.sent
      .map((frame) => JSON.parse(frame) as { type?: string; data?: string })
      .filter((frame) => frame.type === 'input');
    expect(inputFrames).toHaveLength(1);
    expect(atob(inputFrames[0]!.data ?? '')).toBe('hi');

    act(() => {
      view.unmount();
    });
    restoreClientSize();
  });

  it('batches rapid PTY output writes before touching xterm（快速输出应先合批再写入 xterm）', async () => {
    const restoreClientSize = withElementClientSize(960, 640);
    const view = render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:4317"
        ptyId="pty-fast-output"
        interactive
      />,
    );

    const terminal = hoisted.terminalInstances[hoisted.terminalInstances.length - 1];
    expect(terminal).toBeTruthy();
    await settleInteractiveStartup();

    act(() => {
      streamReader.pushText(
        `event: output\ndata: ${btoa('hello')}\n\n`
          + `event: output\ndata: ${btoa(' world')}\n\n`,
      );
    });
    await flushUi();

    expect(terminal!.writes).toHaveLength(0);

    await flushUi(20);

    expect(terminal!.writes).toHaveLength(1);
    const merged = terminal!.writes[0];
    const text = typeof merged === 'string' ? merged : new TextDecoder().decode(merged);
    expect(text).toBe('hello world');

    act(() => {
      view.unmount();
    });
    restoreClientSize();
  });

  it('shows explicit input transport error and allows manual retry（输入 WS 失败后显示错误并允许手动重试）', async () => {
    const restoreClientSize = withElementClientSize(960, 640);
    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:4317"
        ptyId="pty-input-error"
        interactive
      />,
    );

    await settleInteractiveStartup();

    const firstSocket = hoisted.websocketInstances[0];
    expect(firstSocket).toBeTruthy();

    act(() => {
      firstSocket!.emitClose();
    });
    await flushUi();

    expect(screen.getByTestId('pty-terminal-input-error')).toHaveTextContent(
      '终端输入通道已断开',
    );

    act(() => {
      fireEvent.click(screen.getByTestId('pty-terminal-input-retry'));
    });
    await flushUi(20);

    expect(hoisted.websocketInstances).toHaveLength(2);
    expect(screen.queryByTestId('pty-terminal-input-error')).not.toBeInTheDocument();
    restoreClientSize();
  });

  it('blocks the input transport when the runtime reports an incompatible WS protocol（协议不兼容时进入显式错误态）', async () => {
    const restoreClientSize = withElementClientSize(960, 640);
    hoisted.readyMessage = {
      type: 'ready',
      protocol_version: 1,
      capabilities: {
        input_ack: true,
        resize: true,
        resize_ack: false,
      },
    };

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:4317"
        ptyId="pty-protocol-mismatch"
        interactive
      />,
    );

    await settleInteractiveStartup();

    expect(screen.getByTestId('pty-terminal-input-error')).toHaveTextContent(
      '协议版本不兼容',
    );
    restoreClientSize();
  });

  it('promotes fatal server-side input errors into the explicit read-only transport state（服务端写入失败会进入显式只读态）', async () => {
    const restoreClientSize = withElementClientSize(960, 640);
    hoisted.autoAckInput = false;

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:4317"
        ptyId="pty-input-fatal-error"
        interactive
      />,
    );

    await settleInteractiveStartup();

    const terminal = hoisted.terminalInstances[hoisted.terminalInstances.length - 1];
    const websocket = hoisted.websocketInstances[hoisted.websocketInstances.length - 1];
    expect(terminal).toBeTruthy();
    expect(websocket).toBeTruthy();

    act(() => {
      terminal!.emitData('x');
    });
    await flushUi(20);

    act(() => {
      websocket!.emitMessage({
        type: 'error',
        code: 'transport_error',
        message: 'write failed',
        input_seq: 1,
      });
    });
    await flushUi();

    expect(screen.getByTestId('pty-terminal-input-error')).toHaveTextContent('write failed');
    restoreClientSize();
  });

  it('keeps read-only terminals off the PTY input websocket（只读终端不建立输入 WS）', async () => {
    const restoreClientSize = withElementClientSize(960, 640);
    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:4317"
        ptyId="pty-read-only"
        interactive={false}
      />,
    );

    const observer = hoisted.resizeObserverInstances[hoisted.resizeObserverInstances.length - 1];
    act(() => {
      observer!.trigger();
    });
    await flushUi(80);

    expect(hoisted.websocketInstances).toHaveLength(0);
    expect(screen.queryByTestId('pty-terminal-input-error')).not.toBeInTheDocument();
    restoreClientSize();
  });
});
