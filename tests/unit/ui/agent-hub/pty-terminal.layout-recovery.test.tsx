import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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

function createSseResponse(...frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

function createOpenSseResponse(): Response {
  return new Response(
    new ReadableStream({
      start() {},
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

function createStreamFrame(eventType: string, data: string): string {
  return `event: ${eventType}\ndata: ${data}\n\n`;
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

describe('PtyTerminal layout recovery（终端布局恢复）', () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  let resizeObservers: Array<() => void> = [];
  let sizeReady = false;
  let streamPlans: Array<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sizeReady = false;
    resizeObservers = [];
    streamPlans = [];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/stream')) {
        const nextPlan = streamPlans.shift();
        if (!nextPlan) {
          throw new Error(`missing stream plan for ${url}`);
        }
        return nextPlan(input, init);
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

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
    streamPlans.push(() => createSseResponse(createStreamFrame('eof', JSON.stringify({ code: 0 }))));

    render(<PtyTerminal rtBaseUrl="http://127.0.0.1:1949" ptyId="pty-layout-1" />);

    await flushUi(60);

    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://127.0.0.1:1949/pty/pty-layout-1/stream',
      expect.anything(),
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();

    expect(xtermState.fitAddon.fit).toHaveBeenCalled();
    expect(xtermState.terminal.refresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/pty/pty-layout-1/stream',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/pty/pty-layout-1/resize',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('retries initial stream failures before reporting disconnect（首个 SSE 失败会先重试再上报断开）', async () => {
    const onInitialConnectionFailure = vi.fn();
    streamPlans.push(
      () => Promise.reject(new Error('stream offline 1')),
      () => Promise.reject(new Error('stream offline 2')),
      () => Promise.reject(new Error('stream offline 3')),
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
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/pty/pty-layout-2/stream',
      expect.anything(),
    );
  });

  it('does not report disconnect when a retry connects successfully（重试成功后不再上报断开）', async () => {
    const onInitialConnectionFailure = vi.fn();
    streamPlans.push(
      () => Promise.reject(new Error('stream offline once')),
      () => createSseResponse(createStreamFrame('eof', JSON.stringify({ code: 0 }))),
    );

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-3"
        onInitialConnectionFailure={onInitialConnectionFailure}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);

    await flushUi(250);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();

    expect(onInitialConnectionFailure).not.toHaveBeenCalled();
  });

  it('fails fast when the initial stream request times out（初始流请求超时时应退出加载态并上报失败）', async () => {
    const onInitialConnectionFailure = vi.fn();
    streamPlans.push((_input, init) => (
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    ));

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
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('pty-terminal-error')).toHaveTextContent(
      '会话加载失败：RT 响应超时',
    );
  });

  it('does not recreate the PTY stream when only the failure callback identity changes（仅失败回调变更时不应重建 PTY 流）', async () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    streamPlans.push(() => createSseResponse(createStreamFrame('eof', JSON.stringify({ code: 0 }))));

    const { rerender } = render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-stable-callback"
        onInitialConnectionFailure={firstCallback}
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();

    const initialStreamCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/stream'));
    expect(initialStreamCalls).toHaveLength(1);

    rerender(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-stable-callback"
        onInitialConnectionFailure={secondCallback}
      />,
    );

    await flushUi(60);

    const rerenderedStreamCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/stream'));
    expect(rerenderedStreamCalls).toHaveLength(1);

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it('shows the non-zero exit code in the EOF banner（非零退出码会显示在退出提示中）', async () => {
    streamPlans.push(() => createSseResponse(createStreamFrame('eof', JSON.stringify({ code: 1 }))));

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-exit-code"
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(xtermState.terminal.write).toHaveBeenCalled();

    expect(xtermState.terminal.write).toHaveBeenCalledWith(
      '\r\n\x1b[90m[Process exited with code 1]\x1b[0m\r\n',
    );
  });

  it('keeps the generic EOF banner for zero or unknown exit code（零或未知退出码保持通用提示）', async () => {
    streamPlans.push(() => createSseResponse(
      createStreamFrame('eof', JSON.stringify({ code: 0 })),
      createStreamFrame('eof', ''),
    ));

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-exit-code-default"
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(xtermState.terminal.write).toHaveBeenCalledTimes(2);

    expect(xtermState.terminal.write).toHaveBeenNthCalledWith(
      1,
      '\r\n\x1b[90m[Process exited]\x1b[0m\r\n',
    );
    expect(xtermState.terminal.write).toHaveBeenNthCalledWith(
      2,
      '\r\n\x1b[90m[Process exited]\x1b[0m\r\n',
    );
  });

  it('hides the loading overlay after the fetch stream connects（fetch 流连通后会退出加载态）', async () => {
    streamPlans.push(() => createSseResponse(createStreamFrame('eof', JSON.stringify({ code: 0 }))));

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-loading-ready"
      />,
    );

    expect(screen.getByTestId('pty-terminal-loading')).toBeInTheDocument();

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();
  });

  it('does not re-show the loading overlay while reconnecting after a successful first connect（首次连通后重连不应重新盖回加载层）', async () => {
    streamPlans.push(
      () => createSseResponse(),
      () => createOpenSseResponse(),
    );

    render(
      <PtyTerminal
        rtBaseUrl="http://127.0.0.1:1949"
        ptyId="pty-layout-reconnect-loading"
      />,
    );

    sizeReady = true;
    resizeObservers.forEach((notify) => notify());
    await flushUi(60);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();

    await flushUi(500);
    expect(screen.queryByTestId('pty-terminal-loading')).not.toBeInTheDocument();
  });
});
