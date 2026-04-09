import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyTerminal } from './PtyTerminal';

const hoisted = vi.hoisted(() => {
  class MockTerminal {
    rows = 24;
    cols = 80;
    writes: Array<string | Uint8Array> = [];
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

  const terminalInstances: MockTerminal[] = [];
  const resizeObserverInstances: MockResizeObserver[] = [];

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
    TerminalCtor: MockTerminalConstructor,
    FitAddonCtor: MockFitAddon,
    WebLinksAddonCtor: MockWebLinksAddon,
    ResizeObserverCtor: MockResizeObserverConstructor,
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

function getInputRequestBodies(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).includes('/input'))
    .map(([, init]) => {
      const rawBody = (init as RequestInit | undefined)?.body;
      const body = typeof rawBody === 'string' ? JSON.parse(rawBody) as { data: string } : null;
      return body?.data ?? '';
    });
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

describe('PtyTerminal', () => {
  let streamReader: MockStreamReader;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    hoisted.terminalInstances.length = 0;
    hoisted.resizeObserverInstances.length = 0;
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('batches rapid terminal input into a single PTY request（快速输入应合并成一次 PTY 请求）', () => {
    const view = render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:4317"
        ptyId="pty-fast-input"
        interactive
      />,
    );

    const terminal = hoisted.terminalInstances[hoisted.terminalInstances.length - 1];
    expect(terminal).toBeTruthy();

    act(() => {
      terminal!.emitData('h');
      terminal!.emitData('i');
    });

    expect(getInputRequestBodies(fetchMock)).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(getInputRequestBodies(fetchMock)).toHaveLength(1);
    expect(atob(getInputRequestBodies(fetchMock)[0]!)).toBe('hi');

    act(() => {
      view.unmount();
    });
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
    const observer = hoisted.resizeObserverInstances[hoisted.resizeObserverInstances.length - 1];
    expect(terminal).toBeTruthy();
    expect(observer).toBeTruthy();

    act(() => {
      observer!.trigger();
      vi.advanceTimersByTime(80);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      streamReader.pushText(
        `event: output\ndata: ${btoa('hello')}\n\n`
          + `event: output\ndata: ${btoa(' world')}\n\n`,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(terminal!.writes).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(terminal!.writes).toHaveLength(1);
    const merged = terminal!.writes[0];
    const text = typeof merged === 'string' ? merged : new TextDecoder().decode(merged);
    expect(text).toBe('hello world');

    act(() => {
      view.unmount();
    });
    restoreClientSize();
  });
});
