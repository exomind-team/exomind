import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PtyTerminal } from '@/ui/app/components/PtyTerminal';

const xtermState = vi.hoisted(() => {
  const terminal = {
    rows: 24,
    cols: 80,
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
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

  return { terminal, fitAddon };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rows = xtermState.terminal.rows;

    cols = xtermState.terminal.cols;

    loadAddon = xtermState.terminal.loadAddon;

    open = xtermState.terminal.open;

    write = xtermState.terminal.write;

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

class MockEventSource {
  static instances: MockEventSource[] = [];

  close = vi.fn();

  addEventListener = vi.fn();

  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;

  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;

  constructor(_url: string) {
    MockEventSource.instances.push(this);
  }
}

describe('PtyTerminal layout recovery（终端布局恢复）', () => {
  let originalEventSource: typeof EventSource | undefined;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let eventSourceConstructor: ReturnType<typeof vi.fn>;
  let resizeObservers: Array<() => void> = [];
  let sizeReady = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sizeReady = false;
    resizeObservers = [];
    MockEventSource.instances = [];

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204 })));

    originalEventSource = globalThis.EventSource;
    eventSourceConstructor = vi.fn();
    class EventSourceSpy extends MockEventSource {
      constructor(url: string) {
        super(url);
        eventSourceConstructor(url);
      }
    }
    vi.stubGlobal('EventSource', EventSourceSpy as unknown as typeof EventSource);

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
    vi.useRealTimers();
    vi.unstubAllGlobals();

    if (originalEventSource) {
      globalThis.EventSource = originalEventSource;
    }
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

  it('waits for measurable layout before connecting SSE（容器可测量后才连接 SSE）', async () => {
    render(<PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-1" />);

    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(60);

    expect(eventSourceConstructor).not.toHaveBeenCalled();

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(60);

    expect(xtermState.fitAddon.fit).toHaveBeenCalled();
    expect(xtermState.terminal.refresh).toHaveBeenCalled();
    expect(eventSourceConstructor).toHaveBeenCalledWith('http://127.0.0.1:1949/pty/pty-layout-1/stream');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/pty/pty-layout-1/resize',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports initial stream failure before the first successful connection（首个 SSE 连接失败时上报断开）', async () => {
    const onInitialConnectionFailure = vi.fn();

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-2"
        onInitialConnectionFailure={onInitialConnectionFailure}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(60);

    expect(MockEventSource.instances).toHaveLength(1);
    MockEventSource.instances[0]?.onerror?.call({} as EventSource, new Event('error'));

    expect(onInitialConnectionFailure).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances[0]?.close).toHaveBeenCalledTimes(1);
  });
});
