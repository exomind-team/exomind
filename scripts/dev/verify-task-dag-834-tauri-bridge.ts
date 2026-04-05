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
  mode: "verify-drag" | "detect-current" | "watch-current" | "history-current" | "clear-history";
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
  holdBeforeMoveMs: number;
  pointerType: "touch" | "mouse";
  watchDurationMs: number;
  watchIntervalMs: number;
};

type CurrentDebugSnapshot = {
  route: string | null;
  focusMode: string;
  focusedSeriesAnchorIds: string[];
  visibleFocusedSeriesNodeIds: string[];
  currentFlowNodeIds: string[];
  renderedGraphNodeIds: string[];
  renderedGraphEdgeCount: number;
  anomalyKinds: string[];
  flowNodeDimensionSummary: {
    controlledMeasuredCount: number;
    controlledSizedCount: number;
    instancePresentCount: number;
    instanceMeasuredCount: number;
    instanceHandleBoundsCount: number;
    nodes: Array<{
      id: string;
      controlledHasMeasured: boolean;
      controlledMeasuredWidth: number | null;
      controlledMeasuredHeight: number | null;
      controlledWidth: number | null;
      controlledHeight: number | null;
      controlledInitialWidth: number | null;
      controlledInitialHeight: number | null;
      instancePresent: boolean;
      instanceHasMeasured: boolean;
      instanceMeasuredWidth: number | null;
      instanceMeasuredHeight: number | null;
      instanceWidth: number | null;
      instanceHeight: number | null;
      instanceInitialWidth: number | null;
      instanceInitialHeight: number | null;
      instanceHasHandleBounds: boolean;
      instanceDragging: boolean;
      instanceHidden: boolean;
    }>;
  };
  domSummary: {
    renderedCount: number;
    renderedNodeIds: string[];
    visibleRenderedCount: number;
    visibleRenderedNodeIds: string[];
    visibleStyleRenderedCount: number;
    visibleStyleRenderedNodeIds: string[];
    hiddenRenderedCount: number;
    hiddenRenderedNodeIds: string[];
    edgesDomCount: number;
    edgePathCount: number;
    zeroRectNodeIds: string[];
    viewportTransform: string | null;
  };
};

type DebugHistoryEntry = {
  timestamp: number;
  snapshot: CurrentDebugSnapshot;
};

const DEFAULT_OPTIONS: CliOptions = {
  mode: "verify-drag",
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
  holdBeforeMoveMs: 120,
  pointerType: "touch",
  watchDurationMs: 15000,
  watchIntervalMs: 120,
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
      case "--mode":
        if (
          next === "detect-current"
          || next === "verify-drag"
          || next === "watch-current"
          || next === "history-current"
          || next === "clear-history"
        ) {
          options.mode = next;
          index += 1;
        }
        break;
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
      case "--hold-before-move-ms":
        if (next) {
          options.holdBeforeMoveMs = Number(next);
          index += 1;
        }
        break;
      case "--pointer-type":
        if (next === "touch" || next === "mouse") {
          options.pointerType = next;
          index += 1;
        }
        break;
      case "--watch-duration-ms":
        if (next) {
          options.watchDurationMs = Number(next);
          index += 1;
        }
        break;
      case "--watch-interval-ms":
        if (next) {
          options.watchIntervalMs = Number(next);
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

  if (
    !summary.logs.some((line) => line.includes("manual-layout:touch-pointerdown"))
    && !summary.logs.some((line) => line.includes("manual-layout:drag-start"))
  ) {
    throw new Error("Neither touch nor mouse drag path was triggered");
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

async function readCurrentDebugSnapshot(
  client: BridgeClient,
  options: CliOptions,
): Promise<CurrentDebugSnapshot | null> {
  const response = await client.request<CurrentDebugSnapshot | null>("execute_js", {
    windowLabel: options.windowLabel,
    script: `(() => (
      window.__EXOMIND_TASK_DAG_DEBUG__?.getSnapshot?.() ?? null
    ))()`,
  });

  return response.data ?? null;
}

async function readCurrentDebugHistory(
  client: BridgeClient,
  options: CliOptions,
): Promise<DebugHistoryEntry[]> {
  const response = await client.request<DebugHistoryEntry[] | null>("execute_js", {
    windowLabel: options.windowLabel,
    script: `(() => (
      window.__EXOMIND_TASK_DAG_DEBUG__?.getHistory?.() ?? []
    ))()`,
  });

  return response.data ?? [];
}

async function clearCurrentDebugHistory(
  client: BridgeClient,
  options: CliOptions,
): Promise<void> {
  await client.request("execute_js", {
    windowLabel: options.windowLabel,
    script: `(() => {
      window.__EXOMIND_TASK_DAG_DEBUG__?.clearHistory?.();
      return { ok: true };
    })()`,
  });
}

function assertCurrentSnapshot(snapshot: CurrentDebugSnapshot | null): asserts snapshot is CurrentDebugSnapshot {
  if (!snapshot) {
    throw new Error("Task DAG debug snapshot is unavailable in the current desktop page");
  }

  if (snapshot.route !== "/tasks/dag") {
    throw new Error(`Current page is not /tasks/dag: ${snapshot.route ?? "unknown"}`);
  }
}

type WatchSample = {
  elapsedMs: number;
  anomalyKinds: string[];
  hiddenRenderedCount: number;
  hiddenRenderedNodeIds: string[];
  edgesDomCount: number;
  edgePathCount: number;
  controlledMeasuredCount: number;
  controlledSizedCount: number;
  instancePresentCount: number;
  instanceMeasuredCount: number;
  instanceHandleBoundsCount: number;
  instanceHiddenNodeIds: string[];
  instanceMissingMeasuredNodeIds: string[];
  instanceMissingHandleBoundsNodeIds: string[];
};

function buildWatchSample(snapshot: CurrentDebugSnapshot, elapsedMs: number): WatchSample {
  return {
    elapsedMs,
    anomalyKinds: snapshot.anomalyKinds,
    hiddenRenderedCount: snapshot.domSummary.hiddenRenderedCount,
    hiddenRenderedNodeIds: snapshot.domSummary.hiddenRenderedNodeIds,
    edgesDomCount: snapshot.domSummary.edgesDomCount,
    edgePathCount: snapshot.domSummary.edgePathCount,
    controlledMeasuredCount: snapshot.flowNodeDimensionSummary.controlledMeasuredCount,
    controlledSizedCount: snapshot.flowNodeDimensionSummary.controlledSizedCount,
    instancePresentCount: snapshot.flowNodeDimensionSummary.instancePresentCount,
    instanceMeasuredCount: snapshot.flowNodeDimensionSummary.instanceMeasuredCount,
    instanceHandleBoundsCount: snapshot.flowNodeDimensionSummary.instanceHandleBoundsCount,
    instanceHiddenNodeIds: snapshot.flowNodeDimensionSummary.nodes
      .filter((node) => node.instanceHidden)
      .map((node) => node.id),
    instanceMissingMeasuredNodeIds: snapshot.flowNodeDimensionSummary.nodes
      .filter((node) => node.instancePresent && !node.instanceHasMeasured)
      .map((node) => node.id),
    instanceMissingHandleBoundsNodeIds: snapshot.flowNodeDimensionSummary.nodes
      .filter((node) => node.instancePresent && !node.instanceHasHandleBounds)
      .map((node) => node.id),
  };
}

function getWatchSignature(sample: WatchSample): string {
  return JSON.stringify({
    anomalyKinds: sample.anomalyKinds,
    hiddenRenderedNodeIds: sample.hiddenRenderedNodeIds,
    edgesDomCount: sample.edgesDomCount,
    edgePathCount: sample.edgePathCount,
    instanceHiddenNodeIds: sample.instanceHiddenNodeIds,
    instanceMissingMeasuredNodeIds: sample.instanceMissingMeasuredNodeIds,
    instanceMissingHandleBoundsNodeIds: sample.instanceMissingHandleBoundsNodeIds,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new BridgeClient(`ws://${options.host}:${options.port}`);

  try {
    await client.ready();

    if (options.mode === "detect-current") {
      const snapshot = await readCurrentDebugSnapshot(client, options);
      assertCurrentSnapshot(snapshot);
      const detected = snapshot.anomalyKinds.length > 0;
      console.log(JSON.stringify({
        ok: !detected,
        detected,
        bridgeUrl: `ws://${options.host}:${options.port}`,
        snapshot,
      }, null, 2));
      if (detected) {
        process.exitCode = 2;
      }
      return;
    }

    if (options.mode === "watch-current") {
      const startedAt = Date.now();
      const samples: WatchSample[] = [];
      let lastSignature: string | null = null;
      let detected = false;

      while (Date.now() - startedAt <= options.watchDurationMs) {
        const snapshot = await readCurrentDebugSnapshot(client, options);
        assertCurrentSnapshot(snapshot);
        const sample = buildWatchSample(snapshot, Date.now() - startedAt);
        const signature = getWatchSignature(sample);

        if (signature !== lastSignature) {
          samples.push(sample);
          lastSignature = signature;
        }
        if (sample.anomalyKinds.length > 0) {
          detected = true;
        }

        await Bun.sleep(options.watchIntervalMs);
      }

      const firstAnomalousIndex = samples.findIndex((sample) => sample.anomalyKinds.length > 0);
      const lastHealthySample = firstAnomalousIndex > 0 ? samples[firstAnomalousIndex - 1] : null;
      const firstAnomalousSample = firstAnomalousIndex >= 0 ? samples[firstAnomalousIndex] : null;

      console.log(JSON.stringify({
        ok: !detected,
        detected,
        bridgeUrl: `ws://${options.host}:${options.port}`,
        watchDurationMs: options.watchDurationMs,
        watchIntervalMs: options.watchIntervalMs,
        sampleCount: samples.length,
        lastHealthySample,
        firstAnomalousSample,
        samples,
      }, null, 2));
      if (detected) {
        process.exitCode = 2;
      }
      return;
    }

    if (options.mode === "history-current") {
      const entries = await readCurrentDebugHistory(client, options);
      console.log(JSON.stringify({
        ok: true,
        bridgeUrl: `ws://${options.host}:${options.port}`,
        entryCount: entries.length,
        entries,
      }, null, 2));
      return;
    }

    if (options.mode === "clear-history") {
      await clearCurrentDebugHistory(client, options);
      console.log(JSON.stringify({
        ok: true,
        bridgeUrl: `ws://${options.host}:${options.port}`,
        cleared: true,
      }, null, 2));
      return;
    }

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

    const sessionKey = "__EXOMIND_TASK_DAG_VERIFY_DRAG__";
    const pointerTypeLiteral = JSON.stringify(options.pointerType);
    const dragStart = await client.request<{
      anchorId: string;
      anchorText: string | null;
      startX: number;
      startY: number;
      maxTouchPoints: number;
    }>("execute_js", {
      windowLabel: options.windowLabel,
      script: `(() => {
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

        const dispatchDragEvent = (phase, dispatchTarget, x, y) => {
          if (${pointerTypeLiteral} === 'mouse') {
            const mouseType = phase === 'down' ? 'mousedown' : phase === 'move' ? 'mousemove' : 'mouseup';
            dispatchTarget.dispatchEvent(new MouseEvent(mouseType, {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: x,
              clientY: y,
              pageX: x,
              pageY: y,
              screenX: x,
              screenY: y,
              button: 0,
              buttons: phase === 'up' ? 0 : 1,
            }));
            return;
          }

          const pointerTypeName = phase === 'down' ? 'pointerdown' : phase === 'move' ? 'pointermove' : 'pointerup';
          dispatchTarget.dispatchEvent(new PointerEvent(pointerTypeName, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 77,
            pointerType: ${pointerTypeLiteral},
            isPrimary: true,
            clientX: x,
            clientY: y,
            pageX: x,
            pageY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: phase === 'up' ? 0 : 1,
            pressure: phase === 'up' ? 0 : 0.5,
            width: 24,
            height: 24,
          }));
        };

        const before = takeSnapshot('before');
        if (!before.wrapper || !before.rect) {
          console.warn = originalWarn;
          throw new Error('Focused anchor node not found before drag');
        }

        const target = ${pointerTypeLiteral} === 'mouse'
          ? before.wrapper
          : (document.querySelector('[data-testid="task-dag-node-' + anchorId + '"]') || before.wrapper);
        const startX = before.rect.x + before.rect.width / 2;
        const startY = before.rect.y + before.rect.height / 2;
        dispatchDragEvent('down', target, startX, startY);
        takeSnapshot('after-pointerdown');

        window.${sessionKey} = {
          anchorId,
          anchorText: target.textContent?.trim() || null,
          startX,
          startY,
          logs,
          snapshots,
          originalWarn,
        };

        return {
          anchorId,
          anchorText: target.textContent?.trim() || null,
          startX,
          startY,
          maxTouchPoints: navigator.maxTouchPoints,
        };
      })()`,
    }, 30_000);

    const dragStartData = dragStart.data;
    if (!dragStartData) {
      throw new Error("Drag start returned no data");
    }

    await Bun.sleep(options.holdBeforeMoveMs);

    for (let step = 1; step <= options.moveSteps; step += 1) {
      await client.request("execute_js", {
        windowLabel: options.windowLabel,
        script: `(() => {
          const state = window.${sessionKey};
          if (!state) {
            throw new Error('Drag session state is unavailable during move');
          }

          const dispatchDragEvent = (phase, dispatchTarget, x, y) => {
            if (${pointerTypeLiteral} === 'mouse') {
              const mouseType = phase === 'down' ? 'mousedown' : phase === 'move' ? 'mousemove' : 'mouseup';
              dispatchTarget.dispatchEvent(new MouseEvent(mouseType, {
                bubbles: true,
                cancelable: true,
                composed: true,
                clientX: x,
                clientY: y,
                pageX: x,
                pageY: y,
                screenX: x,
                screenY: y,
                button: 0,
                buttons: phase === 'up' ? 0 : 1,
              }));
              return;
            }

            const pointerTypeName = phase === 'down' ? 'pointerdown' : phase === 'move' ? 'pointermove' : 'pointerup';
            dispatchTarget.dispatchEvent(new PointerEvent(pointerTypeName, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 77,
              pointerType: ${pointerTypeLiteral},
              isPrimary: true,
              clientX: x,
              clientY: y,
              pageX: x,
              pageY: y,
              screenX: x,
              screenY: y,
              button: 0,
              buttons: phase === 'up' ? 0 : 1,
              pressure: phase === 'up' ? 0 : 0.5,
              width: 24,
              height: 24,
            }));
          };

          const wrapper = document.querySelector('.react-flow__node[data-id="' + state.anchorId + '"]');
          const rect = wrapper?.getBoundingClientRect?.();
          const moveX = state.startX + ${step} * ${options.stepDx};
          const moveY = state.startY + ${step} * ${options.stepDy};

          dispatchDragEvent('move', window, moveX, moveY);
          state.snapshots.push({
            label: 'move-' + ${step},
            nodeCount: document.querySelectorAll('.react-flow__node').length,
            edgeCount: document.querySelectorAll('.react-flow__edge').length,
            edgePathCount: document.querySelectorAll('.react-flow__edge path').length,
            focusedAnchorBadge: Boolean(document.querySelector('[data-testid="task-dag-focus-anchor-badge-' + state.anchorId + '"]')),
            anchorRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          });
          return { ok: true };
        })()`,
      }, 30_000);
      await Bun.sleep(options.stepDelayMs);
    }

    await client.request("execute_js", {
      windowLabel: options.windowLabel,
      script: `(() => {
        const state = window.${sessionKey};
        if (!state) {
          throw new Error('Drag session state is unavailable during pointerup');
        }

        const dispatchDragEvent = (phase, dispatchTarget, x, y) => {
          if (${pointerTypeLiteral} === 'mouse') {
            const mouseType = phase === 'down' ? 'mousedown' : phase === 'move' ? 'mousemove' : 'mouseup';
            dispatchTarget.dispatchEvent(new MouseEvent(mouseType, {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: x,
              clientY: y,
              pageX: x,
              pageY: y,
              screenX: x,
              screenY: y,
              button: 0,
              buttons: phase === 'up' ? 0 : 1,
            }));
            return;
          }

          const pointerTypeName = phase === 'down' ? 'pointerdown' : phase === 'move' ? 'pointermove' : 'pointerup';
          dispatchTarget.dispatchEvent(new PointerEvent(pointerTypeName, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 77,
            pointerType: ${pointerTypeLiteral},
            isPrimary: true,
            clientX: x,
            clientY: y,
            pageX: x,
            pageY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: phase === 'up' ? 0 : 1,
            pressure: phase === 'up' ? 0 : 0.5,
            width: 24,
            height: 24,
          }));
        };

        dispatchDragEvent(
          'up',
          window,
          state.startX + ${options.moveSteps} * ${options.stepDx},
          state.startY + ${options.moveSteps} * ${options.stepDy},
        );
        return { ok: true };
      })()`,
    }, 30_000);

    await Bun.sleep(options.settleDelayMs);

    const verification = await client.request<VerifySummary>("execute_js", {
      windowLabel: options.windowLabel,
      script: `(() => {
        const state = window.${sessionKey};
        if (!state) {
          throw new Error('Drag session state is unavailable during collection');
        }

        const wrapper = document.querySelector('.react-flow__node[data-id="' + state.anchorId + '"]');
        const rect = wrapper?.getBoundingClientRect?.();
        state.snapshots.push({
          label: 'after-pointerup',
          nodeCount: document.querySelectorAll('.react-flow__node').length,
          edgeCount: document.querySelectorAll('.react-flow__edge').length,
          edgePathCount: document.querySelectorAll('.react-flow__edge path').length,
          focusedAnchorBadge: Boolean(document.querySelector('[data-testid="task-dag-focus-anchor-badge-' + state.anchorId + '"]')),
          anchorRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        });

        const manualLayoutRaw = localStorage.getItem('exomind:dag-manual-layout');
        let manualLayout = null;
        try {
          manualLayout = manualLayoutRaw ? JSON.parse(manualLayoutRaw) : null;
        } catch {
          manualLayout = manualLayoutRaw;
        }

        console.warn = state.originalWarn;
        delete window.${sessionKey};

        return {
          route: location.pathname,
          anchorId: state.anchorId,
          anchorText: state.anchorText,
          maxTouchPoints: navigator.maxTouchPoints,
          logs: state.logs.filter((line) => line.includes('[TaskDag][InteractionDebug]')).slice(-50),
          snapshots: state.snapshots,
          manualLayout,
        };
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
