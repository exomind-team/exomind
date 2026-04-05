#!/usr/bin/env bun

type BridgeResponse<T = unknown> = {
  id: string;
  success: boolean;
  data?: T;
  error?: string | null;
  windowContext?: {
    windowLabel?: string;
    totalWindows?: number;
    warning?: string | null;
  };
};

type VerifySummary = {
  route: string;
  anchorId: string;
  anchorText: string | null;
  maxTouchPoints: number;
  logs: string[];
  snapshots: Array<{
    label: string;
    nodeCount: number;
    edgeCount: number;
    edgePathCount: number;
    focusedAnchorBadge: boolean;
    anchorRect: { x: number; y: number; width: number; height: number } | null;
  }>;
  manualLayout: unknown;
};

type CliOptions = {
  host: string;
  port: number;
  route: string;
  windowLabel: string;
  anchorId: string | null;
  anchorText: string;
  moveSteps: number;
  stepDx: number;
  stepDy: number;
  stepDelayMs: number;
  settleDelayMs: number;
};

const DEFAULT_OPTIONS: CliOptions = {
  host: "127.0.0.1",
  port: 9223,
  route: "/tasks/dag",
  windowLabel: "main",
  anchorId: null,
  anchorText: "外心 着手开发网络架构",
  moveSteps: 6,
  stepDx: 18,
  stepDy: 4,
  stepDelayMs: 140,
  settleDelayMs: 180,
};

function parseArgs(argv: string[]): CliOptions {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current.startsWith("--")) {
      continue;
    }

    switch (current) {
      case "--host":
        if (next) {
          options.host = next;
          index += 1;
        }
        break;
      case "--port":
        if (next) {
          options.port = Number(next);
          index += 1;
        }
        break;
      case "--route":
        if (next) {
          options.route = next;
          index += 1;
        }
        break;
      case "--window-label":
        if (next) {
          options.windowLabel = next;
          index += 1;
        }
        break;
      case "--anchor-id":
        if (next) {
          options.anchorId = next;
          index += 1;
        }
        break;
      case "--anchor-text":
        if (next) {
          options.anchorText = next;
          index += 1;
        }
        break;
      case "--move-steps":
        if (next) {
          options.moveSteps = Number(next);
          index += 1;
        }
        break;
      case "--step-dx":
        if (next) {
          options.stepDx = Number(next);
          index += 1;
        }
        break;
      case "--step-dy":
        if (next) {
          options.stepDy = Number(next);
          index += 1;
        }
        break;
      case "--step-delay-ms":
        if (next) {
          options.stepDelayMs = Number(next);
          index += 1;
        }
        break;
      case "--settle-delay-ms":
        if (next) {
          options.settleDelayMs = Number(next);
          index += 1;
        }
        break;
      default:
        break;
    }
  }

  return options;
}

class BridgeClient {
  private socket: WebSocket;

  private counter = 0;

  private pending = new Map<string, {
    resolve: (value: BridgeResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private opened: Promise<void>;

  constructor(private readonly url: string) {
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error(`WebSocket failed: ${url}`)), { once: true });
    });

    this.socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as BridgeResponse;
      const pending = response.id ? this.pending.get(response.id) : undefined;
      if (!pending) {
        return;
      }
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.success) {
        pending.resolve(response);
        return;
      }
      pending.reject(new Error(response.error ?? "Bridge command failed"));
    });

    this.socket.addEventListener("close", () => {
      for (const [id, pending] of this.pending.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Bridge socket closed before response: ${id}`));
      }
      this.pending.clear();
    });
  }

  async ready(): Promise<void> {
    await this.opened;
  }

  async request<T = unknown>(
    command: string,
    args: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<BridgeResponse<T>> {
    await this.ready();
    const id = `req-${++this.counter}`;
    const payload = JSON.stringify({ id, command, args });

    return new Promise<BridgeResponse<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge timeout for ${command}`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolve as (value: BridgeResponse) => void, reject, timer });
      this.socket.send(payload);
    });
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Ignore close errors.
    }
  }
}

function assertVerification(summary: VerifySummary): void {
  if (summary.maxTouchPoints <= 0) {
    throw new Error("Touch-capable environment was not detected");
  }

  if (!summary.logs.some((line) => line.includes("manual-layout:touch-pointerdown"))) {
    throw new Error("Touch pointerdown path was not triggered");
  }

  if (!summary.logs.some((line) => line.includes("focus-hard:drag-session-start"))) {
    throw new Error("Hard-focus drag session did not start");
  }

  if (!summary.logs.some((line) => line.includes("focus-hard:drag-session-end"))) {
    throw new Error("Hard-focus drag session did not end");
  }

  if (summary.logs.some((line) => line.includes("focus-hard:drag-session-anomaly"))) {
    throw new Error("Detected focus-hard drag anomaly during verification");
  }

  if (summary.snapshots.some((snapshot) => snapshot.nodeCount <= 0)) {
    throw new Error("Node DOM count dropped to zero during drag");
  }

  if (summary.snapshots.some((snapshot) => snapshot.edgePathCount <= 0)) {
    throw new Error("Edge path count dropped to zero during drag");
  }

  const firstRect = summary.snapshots[0]?.anchorRect;
  const lastRect = summary.snapshots.at(-1)?.anchorRect;
  if (!firstRect || !lastRect) {
    throw new Error("Missing anchor rect snapshots");
  }

  if (firstRect.x === lastRect.x && firstRect.y === lastRect.y) {
    throw new Error("Anchor node did not move during drag");
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new BridgeClient(`ws://${options.host}:${options.port}`);

  try {
    await client.ready();

    await client.request("execute_js", {
      windowLabel: options.windowLabel,
      script: `(() => {
        if (location.pathname !== ${JSON.stringify(options.route)}) {
          location.assign(${JSON.stringify(options.route)});
        }
        return { href: location.href };
      })()`,
    });

    await Bun.sleep(2500);

    const anchorLookup = await client.request<{
      href: string;
      anchorId: string | null;
      anchorText: string | null;
      nodeCount: number;
    }>("execute_js", {
      windowLabel: options.windowLabel,
      script: `(() => {
        const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
        const byId = ${options.anchorId ? `document.querySelector('.react-flow__node[data-id="${options.anchorId}"]')` : "null"};
        const byText = nodes.find((node) => (node.textContent || '').includes(${JSON.stringify(options.anchorText)})) || null;
        const target = byId || byText;
        return {
          href: location.href,
          nodeCount: nodes.length,
          anchorId: target?.getAttribute('data-id') || null,
          anchorText: target?.textContent?.trim() || null,
        };
      })()`,
    });

    const resolvedAnchorId = anchorLookup.data?.anchorId;
    if (!resolvedAnchorId) {
      throw new Error(`Unable to resolve anchor node for route ${options.route}`);
    }

    await client.request("execute_js", {
      windowLabel: options.windowLabel,
      script: `(() => {
        const dispatchStorage = (key, value) => {
          localStorage.setItem(key, value);
          window.dispatchEvent(new StorageEvent('storage', {
            key,
            newValue: value,
            storageArea: localStorage,
            url: location.href,
          }));
        };
        dispatchStorage('exomind:dag-layout-mode', 'manual');
        dispatchStorage('exomind:dag-focus-mode', 'hard');
        dispatchStorage('exomind:dag-focused-series', JSON.stringify([${JSON.stringify(resolvedAnchorId)}]));
        return {
          layoutMode: localStorage.getItem('exomind:dag-layout-mode'),
          focusMode: localStorage.getItem('exomind:dag-focus-mode'),
          focusedSeries: localStorage.getItem('exomind:dag-focused-series'),
        };
      })()`,
    });

    await Bun.sleep(1500);

    const verification = await client.request<VerifySummary>("execute_js", {
      windowLabel: options.windowLabel,
      script: `(() => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const anchorId = ${JSON.stringify(resolvedAnchorId)};
        const logs = [];
        const snapshots = [];
        const originalWarn = console.warn;

        console.warn = (...args) => {
          try {
            logs.push(args.map((item) => {
              if (typeof item === 'string') return item;
              try {
                return JSON.stringify(item);
              } catch {
                return String(item);
              }
            }).join(' '));
          } catch {
            // Ignore log capture errors.
          }
          return originalWarn.apply(console, args);
        };

        const takeSnapshot = (label) => {
          const wrapper = document.querySelector('.react-flow__node[data-id="' + anchorId + '"]');
          const rect = wrapper?.getBoundingClientRect?.();
          snapshots.push({
            label,
            nodeCount: document.querySelectorAll('.react-flow__node').length,
            edgeCount: document.querySelectorAll('.react-flow__edge').length,
            edgePathCount: document.querySelectorAll('.react-flow__edge path').length,
            focusedAnchorBadge: Boolean(document.querySelector('[data-testid="task-dag-focus-anchor-badge-' + anchorId + '"]')),
            anchorRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          });
          return { wrapper, rect };
        };

        const makeEvent = (type, x, y) => new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 77,
          pointerType: 'touch',
          isPrimary: true,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : 0.5,
          width: 24,
          height: 24,
        });

        return (async () => {
          const before = takeSnapshot('before');
          if (!before.wrapper || !before.rect) {
            throw new Error('Focused anchor node not found before drag');
          }

          const target = document.querySelector('[data-testid="task-dag-node-' + anchorId + '"]') || before.wrapper;
          const startX = before.rect.x + before.rect.width / 2;
          const startY = before.rect.y + before.rect.height / 2;

          target.dispatchEvent(makeEvent('pointerdown', startX, startY));
          takeSnapshot('after-pointerdown');
          await wait(120);

          for (let step = 1; step <= ${options.moveSteps}; step += 1) {
            const moveX = startX + step * ${options.stepDx};
            const moveY = startY + step * ${options.stepDy};
            window.dispatchEvent(makeEvent('pointermove', moveX, moveY));
            takeSnapshot('move-' + step);
            await wait(${options.stepDelayMs});
          }

          window.dispatchEvent(
            makeEvent(
              'pointerup',
              startX + ${options.moveSteps} * ${options.stepDx},
              startY + ${options.moveSteps} * ${options.stepDy},
            ),
          );
          await wait(${options.settleDelayMs});
          takeSnapshot('after-pointerup');

          const manualLayoutRaw = localStorage.getItem('exomind:dag-manual-layout');
          let manualLayout = null;
          try {
            manualLayout = manualLayoutRaw ? JSON.parse(manualLayoutRaw) : null;
          } catch {
            manualLayout = manualLayoutRaw;
          }

          console.warn = originalWarn;
          return {
            route: location.pathname,
            anchorId,
            anchorText: target.textContent?.trim() || null,
            maxTouchPoints: navigator.maxTouchPoints,
            logs: logs.filter((line) => line.includes('[TaskDag][InteractionDebug]')).slice(-50),
            snapshots,
            manualLayout,
          };
        })().catch((error) => {
          console.warn = originalWarn;
          throw error;
        });
      })()`,
    }, 30_000);

    const summary = verification.data;
    if (!summary) {
      throw new Error("Verification returned no data");
    }

    assertVerification(summary);
    console.log(JSON.stringify({
      ok: true,
      bridgeUrl: `ws://${options.host}:${options.port}`,
      anchorLookup: anchorLookup.data,
      summary,
    }, null, 2));
  } finally {
    client.close();
  }
}

await main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
