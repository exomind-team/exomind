#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ManagedTauriInstanceRecord } from "./tauri-dev-manager-lib";
import {
  compareSessionSummaries,
  parseSessionCardSessionId,
  resolveManagedInstanceBridgePort,
  summarizeRtSessions,
  type RtSessionRecord,
  type UiSessionSummary,
} from "./tauri-mcp-issue806-charter-lib";

type ParsedArgs = {
  name?: string;
  outDir: string;
  timeoutMs: number;
  webPort?: number;
  bridgePort?: number;
  runtimeDb?: string;
};

type CharterInstanceDescriptor = {
  name: string;
  webPort: number;
  bridgePort: number;
  runtimeDbPath?: string;
  hmrPort?: number;
  rootPid?: number;
  source: "managed" | "direct";
};

type RawBridgeMessage = {
  id?: string;
  success?: boolean;
  data?: unknown;
  error?: unknown;
};

type SessionPanelProbe = {
  boundHostId: string | null;
  boundPtyId: string | null;
  boundSessionId: string | null;
  ready: boolean;
  terminalVisible: boolean;
  disconnectedVisible: boolean;
  disconnectedMessage: string | null;
  disconnectedText: string | null;
  terminalErrorMessage: string | null;
};

type ConsoleEntry = {
  level: "info" | "warn" | "error";
  text: string;
  timestampMs: number;
};

type TerminalInputExerciseResult = {
  scope: "right-panel" | "tiled-pane" | "fullscreen-page";
  sessionId: string;
  status: "passed" | "failed" | "skipped";
  marker: string | null;
  ptyId: string | null;
  strategy: "paste" | "pty-input-ws" | "none";
  notes: string[];
};

type SessionCardExerciseResult = {
  target: "session-card" | "topology-node";
  sessionId: string;
  expectation: "active" | "completed";
  status: "passed" | "failed" | "skipped";
  loadingObserved: boolean;
  terminalVisible: boolean;
  disconnectedVisible: boolean;
  disconnectedMessage: string | null;
  terminalErrorMessage: string | null;
  consoleEntries: ConsoleEntry[];
  input: TerminalInputExerciseResult | null;
  notes: string[];
};

type CharterCheck = {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  notes: string[];
};

type ViewModeCheck = {
  status: "passed" | "failed";
  targetView: "topology" | "sessions" | "tiled";
  pathname: string;
  storedViewMode: string | null;
  notes: string[];
};

type TiledViewCheck = {
  status: "passed" | "failed";
  requestedSessionIds: string[];
  routedSessionIds: string[];
  loadingObserved: boolean;
  rightPanelVisible: boolean;
  paneRectsStable: boolean;
  liveTerminalCount: number;
  requiredConcurrentTerminalCount: number;
  concurrentTerminalTargetMet: boolean;
  disconnectedPaneCount: number;
  inputChecks: TerminalInputExerciseResult[];
  isolationChecks: Array<{
    sourceSessionId: string;
    otherSessionId: string;
    marker: string;
    status: "passed" | "failed" | "skipped";
    notes: string[];
  }>;
  consoleEntries: ConsoleEntry[];
  notes: string[];
};

type MultiViewRoundTripCheck = {
  status: "passed" | "failed";
  sequence: string[];
  finalViewMode: string | null;
  notes: string[];
};

type ProposalPageCheck = {
  status: "passed" | "failed";
  href: string;
  loading: boolean;
  page: boolean;
  snippet: string | null;
};

type RuntimeStatusSnapshot = {
  running?: boolean;
  host?: string;
  port?: number;
  hostId?: string | null;
  startedAt?: string | null;
  error?: string | null;
};

type RuntimePtyRecord = {
  id: string;
  session_id?: string | null;
  name?: string | null;
};

type RuntimeStateSnapshot = {
  runtimeStatus: RuntimeStatusSnapshot;
  sessions: RtSessionRecord[];
  ptys: RuntimePtyRecord[];
};

type RuntimeRequestContext = {
  rtBaseUrl: string;
  authToken: string | null;
  runtimeRunning: boolean;
  hostId: string | null;
};

type TerminalScopeSnapshot = {
  boundHostId: string | null;
  boundPtyId: string | null;
  boundSessionId: string | null;
  terminalVisible: boolean;
  loadingVisible: boolean;
  xtermReady: boolean;
  outputReconnectVisible: boolean;
  inputErrorVisible: boolean;
  disconnectedVisible: boolean;
  disconnectedMessage: string | null;
  disconnectedText: string | null;
  terminalErrorMessage: string | null;
};

type RuntimeRestartCheck = {
  status: "passed" | "failed";
  recoveryDurationMs: number;
  expectedDistinctActiveIdentityKeys: string[];
  beforeUiSummary: UiSessionSummary;
  beforeRtSummary: ReturnType<typeof summarizeRtSessions>;
  beforePtyCount: number;
  beforeHostId: string | null;
  beforeCanonicalActiveSessionIds: string[];
  beforeDistinctActiveIdentityKeys: string[];
  beforeDistinctActiveSessionIds: string[];
  afterUiSummary: UiSessionSummary;
  afterRtSummary: ReturnType<typeof summarizeRtSessions>;
  afterPtyCount: number;
  afterHostId: string | null;
  afterActiveTerminalSessionRecordIds: string[];
  afterCanonicalActiveSessionIds: string[];
  afterCanonicalActiveIdentityKeys: string[];
  afterDistinctActiveIdentityKeys: string[];
  afterDistinctActiveSessionIds: string[];
  afterActiveTerminalRecoveryKeys: string[];
  afterCanonicalActiveTerminalRecoveryKeys: string[];
  afterLivePtyRecoveryKeys: string[];
  afterMissingActiveTerminalRecoveryKeys: string[];
  afterMissingCanonicalActiveIdentityKeys: string[];
  afterMissingCanonicalActiveTerminalRecoveryKeys: string[];
  afterStaleActiveTerminalSessionRecordIds: string[];
  afterMismatches: ReturnType<typeof compareSessionSummaries>;
  consoleEntries: ConsoleEntry[];
  notes: string[];
};

type AgentsPagePreflightCheck = {
  status: "passed" | "failed";
  reloaded: boolean;
  notes: string[];
};

type LegacyTransportTelemetryCheck = {
  status: "passed" | "failed";
  fetchCalls: Array<{ url: string; timestampMs: number }>;
  eventSourceCalls: Array<{ url: string; timestampMs: number }>;
  legacyFetchCalls: Array<{ url: string; timestampMs: number }>;
  legacyEventSourceCalls: Array<{ url: string; timestampMs: number }>;
  notes: string[];
};

type LegacyEndpointProbe = {
  status: "passed" | "failed" | "skipped";
  ptyId: string | null;
  inputStatus: number | null;
  streamStatus: number | null;
  notes: string[];
};

type LargePasteCheck = {
  status: "passed" | "failed" | "skipped";
  sessionId: string | null;
  ptyId: string | null;
  payloadBytes: number;
  marker: string;
  pasteDispatched: boolean;
  markerObserved: boolean;
  markerObservedViaWs: boolean;
  inputProbe: TerminalInputExerciseResult | null;
  consoleEntries: ConsoleEntry[];
  notes: string[];
};

type FullscreenTerminalCheck = {
  status: "passed" | "failed" | "skipped";
  sessionId: string | null;
  ptyId: string | null;
  pathname: string | null;
  disconnectedVisible: boolean;
  input: TerminalInputExerciseResult | null;
  notes: string[];
};

type Issue818PreparationResult = {
  status: "prepared" | "ready";
  spawnedAgents: Array<"claude" | "codex">;
  activeTerminalCount: number;
  activeTerminalDistinctCount: number;
  activeTerminalDistinctIdentityKeys: string[];
  activeTerminalDistinctSessionIds: string[];
  activeTerminalAgentKinds: string[];
  fullscreenRecoveryPresent: boolean;
  notes: string[];
};

const PTY_WS_PROTOCOL_VERSION = 3;
const REQUIRED_CONCURRENT_TILED_TERMINALS = 3;
const CHARTER_CONSOLE_ENTRY_LIMIT = 600;
const CHARTER_NETWORK_EVENT_LIMIT = 400;
const RAW_BRIDGE_COMMAND_TIMEOUT_MS = 20_000;

class RawBridgeClient {
  private readonly ws: WebSocket;
  private readonly pending = new Map<
    string,
    {
      resolve: (message: RawBridgeMessage) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;
  private readonly openPromise: Promise<void>;

  constructor(private readonly url: string) {
    this.ws = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`raw bridge connect timeout: ${url}`));
      }, 10_000);

      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`raw bridge failed to connect: ${url}`));
      });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as RawBridgeMessage;
      if (!message.id) {
        return;
      }
      const slot = this.pending.get(message.id);
      if (!slot) {
        return;
      }
      clearTimeout(slot.timer);
      this.pending.delete(message.id);
      slot.resolve(message);
    });

    this.ws.addEventListener("close", () => {
      for (const [, slot] of this.pending) {
        clearTimeout(slot.timer);
        slot.reject(new Error(`raw bridge closed: ${url}`));
      }
      this.pending.clear();
    });
  }

  async ready(): Promise<void> {
    await this.openPromise;
  }

  async send<T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    await this.ready();

    return await new Promise<T>((resolve, reject) => {
      const id = `req-${++this.sequence}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`raw bridge command timeout: ${command}`));
      }, RAW_BRIDGE_COMMAND_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (message) => {
          if (message.success === false) {
            reject(
              new Error(
                `raw bridge command failed: ${command}: ${JSON.stringify(message.error ?? null)}`,
              ),
            );
            return;
          }
          resolve(message.data as T);
        },
        reject,
        timer,
      });

      this.ws.send(JSON.stringify({ id, command, args }));
    });
  }

  async executeJs<T>(script: string): Promise<T> {
    return await this.send<T>("execute_js", {
      script,
      windowLabel: "main",
    });
  }

  close(): void {
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close();
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let name: string | undefined;
  let outDir = path.join(
    process.cwd(),
    ".tmp",
    "reports",
    "tauri-mcp-issue806-charter",
  );
  let timeoutMs = 12_000;
  let webPort: number | undefined;
  let bridgePort: number | undefined;
  let runtimeDb: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === "--name" && value) {
      name = value;
      index += 1;
      continue;
    }
    if (token === "--out-dir" && value) {
      outDir = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    if (token === "--timeout-ms" && value) {
      timeoutMs = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (token === "--web-port" && value) {
      webPort = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (token === "--bridge-port" && value) {
      bridgePort = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (token === "--runtime-db" && value) {
      runtimeDb = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
  }

  return { name, outDir, timeoutMs, webPort, bridgePort, runtimeDb };
}

async function readManagedInstanceRecords(
  projectRoot: string,
): Promise<ManagedTauriInstanceRecord[]> {
  const registryDir = path.join(projectRoot, ".tmp", "tauri-dev-instances");
  const entries = await readdir(registryDir, { withFileTypes: true }).catch(
    () => [],
  );
  const records: ManagedTauriInstanceRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const raw = await readFile(
      path.join(registryDir, entry.name),
      "utf8",
    ).catch(() => null);
    if (!raw) {
      continue;
    }

    try {
      records.push(JSON.parse(raw) as ManagedTauriInstanceRecord);
    } catch {
      // Ignore malformed instance metadata.
    }
  }

  return records.sort((left, right) => left.name.localeCompare(right.name));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function selectManagedInstance(
  projectRoot: string,
  requestedName?: string,
): Promise<ManagedTauriInstanceRecord> {
  const records = await readManagedInstanceRecords(projectRoot);
  const liveRecords = records.filter((record) => isPidAlive(record.rootPid));

  if (requestedName) {
    const exact = liveRecords.find((record) => record.name === requestedName);
    if (!exact) {
      throw new Error(`managed Tauri instance not running: ${requestedName}`);
    }
    return exact;
  }

  if (liveRecords.length === 1) {
    return liveRecords[0]!;
  }

  if (liveRecords.length === 0) {
    throw new Error("no running tauri:manager instance found");
  }

  throw new Error(
    `multiple running tauri:manager instances found: ${liveRecords.map((record) => record.name).join(", ")}; pass --name`,
  );
}

function resolveDirectInstance(
  projectRoot: string,
  args: ParsedArgs,
): CharterInstanceDescriptor | null {
  if (!args.webPort && !args.bridgePort && !args.runtimeDb) {
    return null;
  }
  if (!args.webPort || !args.bridgePort) {
    throw new Error(
      "direct charter mode requires both --web-port and --bridge-port",
    );
  }

  const name = args.name?.trim() || `web-${args.webPort}`;
  const derivedRuntimeDbPath = path.join(
    projectRoot,
    ".tmp",
    "tauri-dev-state",
    name,
    "app-data",
    "runtime",
    "sessions.sqlite",
  );

  return {
    name,
    webPort: args.webPort,
    bridgePort: args.bridgePort,
    runtimeDbPath: args.runtimeDb ?? derivedRuntimeDbPath,
    source: "direct",
  };
}

function readRtSessionsFromSqlite(databasePath: string): RtSessionRecord[] {
  const script = [
    "import json, sqlite3, sys",
    "path = sys.argv[1]",
    "conn = sqlite3.connect(path)",
    "conn.row_factory = sqlite3.Row",
    "cur = conn.cursor()",
    'cur.execute("SELECT id, status, interaction_mode, pty_id, source_host_id, created_at, last_active_at FROM agent_sessions ORDER BY COALESCE(last_active_at, created_at) DESC")',
    "print(json.dumps([dict(row) for row in cur.fetchall()], ensure_ascii=False))",
  ].join("\n");

  const result = spawnSync("python", ["-c", script, databasePath], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `failed to read sqlite: ${databasePath}`,
    );
  }

  return JSON.parse(result.stdout) as RtSessionRecord[];
}

function trySummarizeRtSessionsFromSqlite(
  databasePath?: string,
): ReturnType<typeof summarizeRtSessions> | null {
  if (!databasePath) {
    return null;
  }

  try {
    return summarizeRtSessions(readRtSessionsFromSqlite(databasePath));
  } catch {
    return null;
  }
}

async function waitForJs<T>(
  client: RawBridgeClient,
  script: string,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await client.executeJs<T>(script);
    if (predicate(lastValue)) {
      return lastValue;
    }
    await Bun.sleep(250);
  }

  throw new Error(
    `timed out waiting for ${label}: ${JSON.stringify(lastValue ?? null)}`,
  );
}

async function navigateToRoute(
  client: RawBridgeClient,
  route: string,
  timeoutMs: number,
): Promise<void> {
  await client.executeJs(
    `(() => { window.location.assign(${JSON.stringify(route)}); return true; })()`,
  );

  await waitForJs<{ href: string; pathname: string }>(
    client,
    `(() => ({ href: window.location.href, pathname: window.location.pathname }))()`,
    (value) => value.pathname === route,
    timeoutMs,
    `route ${route}`,
  );
}

async function installConsoleTap(client: RawBridgeClient): Promise<void> {
  await client.executeJs(`(() => {
    const store = window.__issue806CharterConsoleTap ?? { entries: [], installed: false };
    if (!store.installed) {
      const patch = (level) => {
        const original = console[level].bind(console);
        console[level] = (...args) => {
          try {
            const text = args.map((item) => {
              if (typeof item === 'string') {
                return item;
              }
              try {
                return JSON.stringify(item);
              } catch {
                return String(item);
              }
            }).join(' ');
            store.entries.push({ level, text, timestampMs: Date.now() });
            if (store.entries.length > ${CHARTER_CONSOLE_ENTRY_LIMIT}) {
              store.entries.splice(
                0,
                store.entries.length - ${CHARTER_CONSOLE_ENTRY_LIMIT},
              );
            }
          } catch {
            // Ignore console tap serialization errors.
          }
          return original(...args);
        };
      };
      patch('info');
      patch('warn');
      patch('error');
      store.installed = true;
    }
    store.entries.length = 0;
    window.__issue806CharterConsoleTap = store;
    return true;
  })()`);
}

async function readConsoleEntries(
  client: RawBridgeClient,
): Promise<ConsoleEntry[]> {
  return await client.executeJs<ConsoleEntry[]>(
    `(() => window.__issue806CharterConsoleTap?.entries ?? [])()`,
  );
}

function collectPtyProblemConsoleEntries(
  entries: ConsoleEntry[],
): ConsoleEntry[] {
  const problemPatterns = [
    "[PtyTerminal] initial stream connection failed",
    "[PtyTerminal] PTY output reconnect failed",
    "[PtyTerminal] PTY output websocket closed unexpectedly",
    "[PtyTerminal] PTY output websocket reported an error",
    "websocket closed before ready（终端流连接关闭）",
    "[PtyInputTransport] failing transport",
    "[PtyInputTransport] PTY input websocket closed for",
    "[PtyInputTransport] PTY input websocket timed out before ready",
    "[PtyInputTransport] PTY input websocket returned invalid JSON",
    "[PtyInputTransport] server error for",
    "[PtyInputTransport] input ack timed out",
    "[agent-hub][pty] terminal auto-resume failed",
    "[agent-hub][pty] persisted fullscreen recovery failed",
    "[agent-hub][pty][connect] stopping automatic same-PTY reconnect after repeated initial stream failures",
    "[agent-hub][pty][connect] marking PTY as disconnected after initial stream failure",
  ];

  return entries.filter((entry) =>
    problemPatterns.some((pattern) => entry.text.includes(pattern)),
  );
}

async function installLegacyTransportTelemetry(client: RawBridgeClient): Promise<void> {
  await client.executeJs(`(() => {
    const store = window.__issue806CharterLegacyTransportTap ?? {
      installed: false,
      fetchCalls: [],
      eventSourceCalls: [],
    };
    if (!store.installed) {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        try {
          const first = args[0];
          const url = typeof first === 'string'
            ? first
            : first instanceof URL
              ? first.toString()
              : String(first?.url ?? first ?? '');
           store.fetchCalls.push({ url, timestampMs: Date.now() });
            if (store.fetchCalls.length > ${CHARTER_NETWORK_EVENT_LIMIT}) {
              store.fetchCalls.splice(
                0,
                store.fetchCalls.length - ${CHARTER_NETWORK_EVENT_LIMIT},
              );
            }
         } catch {
           // Ignore telemetry extraction failures.
         }
        return originalFetch(...args);
      };
      if (typeof window.EventSource === 'function') {
        const OriginalEventSource = window.EventSource;
        window.EventSource = class Issue806CharterEventSource extends OriginalEventSource {
          constructor(url, configuration) {
            try {
              store.eventSourceCalls.push({
                url: typeof url === 'string' ? url : String(url),
                timestampMs: Date.now(),
              });
              if (store.eventSourceCalls.length > ${CHARTER_NETWORK_EVENT_LIMIT}) {
                store.eventSourceCalls.splice(
                  0,
                  store.eventSourceCalls.length - ${CHARTER_NETWORK_EVENT_LIMIT},
                );
              }
            } catch {
              // Ignore telemetry extraction failures.
            }
            super(url, configuration);
          }
        };
      }
      store.installed = true;
    }
    store.fetchCalls.length = 0;
    store.eventSourceCalls.length = 0;
    window.__issue806CharterLegacyTransportTap = store;
    return true;
  })()`);
}

async function readLegacyTransportTelemetry(
  client: RawBridgeClient,
): Promise<LegacyTransportTelemetryCheck> {
  const telemetry = await client.executeJs<{
    fetchCalls: Array<{ url: string; timestampMs: number }>;
    eventSourceCalls: Array<{ url: string; timestampMs: number }>;
  }>(`(() => ({
    fetchCalls: window.__issue806CharterLegacyTransportTap?.fetchCalls ?? [],
    eventSourceCalls: window.__issue806CharterLegacyTransportTap?.eventSourceCalls ?? [],
  }))()`);

  const isLegacyPtyUrl = (url: string) =>
    url.includes("/pty/") &&
    (url.includes("/input") || url.includes("/stream"));
  const legacyFetchCalls = telemetry.fetchCalls.filter((entry) =>
    isLegacyPtyUrl(entry.url),
  );
  const legacyEventSourceCalls = telemetry.eventSourceCalls.filter((entry) =>
    isLegacyPtyUrl(entry.url),
  );
  const notes = [
    `fetch calls observed: ${telemetry.fetchCalls.length}`,
    `eventsource calls observed: ${telemetry.eventSourceCalls.length}`,
    `legacy fetch calls observed: ${legacyFetchCalls.length}`,
    `legacy eventsource calls observed: ${legacyEventSourceCalls.length}`,
  ];

  return {
    status:
      legacyFetchCalls.length === 0 && legacyEventSourceCalls.length === 0
        ? "passed"
        : "failed",
    fetchCalls: telemetry.fetchCalls,
    eventSourceCalls: telemetry.eventSourceCalls,
    legacyFetchCalls,
    legacyEventSourceCalls,
    notes,
  };
}

async function readAgentsPageReadyState(client: RawBridgeClient): Promise<{
  ready: boolean;
  routeErrorVisible: boolean;
  loadingVisible: boolean;
  pathname: string;
  snippet: string | null;
}> {
  return await client.executeJs(`(() => {
    const text = document.body?.innerText ?? '';
    return {
      ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]'),
      routeErrorVisible: text.includes('页面加载失败') || text.includes('动态模块加载失败'),
      loadingVisible: text.includes('页面加载中'),
      pathname: window.location.pathname,
      snippet: text.replace(/\\s+/g, ' ').trim().slice(0, 320) || null,
    };
  })()`);
}

async function ensureAgentsPageReady(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<AgentsPagePreflightCheck> {
  const notes: string[] = [];
  let reloaded = false;

  try {
    await waitForJs<{ ready: boolean }>(
      client,
      `(() => ({ ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]') }))()`,
      (value) => value.ready,
      Math.min(timeoutMs, 3_000),
      "agents page initial ready state",
    );
    return {
      status: "passed",
      reloaded,
      notes: ["agents page was ready without reload"],
    };
  } catch {
    const state = await readAgentsPageReadyState(client);
    notes.push(
      `initial agents page state: ready=${String(state.ready)} routeError=${String(state.routeErrorVisible)} loading=${String(state.loadingVisible)}`,
    );
    if (state.snippet) {
      notes.push(`initial snippet: ${state.snippet}`);
    }
  }

  await client.executeJs(
    `(() => { window.location.reload(); return true; })()`,
  );
  reloaded = true;
  notes.push("reloaded agents page after preflight detected a stale or failed state");

  try {
    await waitForJs<{ ready: boolean }>(
      client,
      `(() => ({ ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]') }))()`,
      (value) => value.ready,
      timeoutMs,
      "agents page after reload",
    );
    return {
      status: "passed",
      reloaded,
      notes,
    };
  } catch (error) {
    const finalState = await readAgentsPageReadyState(client);
    notes.push(
      `final agents page state: ready=${String(finalState.ready)} routeError=${String(finalState.routeErrorVisible)} loading=${String(finalState.loadingVisible)}`,
    );
    if (finalState.snippet) {
      notes.push(`final snippet: ${finalState.snippet}`);
    }
    notes.push(error instanceof Error ? error.message : String(error));
    return {
      status: "failed",
      reloaded,
      notes,
    };
  }
}

async function clickBySelector(
  client: RawBridgeClient,
  selector: string,
  label: string,
  timeoutMs = 4_000,
): Promise<void> {
  await waitForJs<{ present: boolean }>(
    client,
    `(() => ({ present: !!document.querySelector(${JSON.stringify(selector)}) }))()`,
    (value) => value.present,
    timeoutMs,
    `${label} presence`,
  );

  const result = await client.executeJs<{
    clicked: boolean;
    reason: string | null;
  }>(
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!(node instanceof HTMLElement)) {
        return { clicked: false, reason: 'not-found' };
      }
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { clicked: true, reason: null };
    })()`,
  );

  if (!result.clicked) {
    throw new Error(`failed to click ${label}: ${result.reason}`);
  }
}

async function setFieldValue(
  client: RawBridgeClient,
  selector: string,
  value: string,
  label: string,
  timeoutMs = 4_000,
): Promise<void> {
  await waitForJs<{ present: boolean }>(
    client,
    `(() => ({ present: !!document.querySelector(${JSON.stringify(selector)}) }))()`,
    (result) => result.present,
    timeoutMs,
    `${label} presence`,
  );

  const updated = await client.executeJs<{
    ok: boolean;
    reason: string | null;
  }>(
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement)) {
        return { ok: false, reason: 'field-not-found' };
      }
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value');
      descriptor?.set?.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, reason: null };
    })()`,
  );

  if (!updated.ok) {
    throw new Error(`failed to set ${label}: ${updated.reason}`);
  }
}

async function selectComboboxValue(
  client: RawBridgeClient,
  triggerSelector: string,
  optionLabel: string,
  label: string,
  timeoutMs = 4_000,
): Promise<void> {
  await waitForJs<{ present: boolean }>(
    client,
    `(() => ({ present: !!document.querySelector(${JSON.stringify(triggerSelector)}) }))()`,
    (result) => result.present,
    timeoutMs,
    `${label} trigger presence`,
  );

  const opened = await client.executeJs<{ ok: boolean; reason: string | null }>(
    `(() => {
      const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
      if (!(trigger instanceof HTMLElement)) {
        return { ok: false, reason: 'trigger-not-found' };
      }
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { ok: true, reason: null };
    })()`,
  );
  if (!opened.ok) {
    throw new Error(`failed to open ${label}: ${opened.reason}`);
  }

  await waitForJs<{ present: boolean }>(
    client,
    `(() => {
      const expected = ${JSON.stringify(optionLabel)}.trim().toLowerCase();
      const options = Array.from(document.querySelectorAll('[role="option"], [data-radix-collection-item]'));
      return {
        present: options.some((node) => node.textContent?.trim().toLowerCase() === expected),
      };
    })()`,
    (result) => result.present,
    timeoutMs,
    `${label} option presence`,
  );

  const selected = await client.executeJs<{
    ok: boolean;
    reason: string | null;
  }>(
    `(() => {
      const expected = ${JSON.stringify(optionLabel)}.trim().toLowerCase();
      const option = Array.from(document.querySelectorAll('[role="option"], [data-radix-collection-item]'))
        .find((node) => node.textContent?.trim().toLowerCase() === expected);
      if (!(option instanceof HTMLElement)) {
        return { ok: false, reason: 'option-not-found' };
      }
      option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { ok: true, reason: null };
    })()`,
  );
  if (!selected.ok) {
    throw new Error(`failed to select ${label}: ${selected.reason}`);
  }
}

async function readAgentHubViewState(client: RawBridgeClient): Promise<{
  pathname: string;
  storedViewMode: string | null;
  topologyVisible: boolean;
  sessionsVisible: boolean;
  tiledVisible: boolean;
}> {
  return await client.executeJs(`(() => ({
    pathname: window.location.pathname,
    storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
    topologyVisible: !!document.querySelector('[data-testid="agent-topology-view"]'),
    sessionsVisible: !!document.querySelector('[data-testid="sessions-view"]')
      || !!document.querySelector('[data-testid="sessions-empty-state"]'),
    tiledVisible: !!document.querySelector('[data-testid="tiled-grid"]'),
  }))()`);
}

async function ensureTopologyView(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<ViewModeCheck> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="agent-view-toggle-topology"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    "topology toggle",
  );
  await clickBySelector(
    client,
    '[data-testid="agent-view-toggle-topology"]',
    "topology toggle",
  );
  const state = await waitForJs<{
    pathname: string;
    storedViewMode: string | null;
    topologyVisible: boolean;
  }>(
    client,
    `(() => ({
      pathname: window.location.pathname,
      storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
      topologyVisible: !!document.querySelector('[data-testid="agent-topology-view"]'),
    }))()`,
    (value) => value.topologyVisible,
    timeoutMs,
    "topology view",
  );

  return {
    status: state.topologyVisible ? "passed" : "failed",
    targetView: "topology",
    pathname: state.pathname,
    storedViewMode: state.storedViewMode,
    notes: state.topologyVisible
      ? ["topology view became visible"]
      : ["topology view did not become visible"],
  };
}

async function ensureSessionsView(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<void> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="agent-view-toggle-sessions"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    "sessions toggle",
  );
  await clickBySelector(
    client,
    '[data-testid="agent-view-toggle-sessions"]',
    "sessions toggle",
  );
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="sessions-view"]')
        || !!document.querySelector('[data-testid="sessions-empty-state"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    "sessions view",
  );
}

async function ensureTiledView(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<ViewModeCheck> {
  await waitForJs<{ ready: boolean }>(
    client,
    `(() => ({
      ready: !!document.querySelector('[data-testid="agent-view-toggle-tiled"]')
    }))()`,
    (value) => value.ready,
    timeoutMs,
    "tiled toggle",
  );
  await clickBySelector(
    client,
    '[data-testid="agent-view-toggle-tiled"]',
    "tiled toggle",
  );
  const state = await waitForJs<{
    pathname: string;
    storedViewMode: string | null;
    tiledVisible: boolean;
  }>(
    client,
    `(() => ({
      pathname: window.location.pathname,
      storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
      tiledVisible: !!document.querySelector('[data-testid="tiled-grid"]'),
    }))()`,
    (value) => value.tiledVisible,
    timeoutMs,
    "tiled view",
  );

  return {
    status: state.tiledVisible ? "passed" : "failed",
    targetView: "tiled",
    pathname: state.pathname,
    storedViewMode: state.storedViewMode,
    notes: state.tiledVisible
      ? ["tiled view became visible"]
      : ["tiled view did not become visible"],
  };
}

async function collectUiSessionSummary(
  client: RawBridgeClient,
): Promise<UiSessionSummary> {
  const raw = await client.executeJs<{
    active: number;
    completed: number;
    activeTestIds: string[];
    completedTestIds: string[];
    visibleTestIds: string[];
  }>(`(() => {
    const parseCount = (selector) => {
      const text = document.querySelector(selector)?.textContent?.trim() ?? '0';
      const parsed = Number.parseInt(text, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const getTestIds = (selector) => Array.from(document.querySelectorAll(selector))
      .map((node) => node.getAttribute('data-testid') ?? '')
      .map((testId) => testId.trim())
      .filter(Boolean);

    return {
      active: parseCount('[data-testid="sessions-active-section"] span:last-child'),
      completed: parseCount('[data-testid="sessions-completed-section"] span:last-child'),
      activeTestIds: getTestIds('[data-testid="sessions-active-section"] [data-testid^="session-card-"]'),
      completedTestIds: getTestIds('[data-testid="sessions-completed-section"] [data-testid^="session-card-"]'),
      visibleTestIds: getTestIds('[data-testid^="session-card-"]'),
    };
  })()`);

  const extractIds = (testIds: string[]) =>
    testIds
      .map((testId) => parseSessionCardSessionId(testId))
      .filter((value): value is string => typeof value === "string");

  const activeSessionIds = extractIds(raw.activeTestIds);
  const completedSessionIds = extractIds(raw.completedTestIds);
  const visibleSessionIds = extractIds(raw.visibleTestIds);

  return {
    active: raw.active,
    completed: raw.completed,
    total: visibleSessionIds.length,
    activeSessionIds,
    completedSessionIds,
    visibleSessionIds,
  };
}

async function tryOpenExistingRightPanelTerminal(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<{
  opened: boolean;
  sessionId: string | null;
  notes: string[];
}> {
  await ensureSessionsView(client, timeoutMs);
  const summary = await collectUiSessionSummary(client);
  const notes: string[] = [];

  for (const sessionId of summary.activeSessionIds) {
    try {
      await clickBySelector(
        client,
        `[data-testid="session-card-${sessionId}"]`,
        `preparation session card ${sessionId}`,
        timeoutMs,
      );
      const panel = await waitForSessionPanel(client, timeoutMs);
      const prepState = await readIssue818PreparationState(client);
      notes.push(
        `session ${sessionId}: terminalVisible=${String(panel.terminalVisible)} disconnectedVisible=${String(panel.disconnectedVisible)} error=${panel.terminalErrorMessage ?? "none"} fullscreenRecovery=${String(prepState.fullscreenRecoveryPresent)}`,
      );
      if (
        panel.terminalVisible &&
        !panel.disconnectedVisible &&
        !panel.terminalErrorMessage &&
        prepState.rightPanelTerminalVisible &&
        prepState.xtermReady &&
        !prepState.terminalErrorMessage &&
        prepState.fullscreenRecoveryPresent
      ) {
        return {
          opened: true,
          sessionId,
          notes,
        };
      }
    } catch (error) {
      notes.push(
        `session ${sessionId}: failed to reopen existing right-panel terminal (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return {
    opened: false,
    sessionId: null,
    notes,
  };
}

async function readIssue818PreparationState(client: RawBridgeClient): Promise<{
  activeTestIds: string[];
  fullscreenPtyId: string | null;
  fullscreenRecoveryPresent: boolean;
  fullscreenRecoveryAgentType: string | null;
  rightPanelPtyId: string | null;
  rightPanelSessionId: string | null;
  rightPanelTerminalVisible: boolean;
  xtermReady: boolean;
  terminalLoadingVisible: boolean;
  terminalErrorMessage: string | null;
}> {
  return await client.executeJs(`(() => {
    const tiledStateRaw = window.localStorage.getItem('exomind:agentHubTiledState');
    let tiledState = null;
    try {
      tiledState = tiledStateRaw ? JSON.parse(tiledStateRaw) : null;
    } catch {
      tiledState = null;
    }

    return {
      activeTestIds: Array.from(document.querySelectorAll('[data-testid="sessions-active-section"] [data-testid^="session-card-"]'))
        .map((node) => node.getAttribute('data-testid') ?? '')
        .filter(Boolean),
      fullscreenPtyId: typeof tiledState?.fullscreenPtyId === 'string' ? tiledState.fullscreenPtyId : null,
      fullscreenRecoveryPresent: !!tiledState?.fullscreenTerminalRecovery,
      fullscreenRecoveryAgentType: typeof tiledState?.fullscreenTerminalRecovery?.agentType === 'string'
        ? tiledState.fullscreenTerminalRecovery.agentType
        : null,
      rightPanelSessionId: document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]')?.getAttribute('data-session-id')?.trim() || null,
      rightPanelPtyId: document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]')?.getAttribute('data-pty-id')?.trim() || null,
      rightPanelTerminalVisible: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]'),
      xtermReady: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"] .xterm'),
      terminalLoadingVisible: !!document.querySelector('[data-testid="pty-terminal-loading"]'),
      terminalErrorMessage: document.querySelector('[data-testid="pty-terminal-error"]')?.textContent?.trim() ?? null,
    };
  })()`);
}

async function collectTopologyTerminalNodeTestIds(
  client: RawBridgeClient,
): Promise<string[]> {
  return await client.executeJs(`(() => Array.from(
    document.querySelectorAll('[data-testid^="rf__node-pty-"]'),
  ).map((node) => node.getAttribute('data-testid') ?? '').filter(Boolean))()`);
}

async function waitForTopologyTerminalNodeTestIds(
  client: RawBridgeClient,
  expectedSessionIds: string[],
  timeoutMs: number,
): Promise<string[]> {
  if (expectedSessionIds.length === 0) {
    return await collectTopologyTerminalNodeTestIds(client);
  }

  const startedAt = Date.now();
  let lastSeenTestIds: string[] = [];
  while (Date.now() - startedAt <= timeoutMs) {
    lastSeenTestIds = await collectTopologyTerminalNodeTestIds(client);
    const missingSessionIds = expectedSessionIds.filter(
      (sessionId) => !lastSeenTestIds.includes(`rf__node-pty-${sessionId}`),
    );
    if (missingSessionIds.length === 0) {
      return lastSeenTestIds;
    }
    await Bun.sleep(200);
  }

  return lastSeenTestIds;
}

async function collectTiledViewState(client: RawBridgeClient): Promise<{
  visible: boolean;
  rightPanelVisible: boolean;
  loadingCount: number;
  liveTerminalCount: number;
  disconnectedPaneCount: number;
  paneRects: Array<{ x: number; y: number; width: number; height: number }>;
}> {
  return await client.executeJs(`(() => {
    const grid = document.querySelector('[data-testid="tiled-grid"]');
    const paneRects = Array.from(document.querySelectorAll('[data-testid^="tiled-slot-"]'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

    return {
      visible: !!grid,
      rightPanelVisible: !!document.querySelector('[data-testid="agent-rightpanel-shell"]'),
      loadingCount: grid?.querySelectorAll('[data-testid="pty-terminal-loading"]').length ?? 0,
      liveTerminalCount: grid?.querySelectorAll('.xterm').length ?? 0,
      disconnectedPaneCount: document.querySelectorAll('[data-testid^="tiled-grid-pty-disconnected-"], [data-testid^="tiled-grid-disconnected-"]').length,
      paneRects,
    };
  })()`);
}

async function prepareTiledViewForConcurrentSessions(
  client: RawBridgeClient,
  activeSessionIds: string[],
  timeoutMs: number,
): Promise<{
  requestedSessionIds: string[];
  routedSessionIds: string[];
  notes: string[];
}> {
  await ensureTiledView(client, timeoutMs);

  const targetSessionIds = activeSessionIds.slice(
    0,
    REQUIRED_CONCURRENT_TILED_TERMINALS,
  );
  const targetCount = targetSessionIds.length;
  const notes: string[] = [
    `target tiled session ids: ${targetSessionIds.join(", ") || "none"}`,
  ];

  if (targetCount === 0) {
    return {
      requestedSessionIds: [],
      routedSessionIds: [],
      notes: [...notes, "no active sessions were provided for tiled preparation"],
    };
  }

  const readState = async () =>
    await client.executeJs<{
      slotIds: string[];
      visibleSessionIds: string[];
      emptySlotIds: string[];
      missingRequestedSessionIds: string[];
    }>(`(() => {
      const requested = ${JSON.stringify(targetSessionIds)};
      const parseSessionId = (testId) => {
        const prefixes = [
          'tiled-grid-stop-',
          'tiled-grid-archive-',
          'tiled-grid-pty-disconnected-',
          'tiled-grid-disconnected-',
        ];
        for (const prefix of prefixes) {
          if (testId.startsWith(prefix)) {
            return testId.slice(prefix.length);
          }
        }
        return null;
      };
      const slotNodes = Array.from(document.querySelectorAll('[data-testid^="tiled-slot-"]'))
        .filter((node) => {
          const testId = node.getAttribute('data-testid') ?? '';
          return !testId.startsWith('tiled-slot-bind-');
        });
      const slotIds = slotNodes
        .map((node) => node.getAttribute('data-testid')?.replace(/^tiled-slot-/, '') ?? '')
        .filter(Boolean);
      const visibleSessionIds = Array.from(document.querySelectorAll(
        '[data-testid^="tiled-grid-stop-"], [data-testid^="tiled-grid-archive-"], [data-testid^="tiled-grid-pty-disconnected-"], [data-testid^="tiled-grid-disconnected-"]',
      ))
        .map((node) => parseSessionId(node.getAttribute('data-testid') ?? ''))
        .filter((value, index, array) => typeof value === 'string' && array.indexOf(value) === index)
        .filter((value) => requested.includes(value));
      const emptySlotIds = slotNodes
        .filter((node) => (node.textContent ?? '').includes('空窗格'))
        .map((node) => node.getAttribute('data-testid')?.replace(/^tiled-slot-/, '') ?? '')
        .filter(Boolean);
      const missingRequestedSessionIds = requested.filter((value) => !visibleSessionIds.includes(value));
      return { slotIds, visibleSessionIds, emptySlotIds, missingRequestedSessionIds };
    })()`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await readState();
    if (state.missingRequestedSessionIds.length === 0) {
      return {
        requestedSessionIds: targetSessionIds,
        routedSessionIds: targetSessionIds,
        notes: [
          ...notes,
          `prepared ${targetCount}/${targetCount} requested session(s) inside tiled slots`,
          `tiled slot ids: ${state.slotIds.join(", ") || "none"}`,
        ],
      };
    }

    const action = await client.executeJs<{
      action: "split" | "bind" | "clear" | "none";
      detail: string | null;
    }>(`(() => {
      const requested = ${JSON.stringify(targetSessionIds)};
      const targetCount = ${targetCount};
      const parseSessionId = (testId) => {
        const prefixes = [
          'tiled-grid-stop-',
          'tiled-grid-archive-',
          'tiled-grid-pty-disconnected-',
          'tiled-grid-disconnected-',
        ];
        for (const prefix of prefixes) {
          if (testId.startsWith(prefix)) {
            return testId.slice(prefix.length);
          }
        }
        return null;
      };
      const slotNodes = Array.from(document.querySelectorAll('[data-testid^="tiled-slot-"]'))
        .filter((node) => {
          const testId = node.getAttribute('data-testid') ?? '';
          return !testId.startsWith('tiled-slot-bind-');
        });
      const describeSlot = (slotNode) => slotNode.getAttribute('data-testid')?.replace(/^tiled-slot-/, '') ?? 'unknown-slot';
      const findActionButton = (slotNode, selector) => {
        const button = slotNode.querySelector(selector);
        return button instanceof HTMLElement ? button : null;
      };
      const findBoundSessionId = (slotNode) => {
        const anchors = Array.from(slotNode.querySelectorAll(
          '[data-testid^="tiled-grid-stop-"], [data-testid^="tiled-grid-archive-"], [data-testid^="tiled-grid-pty-disconnected-"], [data-testid^="tiled-grid-disconnected-"]',
        ));
        for (const anchor of anchors) {
          const testId = anchor.getAttribute('data-testid') ?? '';
          const sessionId = parseSessionId(testId);
          if (sessionId) {
            return sessionId;
          }
        }
        return null;
      };
      if (slotNodes.length < targetCount) {
        const splitHost = slotNodes[0] ?? null;
        const splitButton = splitHost
          ? findActionButton(splitHost, 'button[title="垂直分割"]')
            ?? findActionButton(splitHost, 'button[title="水平分割"]')
          : null;
        if (splitHost && splitButton) {
          splitHost.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          splitButton.click();
          return { action: 'split', detail: describeSlot(splitHost) };
        }
      }
      const emptySlots = slotNodes.filter((slotNode) => (slotNode.textContent ?? '').includes('空窗格'));
      const visibleRequestedSet = new Set(
        Array.from(slotNodes)
          .map((slotNode) => findBoundSessionId(slotNode))
          .filter((value) => typeof value === 'string' && requested.includes(value)),
      );
      const missingRequested = requested.filter((sessionId) => !visibleRequestedSet.has(sessionId));
      for (const emptySlot of emptySlots) {
        const slotId = describeSlot(emptySlot);
        for (const missingSessionId of missingRequested) {
          const bindButton = emptySlot.querySelector(
            '[data-testid="tiled-slot-bind-' + slotId + '-' + missingSessionId + '"]',
          );
          if (bindButton instanceof HTMLElement) {
            emptySlot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            bindButton.click();
            return {
              action: 'bind',
              detail: slotId + ':' + missingSessionId,
            };
          }
        }
      }
      for (const slotNode of slotNodes) {
        const boundSessionId = findBoundSessionId(slotNode);
        if (boundSessionId && !requested.includes(boundSessionId)) {
          const clearButton = findActionButton(slotNode, 'button[title="清空窗格"]');
          if (clearButton) {
            slotNode.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            clearButton.click();
            return {
              action: 'clear',
              detail: describeSlot(slotNode) + ':' + boundSessionId,
            };
          }
        }
      }
      return {
        action: 'none',
        detail: 'slots=' + slotNodes.length + '; empty=' + emptySlots.length,
      };
    })()`);

    if (action.action !== "none") {
      notes.push(
        `tiled preparation ${action.action}: ${action.detail ?? "no detail"}`,
      );
    }
    await Bun.sleep(action.action === "none" ? 250 : 400);
  }

  const fallbackState = await readState();
  return {
    requestedSessionIds: targetSessionIds,
    routedSessionIds: targetSessionIds.filter((sessionId) =>
      fallbackState.visibleSessionIds.includes(sessionId),
    ),
    notes: [
      ...notes,
      `tiled preparation timed out with ${targetCount - fallbackState.missingRequestedSessionIds.length}/${targetCount} requested session(s) routed`,
      `missing requested session ids: ${fallbackState.missingRequestedSessionIds.join(", ") || "none"}`,
      `final slot ids: ${fallbackState.slotIds.join(", ") || "none"}`,
      `final empty slot ids: ${fallbackState.emptySlotIds.join(", ") || "none"}`,
    ],
  };
}

async function collectRuntimeStatus(
  client: RawBridgeClient,
): Promise<RuntimeStatusSnapshot> {
  return await client.executeJs<RuntimeStatusSnapshot>(`(async () => {
    return await window.__TAURI__.core.invoke('runtime_service_status').catch((error) => ({
      running: false,
      host: '127.0.0.1',
      port: 9124,
      hostId: null,
      error: String(error),
    }));
  })()`);
}

async function fetchRuntimeJsonViaWindow<T>(
  client: RawBridgeClient,
  resourcePath: string,
): Promise<T> {
  return await client.executeJs<T>(`(async () => {
    const resourcePath = ${JSON.stringify(resourcePath)};
    const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch(() => null);
    const runtimeMode = window.localStorage.getItem('exomind:runtimeTargetMode');
    const externalAddress = (window.localStorage.getItem('exomind:runtimeExternalAddress') ?? '').trim();
    const authToken = (window.localStorage.getItem('exomind:runtimeExternalAuthToken') ?? '').trim();
    const normalizeHost = (value) => value === '0.0.0.0' ? '127.0.0.1' : value;
    const runtimeHost = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
      ? runtimeStatus.host
      : '127.0.0.1';
    const runtimePort = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
      ? runtimeStatus.port
      : 9124;
    const rtBaseUrl = runtimeMode === 'external' && externalAddress
      ? 'http://' + externalAddress
      : 'http://' + normalizeHost(runtimeHost) + ':' + String(runtimePort);
    const headers = authToken ? { Authorization: 'Bearer ' + authToken } : {};
    const response = await fetch(rtBaseUrl + resourcePath, { headers });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ' for ' + resourcePath);
    }
    return await response.json();
  })()`);
}

async function fetchRuntimeStatusViaWindow(
  client: RawBridgeClient,
  resourcePath: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{
  status: number | null;
  ok: boolean;
  text: string | null;
}> {
  return await client.executeJs(`(async () => {
    const input = ${JSON.stringify({
      resourcePath,
      init,
    })};
    const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch(() => null);
    const runtimeMode = window.localStorage.getItem('exomind:runtimeTargetMode');
    const externalAddress = (window.localStorage.getItem('exomind:runtimeExternalAddress') ?? '').trim();
    const authToken = (window.localStorage.getItem('exomind:runtimeExternalAuthToken') ?? '').trim();
    const normalizeHost = (value) => value === '0.0.0.0' ? '127.0.0.1' : value;
    const runtimeHost = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
      ? runtimeStatus.host
      : '127.0.0.1';
    const runtimePort = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
      ? runtimeStatus.port
      : 9124;
    const rtBaseUrl = runtimeMode === 'external' && externalAddress
      ? 'http://' + externalAddress
      : 'http://' + normalizeHost(runtimeHost) + ':' + String(runtimePort);
    const headers = {
      ...(input.init?.headers ?? {}),
      ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}),
    };
    try {
      const response = await fetch(rtBaseUrl + input.resourcePath, {
        method: input.init?.method ?? 'GET',
        headers,
        body: input.init?.body ?? undefined,
      });
      return {
        status: response.status,
        ok: response.ok,
        text: await response.text(),
      };
    } catch (error) {
      return {
        status: null,
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      };
    }
  })()`);
}

async function collectRuntimeState(
  client: RawBridgeClient,
): Promise<RuntimeStateSnapshot> {
  const [runtimeStatus, sessions, ptys] = await Promise.all([
    collectRuntimeStatus(client),
    fetchRuntimeJsonViaWindow<RtSessionRecord[]>(client, "/sessions").catch(
      () => [],
    ),
    fetchRuntimeJsonViaWindow<RuntimePtyRecord[]>(client, "/pty").catch(
      () => [],
    ),
  ]);

  return {
    runtimeStatus,
    sessions: Array.isArray(sessions) ? sessions : [],
    ptys: Array.isArray(ptys) ? ptys : [],
  };
}

async function collectRuntimeRequestContext(
  client: RawBridgeClient,
): Promise<RuntimeRequestContext> {
  return await client.executeJs<RuntimeRequestContext>(`(async () => {
    const runtimeStatus = await window.__TAURI__.core.invoke('runtime_service_status').catch(() => null);
    const runtimeMode = window.localStorage.getItem('exomind:runtimeTargetMode');
    const externalAddress = (window.localStorage.getItem('exomind:runtimeExternalAddress') ?? '').trim();
    const authToken = (window.localStorage.getItem('exomind:runtimeExternalAuthToken') ?? '').trim();
    const normalizeHost = (value) => value === '0.0.0.0' ? '127.0.0.1' : value;
    const runtimeHost = typeof runtimeStatus?.host === 'string' && runtimeStatus.host.length > 0
      ? runtimeStatus.host
      : '127.0.0.1';
    const runtimePort = typeof runtimeStatus?.port === 'number' && Number.isFinite(runtimeStatus.port)
      ? runtimeStatus.port
      : 9124;
    const rtBaseUrl = runtimeMode === 'external' && externalAddress
      ? 'http://' + externalAddress
      : 'http://' + normalizeHost(runtimeHost) + ':' + String(runtimePort);

    return {
      rtBaseUrl,
      authToken: authToken || null,
      runtimeRunning: runtimeStatus?.running === true,
      hostId: typeof runtimeStatus?.hostId === 'string' ? runtimeStatus.hostId : null,
    };
  })()`);
}

function buildRuntimeRequestHeaders(
  authToken?: string | null,
  extraHeaders: Record<string, string> = {},
): HeadersInit {
  return authToken
    ? { ...extraHeaders, Authorization: `Bearer ${authToken}` }
    : extraHeaders;
}

async function fetchRuntimeJsonWithAuth<T>(
  context: RuntimeRequestContext,
  resourcePath: string,
  timeoutMs = 4_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${context.rtBaseUrl}${resourcePath}`, {
      headers: buildRuntimeRequestHeaders(context.authToken),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    throw new Error(
      timedOut
        ? `timeout after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePtyIdForSessionId(
  client: RawBridgeClient,
  sessionId: string,
): Promise<{
  runtimeContext: RuntimeRequestContext;
  ptyId: string | null;
}> {
  const [runtimeContext, runtimeState] = await Promise.all([
    collectRuntimeRequestContext(client),
    collectRuntimeState(client),
  ]);

  const matchedSession =
    runtimeState.sessions.find((session) => session.id === sessionId) ?? null;
  const matchedPty =
    runtimeState.ptys.find((pty) => pty.session_id === sessionId) ?? null;
  const ptyId =
    typeof matchedSession?.pty_id === "string" && matchedSession.pty_id.length > 0
      ? matchedSession.pty_id
      : (matchedPty?.id ?? null);

  return { runtimeContext, ptyId };
}

async function probeLegacyPtyEndpoints(
  client: RawBridgeClient,
  sessionId: string,
): Promise<LegacyEndpointProbe> {
  const notes: string[] = [];
  const { ptyId } = await resolvePtyIdForSessionId(client, sessionId);
  if (!ptyId) {
    return {
      status: "skipped",
      ptyId: null,
      inputStatus: null,
      streamStatus: null,
      notes: ["could not resolve PTY id for legacy endpoint probe"],
    };
  }

  const [inputResponse, streamResponse] = await Promise.all([
    fetchRuntimeStatusViaWindow(client, `/pty/${encodeURIComponent(ptyId)}/input`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: Buffer.from("\n", "utf8").toString("base64"),
      }),
    }),
    fetchRuntimeStatusViaWindow(client, `/pty/${encodeURIComponent(ptyId)}/stream`),
  ]);

  notes.push(`legacy input status: ${inputResponse.status ?? "null"}`);
  notes.push(`legacy stream status: ${streamResponse.status ?? "null"}`);

  return {
    status:
      inputResponse.status === 404 && streamResponse.status === 404
        ? "passed"
        : "failed",
    ptyId,
    inputStatus: inputResponse.status,
    streamStatus: streamResponse.status,
    notes,
  };
}

function getActiveTerminalSessionRecordIds(
  records: RtSessionRecord[],
): string[] {
  return records
    .filter(
      (record) =>
        record.interaction_mode === "terminal" &&
        record.status !== "completed" &&
        record.status !== "archived",
    )
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right));
}

function getActiveTerminalAgentKinds(records: RtSessionRecord[]): string[] {
  return Array.from(
    new Set(
      records
        .filter(
          (record) =>
            record.interaction_mode === "terminal" &&
            record.status !== "completed" &&
            record.status !== "archived",
        )
        .map((record) => String(record.agent_kind ?? "").trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function resolveTerminalRecoveryKey(
  record: Pick<RtSessionRecord, "id" | "inner_session_id">,
): string {
  const innerSessionId = record.inner_session_id?.trim();
  return innerSessionId && innerSessionId.length > 0
    ? innerSessionId
    : record.id;
}

function getActiveTerminalRecoveryKeys(records: RtSessionRecord[]): string[] {
  return Array.from(
    new Set(
      records
        .filter(
          (record) =>
            record.interaction_mode === "terminal" &&
            record.status !== "completed" &&
            record.status !== "archived",
        )
        .map(resolveTerminalRecoveryKey)
        .filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function resolveRtRecoverableTerminalAgentType(
  record: Pick<RtSessionRecord, "agent_kind" | "interaction_mode">,
): "claude" | "codex" | null {
  if (record.interaction_mode !== "terminal") {
    return null;
  }
  if (record.agent_kind === "claude" || record.agent_kind === "codex") {
    return record.agent_kind;
  }
  return null;
}

function normalizeComparablePath(value?: string | null): string {
  return (value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function encodeClaudeProjectPath(value?: string | null): string {
  return (value ?? "")
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "-");
}

function resolveRtSessionWorkdir(
  record: Pick<RtSessionRecord, "context">,
): string | null {
  const workdir =
    record.context?.work_dir?.trim() || record.context?.worktree_path?.trim();
  return workdir && workdir.length > 0 ? workdir : null;
}

function buildRtHistoricalTerminalIdentityKey(
  record: Pick<
    RtSessionRecord,
    "agent_kind" | "interaction_mode" | "inner_session_id" | "context"
  >,
): string | null {
  const agentType = resolveRtRecoverableTerminalAgentType(record);
  const innerSessionId = record.inner_session_id?.trim();
  if (!agentType || !innerSessionId) {
    return null;
  }
  const workdir = resolveRtSessionWorkdir(record);
  const projectPathKey = workdir
    ? agentType === "claude"
      ? encodeClaudeProjectPath(workdir).toLowerCase()
      : normalizeComparablePath(workdir)
    : "";
  return projectPathKey.length > 0
    ? `${agentType}:${innerSessionId}:${projectPathKey}`
    : `${agentType}:${innerSessionId}`;
}

function resolveDistinctActiveTerminalIdentityKey(
  record: Pick<
    RtSessionRecord,
    "agent_kind" | "context" | "id" | "inner_session_id" | "interaction_mode"
  >,
): string {
  return (
    resolveStableDistinctActiveTerminalIdentityKey(record) ?? `${record.id}`
  );
}

function resolveStableDistinctActiveTerminalIdentityKey(
  record: Pick<
    RtSessionRecord,
    "agent_kind" | "context" | "id" | "inner_session_id" | "interaction_mode"
  >,
): string | null {
  return (
    buildRtHistoricalTerminalIdentityKey(record) ??
    (() => {
      const agentType = resolveRtRecoverableTerminalAgentType(record);
      const innerSessionId = record.inner_session_id?.trim();
      if (agentType && innerSessionId) {
        return `${agentType}:${innerSessionId}`;
      }
      return null;
    })()
  );
}

function parseRtSessionWallClockMs(
  record: Pick<RtSessionRecord, "created_at" | "last_active_at">,
): number {
  const candidates = [record.last_active_at, record.created_at];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function getActiveTerminalRecords(records: RtSessionRecord[]): RtSessionRecord[] {
  return records.filter(
    (record) =>
      record.interaction_mode === "terminal" &&
      record.status !== "completed" &&
      record.status !== "archived",
  );
}

function compareDistinctActiveTerminalCandidates(
  left: RtSessionRecord,
  right: RtSessionRecord,
  options: {
    livePtyIdSet: Set<string>;
    livePtySessionIdSet: Set<string>;
    preferredUiOrder: Map<string, number>;
  },
): number {
  const score = (record: RtSessionRecord): number => {
    let value = 0;
    const ptyId = record.pty_id?.trim() ?? "";
    if (options.preferredUiOrder.has(record.id)) {
      value += 16;
    }
    if (ptyId.length > 0 && options.livePtyIdSet.has(ptyId)) {
      value += 8;
    }
    if (options.livePtySessionIdSet.has(record.id)) {
      value += 4;
    }
    if (record.status === "running") {
      value += 2;
    }
    return value;
  };

  const scoreDiff = score(right) - score(left);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const timeDiff = parseRtSessionWallClockMs(right) - parseRtSessionWallClockMs(left);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  return right.id.localeCompare(left.id);
}

function getDistinctActiveTerminalSessionRecords(
  runtimeState: RuntimeStateSnapshot,
  preferredUiOrder: string[] = [],
): RtSessionRecord[] {
  const grouped = new Map<string, RtSessionRecord[]>();
  const preferredUiOrderMap = new Map(
    preferredUiOrder.map((sessionId, index) => [sessionId, index]),
  );
  const livePtyIdSet = new Set(
    runtimeState.ptys
      .map((pty) => pty.id?.trim() ?? "")
      .filter((value) => value.length > 0),
  );
  const livePtySessionIdSet = new Set(
    runtimeState.ptys
      .map((pty) => pty.session_id?.trim() ?? "")
      .filter((value) => value.length > 0),
  );

  for (const record of getActiveTerminalRecords(runtimeState.sessions)) {
    const identityKey = resolveDistinctActiveTerminalIdentityKey(record);
    const existing = grouped.get(identityKey);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(identityKey, [record]);
    }
  }

  const selected = [...grouped.values()]
    .map((records) =>
      [...records].sort((left, right) =>
        compareDistinctActiveTerminalCandidates(left, right, {
          livePtyIdSet,
          livePtySessionIdSet,
          preferredUiOrder: preferredUiOrderMap,
        }),
      )[0]!,
    )
    .sort((left, right) => {
      const leftOrder = preferredUiOrderMap.get(left.id);
      const rightOrder = preferredUiOrderMap.get(right.id);
      if (leftOrder != null || rightOrder != null) {
        if (leftOrder == null) return 1;
        if (rightOrder == null) return -1;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
      }

      const timeDiff =
        parseRtSessionWallClockMs(right) - parseRtSessionWallClockMs(left);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left.id.localeCompare(right.id);
    });

  return selected;
}

function getStableDistinctActiveTerminalSessionRecords(
  runtimeState: RuntimeStateSnapshot,
  preferredUiOrder: string[] = [],
): RtSessionRecord[] {
  const grouped = new Map<string, RtSessionRecord[]>();
  const preferredUiOrderMap = new Map(
    preferredUiOrder.map((sessionId, index) => [sessionId, index]),
  );
  const livePtyIdSet = new Set(
    runtimeState.ptys
      .map((pty) => pty.id?.trim() ?? "")
      .filter((value) => value.length > 0),
  );
  const livePtySessionIdSet = new Set(
    runtimeState.ptys
      .map((pty) => pty.session_id?.trim() ?? "")
      .filter((value) => value.length > 0),
  );

  for (const record of getActiveTerminalRecords(runtimeState.sessions)) {
    const identityKey = resolveStableDistinctActiveTerminalIdentityKey(record);
    const ptyId = record.pty_id?.trim() ?? "";
    if (!identityKey || ptyId.length === 0 || !livePtyIdSet.has(ptyId)) {
      continue;
    }
    const existing = grouped.get(identityKey);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(identityKey, [record]);
    }
  }

  return [...grouped.values()]
    .map((records) =>
      [...records].sort((left, right) =>
        compareDistinctActiveTerminalCandidates(left, right, {
          livePtyIdSet,
          livePtySessionIdSet,
          preferredUiOrder: preferredUiOrderMap,
        }),
      )[0]!,
    )
    .sort((left, right) => {
      const leftOrder = preferredUiOrderMap.get(left.id);
      const rightOrder = preferredUiOrderMap.get(right.id);
      if (leftOrder != null || rightOrder != null) {
        if (leftOrder == null) return 1;
        if (rightOrder == null) return -1;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
      }

      const timeDiff =
        parseRtSessionWallClockMs(right) - parseRtSessionWallClockMs(left);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left.id.localeCompare(right.id);
    });
}

function getStableDistinctActiveTerminalSessionIds(
  runtimeState: RuntimeStateSnapshot,
  preferredUiOrder: string[] = [],
): string[] {
  return getStableDistinctActiveTerminalSessionRecords(
    runtimeState,
    preferredUiOrder,
  ).map((record) => record.id);
}

function getStableDistinctActiveTerminalIdentityKeys(
  runtimeState: RuntimeStateSnapshot,
  preferredUiOrder: string[] = [],
): string[] {
  return getStableDistinctActiveTerminalSessionRecords(
    runtimeState,
    preferredUiOrder,
  )
    .map((record) => resolveStableDistinctActiveTerminalIdentityKey(record))
    .filter((value): value is string => typeof value === "string");
}

function getDistinctActiveTerminalSessionIds(
  runtimeState: RuntimeStateSnapshot,
  preferredUiOrder: string[] = [],
): string[] {
  return getDistinctActiveTerminalSessionRecords(runtimeState, preferredUiOrder).map(
    (record) => record.id,
  );
}

function getDistinctActiveTerminalIdentityKeys(
  runtimeState: RuntimeStateSnapshot,
  preferredUiOrder: string[] = [],
): string[] {
  return getDistinctActiveTerminalSessionRecords(runtimeState, preferredUiOrder).map(
    (record) => resolveDistinctActiveTerminalIdentityKey(record),
  );
}

function getLivePtyRecoveryKeys(ptys: RuntimePtyRecord[]): string[] {
  return Array.from(
    new Set(
      ptys.flatMap((pty) => {
        const recoveryKeys = [
          pty.session_id?.trim() ?? "",
          pty.id?.trim() ?? "",
        ].filter((value) => value.length > 0);
        return recoveryKeys;
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function findStaleActiveTerminalSessions(
  runtimeState: RuntimeStateSnapshot,
): RtSessionRecord[] {
  const liveRecoveryKeySet = new Set(getLivePtyRecoveryKeys(runtimeState.ptys));
  return runtimeState.sessions
    .filter(
      (record) =>
        record.interaction_mode === "terminal" &&
        record.status !== "completed" &&
        record.status !== "archived",
    )
    .filter((record) => {
      const candidateKeys = [
        resolveTerminalRecoveryKey(record),
        record.id,
        record.pty_id?.trim() ?? "",
      ].filter((value) => value.length > 0);
      return !candidateKeys.some((key) => liveRecoveryKeySet.has(key));
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function archiveSessionsViaWindow(
  client: RawBridgeClient,
  sessions: RtSessionRecord[],
): Promise<void> {
  const updateSessionStatus = async (
    sessionId: string,
    status: "running" | "completed" | "archived",
  ) => {
    return await fetchRuntimeStatusViaWindow(
      client,
      `/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
        }),
      },
    );
  };

  for (const session of sessions) {
    const sessionId = session.id;
    const transitionPlan =
      session.status === "waiting_input"
        ? (["running", "completed", "archived"] as const)
        : session.status === "running"
          ? (["completed", "archived"] as const)
          : session.status === "completed" ||
              session.status === "paused" ||
              session.status === "error"
            ? (["archived"] as const)
            : ([] as const);

    for (const nextStatus of transitionPlan) {
      const response = await updateSessionStatus(sessionId, nextStatus);

      if (!response.ok) {
        throw new Error(
          `failed to move stale session ${sessionId} to ${nextStatus}: ${response.status ?? "null"} ${response.text ?? ""}`.trim(),
        );
      }
    }
  }
}

async function spawnTerminalAgentViaDialog(
  client: RawBridgeClient,
  input: {
    agentType: "claude" | "codex";
    name: string;
    workdir: string;
  },
  timeoutMs: number,
): Promise<void> {
  await ensureSessionsView(client, timeoutMs);
  await clickBySelector(
    client,
    '[data-testid="pty-spawn-button"]',
    "pty spawn button",
    timeoutMs,
  );
  const dialogState = await waitForJs<{
    routeOpen: boolean;
    createOpen: boolean;
  }>(
    client,
    `(() => ({
      routeOpen: !!document.querySelector('[data-testid="pty-mode-route"]'),
      createOpen: !!document.querySelector('[data-testid="pty-agent-type"]'),
    }))()`,
    (value) => value.routeOpen || value.createOpen,
    timeoutMs,
    `spawn dialog ${input.agentType}`,
  );
  if (dialogState.routeOpen) {
    await clickBySelector(
      client,
      '[data-testid="pty-mode-create"]',
      "pty mode create",
      timeoutMs,
    );
  }
  await waitForJs<{ open: boolean }>(
    client,
    `(() => ({ open: !!document.querySelector('[data-testid="pty-agent-type"]') }))()`,
    (value) => value.open,
    timeoutMs,
    `spawn create form ${input.agentType}`,
  );
  await selectComboboxValue(
    client,
    '[data-testid="pty-agent-type"]',
    input.agentType === "claude" ? "Claude" : "Codex",
    "pty agent type",
    timeoutMs,
  );
  await setFieldValue(
    client,
    '[data-testid="pty-session-name"]',
    input.name,
    "pty session name",
    timeoutMs,
  );
  await setFieldValue(
    client,
    '[data-testid="pty-session-workdir"]',
    input.workdir,
    "pty session workdir",
    timeoutMs,
  );
  await clickBySelector(
    client,
    '[data-testid="pty-spawn-submit"]',
    `spawn submit ${input.agentType}`,
    timeoutMs,
  );
  await waitForJs<{ closed: boolean }>(
    client,
    `(() => ({
      closed: !document.querySelector('[data-testid="pty-spawn-dialog-body"]')
        && !document.querySelector('[data-testid="pty-agent-type"]')
        && !document.querySelector('[data-testid="pty-mode-route"]')
    }))()`,
    (value) => value.closed,
    Math.max(timeoutMs, 60_000),
    `spawn dialog close ${input.agentType}`,
  );
  await waitForJs<Awaited<ReturnType<typeof readIssue818PreparationState>>>(
    client,
    `(() => {
      const tiledStateRaw = window.localStorage.getItem('exomind:agentHubTiledState');
      let tiledState = null;
      try {
        tiledState = tiledStateRaw ? JSON.parse(tiledStateRaw) : null;
      } catch {
        tiledState = null;
      }

      return {
        activeTestIds: Array.from(document.querySelectorAll('[data-testid="sessions-active-section"] [data-testid^="session-card-"]'))
          .map((node) => node.getAttribute('data-testid') ?? '')
          .filter(Boolean),
        fullscreenPtyId: typeof tiledState?.fullscreenPtyId === 'string' ? tiledState.fullscreenPtyId : null,
        fullscreenRecoveryPresent: !!tiledState?.fullscreenTerminalRecovery,
        fullscreenRecoveryAgentType: typeof tiledState?.fullscreenTerminalRecovery?.agentType === 'string'
          ? tiledState.fullscreenTerminalRecovery.agentType
          : null,
        rightPanelSessionId: document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]')?.getAttribute('data-session-id')?.trim() || null,
        rightPanelPtyId: document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]')?.getAttribute('data-pty-id')?.trim() || null,
        rightPanelTerminalVisible: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]'),
        xtermReady: !!document.querySelector('[data-testid="agent-rightpanel-pty-terminal"] .xterm'),
        terminalLoadingVisible: !!document.querySelector('[data-testid="pty-terminal-loading"]'),
        terminalErrorMessage: document.querySelector('[data-testid="pty-terminal-error"]')?.textContent?.trim() ?? null,
      };
    })()`,
    (value) =>
      value.rightPanelTerminalVisible &&
      value.xtermReady &&
      !value.terminalLoadingVisible &&
      !value.terminalErrorMessage,
    Math.max(timeoutMs, 60_000),
    `issue818 post-spawn ${input.agentType}`,
  );
}

function buildPreparationWorkdirVariants(projectRoot: string): string[] {
  return Array.from(
    new Set(
      [
        projectRoot,
        path.join(projectRoot, "docs"),
        path.join(projectRoot, "tests"),
        path.join(projectRoot, "src"),
        path.join(projectRoot, "scripts"),
        path.join(projectRoot, "server"),
      ].map((value) => value.replaceAll("\\", "/")),
    ),
  );
}

async function ensureIssue818RecoveryPreparation(
  client: RawBridgeClient,
  timeoutMs: number,
  projectRoot: string,
): Promise<Issue818PreparationResult> {
  await ensureSessionsView(client, timeoutMs);
  let runtimeState = await collectRuntimeState(client);
  const initialStaleTerminalSessions =
    findStaleActiveTerminalSessions(runtimeState);
  const notes: string[] = [];
  if (initialStaleTerminalSessions.length > 0) {
    notes.push(
      `archiving stale active terminal sessions without live PTY: ${initialStaleTerminalSessions.map((session) => `${session.id}:${session.status}`).join(", ")}`,
    );
    await archiveSessionsViaWindow(client, initialStaleTerminalSessions);
    await ensureSessionsView(client, timeoutMs);
    await waitForUiRtConsistency(client, Math.min(timeoutMs, 8_000)).catch(
      () => undefined,
    );
    runtimeState = await collectRuntimeState(client);
  }
  let uiState = await readIssue818PreparationState(client);
  const spawnedAgents: Array<"claude" | "codex"> = [];
  const buildPreparationSnapshot = () => {
    const preferredUiSessionIds = uiState.activeTestIds
      .map((testId) => parseSessionCardSessionId(testId))
      .filter((value): value is string => typeof value === "string");
    const activeTerminalSessionIds = getActiveTerminalSessionRecordIds(
      runtimeState.sessions,
    );
    const activeTerminalAgentKinds = getActiveTerminalAgentKinds(
      runtimeState.sessions,
    );
    const activeTerminalRecoveryKeys = getActiveTerminalRecoveryKeys(
      runtimeState.sessions,
    );
    const distinctActiveTerminalSessionIds = getDistinctActiveTerminalSessionIds(
      runtimeState,
      preferredUiSessionIds,
    );
    const distinctActiveIdentityKeys = getDistinctActiveTerminalIdentityKeys(
      runtimeState,
      preferredUiSessionIds,
    );
    const stableDistinctActiveTerminalSessionIds =
      getStableDistinctActiveTerminalSessionIds(
        runtimeState,
        preferredUiSessionIds,
      );
    const stableDistinctActiveIdentityKeys =
      getStableDistinctActiveTerminalIdentityKeys(
        runtimeState,
        preferredUiSessionIds,
      );
    return {
      activeTerminalAgentKinds,
      activeTerminalRecoveryKeys,
      activeTerminalSessionIds,
      distinctActiveIdentityKeys,
      distinctActiveTerminalSessionIds,
      stableDistinctActiveIdentityKeys,
      stableDistinctActiveTerminalSessionIds,
      preferredUiSessionIds,
    };
  };
  const pushPreparationSnapshotNotes = (
    label: string,
    snapshot: ReturnType<typeof buildPreparationSnapshot>,
  ) => {
    notes.push(
      `${label} active terminal count: ${snapshot.activeTerminalSessionIds.length}`,
      `${label} distinct terminal count: ${snapshot.distinctActiveTerminalSessionIds.length}`,
      `${label} stable distinct terminal count: ${snapshot.stableDistinctActiveTerminalSessionIds.length}`,
      `${label} active terminal agent kinds: ${snapshot.activeTerminalAgentKinds.join(", ") || "none"}`,
      `${label} active terminal recovery keys: ${snapshot.activeTerminalRecoveryKeys.join(", ") || "none"}`,
      `${label} distinct terminal identity keys: ${snapshot.distinctActiveIdentityKeys.join(", ") || "none"}`,
      `${label} distinct terminal session ids: ${snapshot.distinctActiveTerminalSessionIds.join(", ") || "none"}`,
      `${label} stable distinct terminal identity keys: ${snapshot.stableDistinctActiveIdentityKeys.join(", ") || "none"}`,
      `${label} stable distinct terminal session ids: ${snapshot.stableDistinctActiveTerminalSessionIds.join(", ") || "none"}`,
      `${label} preferred UI session ids: ${snapshot.preferredUiSessionIds.join(", ") || "none"}`,
      `${label} fullscreen recovery present: ${String(uiState.fullscreenRecoveryPresent)}`,
      `${label} right panel terminal visible: ${String(uiState.rightPanelTerminalVisible)}`,
      `${label} right panel session id: ${uiState.rightPanelSessionId ?? "none"}`,
      `${label} right panel pty id: ${uiState.rightPanelPtyId ?? "none"}`,
      `${label} xterm ready: ${String(uiState.xtermReady)}`,
      `${label} terminal error: ${uiState.terminalErrorMessage ?? "none"}`,
    );
  };
  let snapshot = buildPreparationSnapshot();
  const refreshPreparationSnapshot = async (
    label: string,
    minimumStableDistinctCount: number,
    settleTimeoutMs = Math.min(Math.max(timeoutMs, 2_000), 6_000),
  ) => {
    const startedAt = Date.now();
    let stableSamples = 0;
    let lastSignature: string | null = null;

    while (Date.now() - startedAt < settleTimeoutMs) {
      runtimeState = await collectRuntimeState(client);
      uiState = await readIssue818PreparationState(client);
      snapshot = buildPreparationSnapshot();
      const signature = JSON.stringify({
        stableDistinctActiveTerminalSessionIds:
          snapshot.stableDistinctActiveTerminalSessionIds,
        stableDistinctActiveIdentityKeys:
          snapshot.stableDistinctActiveIdentityKeys,
        fullscreenRecoveryPresent: uiState.fullscreenRecoveryPresent,
        rightPanelTerminalVisible: uiState.rightPanelTerminalVisible,
        rightPanelSessionId: uiState.rightPanelSessionId,
        rightPanelPtyId: uiState.rightPanelPtyId,
        xtermReady: uiState.xtermReady,
        terminalErrorMessage: uiState.terminalErrorMessage ?? null,
      });

      if (
        snapshot.stableDistinctActiveTerminalSessionIds.length >=
        minimumStableDistinctCount
      ) {
        stableSamples = signature === lastSignature ? stableSamples + 1 : 1;
        lastSignature = signature;
        if (stableSamples >= 2) {
          break;
        }
      } else {
        stableSamples = 0;
        lastSignature = null;
      }

      await Bun.sleep(250);
    }

    pushPreparationSnapshotNotes(label, snapshot);
  };
  notes.push(
    `required concurrent tiled terminals: ${REQUIRED_CONCURRENT_TILED_TERMINALS}`,
  );
  pushPreparationSnapshotNotes("initial", snapshot);

  const needsInitialTerminalSurface =
    !uiState.rightPanelTerminalVisible ||
    !uiState.xtermReady ||
    !!uiState.terminalErrorMessage ||
    !uiState.fullscreenRecoveryPresent;
  if (needsInitialTerminalSurface && snapshot.activeTerminalSessionIds.length > 0) {
    const reopened = await tryOpenExistingRightPanelTerminal(client, timeoutMs);
    notes.push(...reopened.notes);
    if (reopened.opened) {
      notes.push(
        `reused existing session ${reopened.sessionId} to restore a live right-panel terminal surface`,
      );
      await refreshPreparationSnapshot(
        "post-reopen",
        snapshot.stableDistinctActiveTerminalSessionIds.length,
      );
    } else {
      notes.push(
        "existing active sessions did not immediately restore a live right-panel terminal surface with fullscreen recovery",
      );
    }
  }

  const runToken = Date.now();
  const workdirVariants = buildPreparationWorkdirVariants(projectRoot);
  let spawnAttempt = 0;
  const maxSpawnAttempts = Math.max(
    REQUIRED_CONCURRENT_TILED_TERMINALS + 1,
    workdirVariants.length,
  );

  while (spawnAttempt < maxSpawnAttempts) {
    const needsClaude = !snapshot.activeTerminalAgentKinds.includes("claude");
    const needsCodex = !snapshot.activeTerminalAgentKinds.includes("codex");
    const needsVisibleTerminalSurface =
      !uiState.rightPanelTerminalVisible ||
      !uiState.xtermReady ||
      !!uiState.terminalErrorMessage;
    const needsFullscreenRecovery = !uiState.fullscreenRecoveryPresent;
    const needsMinimumDistinctTerminalCount =
      snapshot.stableDistinctActiveTerminalSessionIds.length <
      REQUIRED_CONCURRENT_TILED_TERMINALS;

    if (
      !needsClaude &&
      !needsCodex &&
      !needsVisibleTerminalSurface &&
      !needsFullscreenRecovery &&
      !needsMinimumDistinctTerminalCount
    ) {
      return {
        status: "ready",
        spawnedAgents,
        activeTerminalCount: snapshot.activeTerminalSessionIds.length,
        activeTerminalDistinctCount:
          snapshot.stableDistinctActiveTerminalSessionIds.length,
        activeTerminalDistinctIdentityKeys:
          snapshot.stableDistinctActiveIdentityKeys,
        activeTerminalDistinctSessionIds:
          snapshot.stableDistinctActiveTerminalSessionIds,
        activeTerminalAgentKinds: snapshot.activeTerminalAgentKinds,
        fullscreenRecoveryPresent: uiState.fullscreenRecoveryPresent,
        notes,
      };
    }

    if (
      !needsClaude &&
      !needsCodex &&
      !needsMinimumDistinctTerminalCount
    ) {
      notes.push(
        "preparation left existing live sessions in place and will let later charter checks fail if the right-panel surface or fullscreen recovery still cannot be established",
      );
      break;
    }

    const claudeSpawned = spawnedAgents.filter((value) => value === "claude").length;
    const codexSpawned = spawnedAgents.filter((value) => value === "codex").length;
    const agentType: "claude" | "codex" = needsCodex
      ? "codex"
      : needsClaude
        ? "claude"
        : claudeSpawned <= codexSpawned
          ? "claude"
          : "codex";
    const workdir =
      workdirVariants[spawnAttempt % workdirVariants.length] ??
      projectRoot.replaceAll("\\", "/");
    notes.push(
      `spawn attempt ${spawnAttempt + 1}/${maxSpawnAttempts}: agent=${agentType} workdir=${workdir}`,
    );
    await spawnTerminalAgentViaDialog(
      client,
      {
        agentType,
        name: `issue818-${agentType}-${runToken}-${spawnAttempt + 1}`,
        workdir,
      },
      timeoutMs,
    );
    spawnedAgents.push(agentType);
    spawnAttempt += 1;
    await refreshPreparationSnapshot(
      `post-spawn-${spawnAttempt}`,
      Math.min(
        REQUIRED_CONCURRENT_TILED_TERMINALS,
        snapshot.stableDistinctActiveTerminalSessionIds.length + 1,
      ),
    );
  }

  const preparedReady =
    snapshot.stableDistinctActiveTerminalSessionIds.length >=
      REQUIRED_CONCURRENT_TILED_TERMINALS &&
    snapshot.activeTerminalAgentKinds.includes("claude") &&
    snapshot.activeTerminalAgentKinds.includes("codex") &&
    uiState.fullscreenRecoveryPresent &&
    uiState.rightPanelTerminalVisible &&
    uiState.xtermReady &&
    !uiState.terminalErrorMessage;
  notes.push(
    `spawned agents: ${spawnedAgents.join(", ") || "none"}`,
    `prepared ready state satisfied: ${String(preparedReady)}`,
  );

  return {
    status: preparedReady ? "ready" : "prepared",
    spawnedAgents,
    activeTerminalCount: snapshot.activeTerminalSessionIds.length,
    activeTerminalDistinctCount:
      snapshot.stableDistinctActiveTerminalSessionIds.length,
    activeTerminalDistinctIdentityKeys: snapshot.stableDistinctActiveIdentityKeys,
    activeTerminalDistinctSessionIds:
      snapshot.stableDistinctActiveTerminalSessionIds,
    activeTerminalAgentKinds: snapshot.activeTerminalAgentKinds,
    fullscreenRecoveryPresent: uiState.fullscreenRecoveryPresent,
    notes,
  };
}

function encodeRuntimeInputData(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

async function sendRuntimePtyInputViaWs(
  client: RawBridgeClient,
  context: RuntimeRequestContext,
  ptyId: string,
  text: string,
  timeoutMs = 4_000,
): Promise<void> {
  await client.executeJs<void>(`(async () => {
    const rtBaseUrl = ${JSON.stringify(context.rtBaseUrl)};
    const authToken = ${JSON.stringify(context.authToken)};
    const ptyId = ${JSON.stringify(ptyId)};
    const encodedData = ${JSON.stringify(encodeRuntimeInputData(text))};
    const timeoutMs = ${timeoutMs};
    const protocolVersion = ${PTY_WS_PROTOCOL_VERSION};

    const url = new URL(rtBaseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = \`\${url.pathname.replace(/\\/$/, '')}/pty/\${encodeURIComponent(ptyId)}/ws\`;
    url.search = '';
    url.searchParams.set('mode', 'input');
    const normalizedToken = authToken?.trim?.() ?? '';
    if (normalizedToken) {
      url.searchParams.set('token', normalizedToken);
    }

    await new Promise((resolve, reject) => {
      let settled = false;
      let sentInput = false;
      const socket = new WebSocket(url.toString());
      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // Ignore close races from the probe socket.
        }
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(undefined);
      };
      const timer = setTimeout(() => finish(\`timeout after \${timeoutMs}ms\`), timeoutMs);

      socket.addEventListener('message', (event) => {
        let message = null;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message?.type === 'ready') {
          if (message?.protocol_version !== protocolVersion) {
            finish(\`PTY WebSocket protocol mismatch: expected \${protocolVersion}, got \${String(message?.protocol_version ?? 'unknown')}\`);
            return;
          }
          if (message?.read_only === true) {
            finish('PTY input websocket is read-only');
            return;
          }
          if (message?.capabilities?.input_ack !== true) {
            finish('PTY input websocket does not advertise input_ack');
            return;
          }
          if (!sentInput) {
            sentInput = true;
            socket.send(JSON.stringify({
              type: 'input',
              input_seq: 1,
              data: encodedData,
            }));
          }
          return;
        }

        if (message?.type === 'ack' && message?.input_seq === 1) {
          finish(null);
          return;
        }

        if (message?.type === 'error') {
          finish(message?.message ?? 'PTY input websocket returned an error');
        }
      });

      socket.addEventListener('error', () => {
        finish(sentInput
          ? 'PTY input websocket error before ack'
          : 'PTY input websocket error before ready');
      });
      socket.addEventListener('close', () => {
        finish(sentInput
          ? 'PTY input websocket closed before ack'
          : 'PTY input websocket closed before ready');
      });
    });
  })()`);
}

function buildTerminalScopeScript(
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
    needle?: string;
    text?: string;
  },
  body: string,
): string {
  return `(() => {
    const input = ${JSON.stringify(input)};
    const normalizeText = (value) => {
      if (typeof value !== 'string') {
        return null;
      }
      const normalized = value.replace(/\\s+/g, ' ').trim();
      return normalized.length > 0 ? normalized.slice(0, 280) : null;
    };
    const findTiledPane = () => {
      const anchor = [
        document.querySelector('[data-testid="tiled-grid-stop-' + input.sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-archive-' + input.sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-pty-disconnected-' + input.sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-disconnected-' + input.sessionId + '"]'),
      ].find((candidate) => candidate instanceof HTMLElement) ?? null;

      const pane = anchor?.closest('[data-testid^="tiled-slot-"]') ?? null;
      return pane instanceof HTMLElement ? pane : anchor;
    };
    const resolveScope = () => {
      if (input.scope === 'right-panel') {
        const container = document.querySelector('[data-testid="agent-rightpanel-pty-terminal"]');
        return {
          container,
          xtermRows: container?.querySelector('.xterm-rows') ?? null,
          disconnected: document.querySelector('[data-testid="agent-rightpanel-pty-disconnected"]'),
          errorNode: container?.querySelector('[data-testid="pty-terminal-error"]')
            ?? document.querySelector('[data-testid="pty-terminal-error"]'),
          focusTarget: container?.querySelector('.xterm-helper-textarea')
            ?? container?.querySelector('.xterm')
            ?? container,
        };
      }

      if (input.scope === 'fullscreen-page') {
        const liveContainer = document.querySelector('[data-testid="pty-terminal-page-live"]');
        const disconnected = document.querySelector('[data-testid="pty-terminal-page-disconnected"]');
        const container = liveContainer ?? disconnected;
        return {
          container,
          xtermRows: liveContainer?.querySelector('.xterm-rows')
            ?? container?.querySelector('.xterm-rows')
            ?? null,
          disconnected,
          errorNode: container?.querySelector('[data-testid="pty-terminal-error"]')
            ?? document.querySelector('[data-testid="pty-terminal-error"]'),
          focusTarget: liveContainer?.querySelector('.xterm-helper-textarea')
            ?? liveContainer?.querySelector('.xterm')
            ?? liveContainer
            ?? container,
        };
      }

      const container = findTiledPane();
      return {
        container,
        xtermRows: container?.querySelector('.xterm-rows') ?? null,
        disconnected: document.querySelector('[data-testid="tiled-grid-pty-disconnected-' + input.sessionId + '"]')
          ?? document.querySelector('[data-testid="tiled-grid-disconnected-' + input.sessionId + '"]'),
        errorNode: container?.querySelector('[data-testid="pty-terminal-error"]') ?? null,
        focusTarget: container?.querySelector('.xterm-helper-textarea')
          ?? container?.querySelector('.xterm')
          ?? container,
      };
    };
    ${body}
  })()`;
}

async function readTerminalScopeSnapshot(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
  },
): Promise<TerminalScopeSnapshot> {
  return await client.executeJs<TerminalScopeSnapshot>(
    buildTerminalScopeScript(
      input,
      `const scoped = resolveScope();
    const loadingNode = scoped.container?.querySelector('[data-testid="pty-terminal-loading"]') ?? null;
    const outputReconnectNode = scoped.container?.querySelector('[data-testid="pty-terminal-output-reconnecting"]') ?? null;
    const inputErrorNode = scoped.container?.querySelector('[data-testid="pty-terminal-input-error"]') ?? null;
    const terminalVisible = !!scoped.container && getComputedStyle(scoped.container).display !== 'none';
    const disconnectedVisible = !!scoped.disconnected && getComputedStyle(scoped.disconnected).display !== 'none';
    const loadingVisible = !!loadingNode && getComputedStyle(loadingNode).display !== 'none';
    return {
      boundHostId: scoped.container?.getAttribute?.('data-runtime-host-id')?.trim?.() || null,
      boundPtyId: scoped.container?.getAttribute?.('data-pty-id')?.trim?.() || null,
      boundSessionId: scoped.container?.getAttribute?.('data-session-id')?.trim?.() || null,
      terminalVisible,
      loadingVisible,
      xtermReady: !!scoped.xtermRows,
      outputReconnectVisible: !!outputReconnectNode && getComputedStyle(outputReconnectNode).display !== 'none',
      inputErrorVisible: !!inputErrorNode && getComputedStyle(inputErrorNode).display !== 'none',
      disconnectedVisible,
      disconnectedMessage: input.scope === 'right-panel'
        ? normalizeText(document.querySelector('[data-testid="agent-rightpanel-pty-disconnected-message"]')?.textContent ?? '')
        : normalizeText(scoped.disconnected?.textContent ?? ''),
      disconnectedText: normalizeText(scoped.disconnected?.textContent ?? ''),
      terminalErrorMessage: normalizeText(scoped.errorNode?.textContent ?? ''),
    };`,
    ),
  );
}

function terminalScopeReady(snapshot: TerminalScopeSnapshot): boolean {
  if (snapshot.disconnectedVisible || Boolean(snapshot.terminalErrorMessage)) {
    return true;
  }

  return (
    snapshot.terminalVisible &&
    !snapshot.loadingVisible &&
    snapshot.xtermReady &&
    !snapshot.outputReconnectVisible &&
    !snapshot.inputErrorVisible
  );
}

async function waitForTerminalScopeReady(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
  },
  timeoutMs: number,
): Promise<TerminalScopeSnapshot> {
  const startedAt = Date.now();
  let latest = await readTerminalScopeSnapshot(client, input);

  while (Date.now() - startedAt < timeoutMs) {
    if (terminalScopeReady(latest)) {
      return latest;
    }
    await Bun.sleep(100);
    latest = await readTerminalScopeSnapshot(client, input);
  }

  return latest;
}

async function terminalScopeContainsMarker(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
    needle: string;
  },
): Promise<boolean> {
  return await client.executeJs<boolean>(
    buildTerminalScopeScript(
      input,
      `const scoped = resolveScope();
    const haystack = (scoped.xtermRows?.textContent ?? scoped.container?.textContent ?? '').replace(/\\s+/g, ' ');
    return haystack.includes(input.needle ?? '');`,
    ),
  );
}

async function readTerminalScopeText(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
  },
): Promise<string> {
  return await client.executeJs<string>(
    buildTerminalScopeScript(
      input,
      `const scoped = resolveScope();
    return (scoped.xtermRows?.textContent ?? scoped.container?.textContent ?? '').replace(/\\s+/g, ' ').trim();`,
    ),
  );
}

async function waitForTerminalScopeOutputToSettle(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
  },
  timeoutMs: number,
): Promise<{ settled: boolean; stableSamples: number }> {
  const startedAt = Date.now();
  let latest = await readTerminalScopeText(client, input);
  let stableSamples = 0;

  while (Date.now() - startedAt < timeoutMs) {
    await Bun.sleep(150);
    const next = await readTerminalScopeText(client, input);
    if (next === latest) {
      stableSamples += 1;
      if (stableSamples >= 2) {
        return { settled: true, stableSamples: stableSamples + 1 };
      }
      continue;
    }
    latest = next;
    stableSamples = 0;
  }

  return { settled: false, stableSamples: stableSamples + 1 };
}

async function waitForTerminalMarker(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
    marker: string;
  },
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (
      await terminalScopeContainsMarker(client, {
        scope: input.scope,
        sessionId: input.sessionId,
        needle: input.marker,
      })
    ) {
      return true;
    }
    await Bun.sleep(100);
  }
  return false;
}

async function waitForPtyOutputMarkerViaWs(
  _client: RawBridgeClient,
  input: {
    runtimeContext: RuntimeRequestContext;
    ptyId: string;
    marker: string;
    timeoutMs: number;
  },
): Promise<boolean> {
  const url = new URL(input.runtimeContext.rtBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/pty/${encodeURIComponent(input.ptyId)}/ws`;
  url.search = "";
  url.searchParams.set("mode", "output");
  const normalizedToken = input.runtimeContext.authToken?.trim() ?? "";
  if (normalizedToken) {
    url.searchParams.set("token", normalizedToken);
  }

  const decodePayload = (payload: string): string => {
    try {
      const decoded = atob(payload);
      const bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index += 1) {
        bytes[index] = decoded.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    } catch {
      return payload;
    }
  };

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let recentOutput = "";
    const socket = new WebSocket(url.toString());
    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Ignore close races from the probe socket.
      }
      resolve(value);
    };
    const timer = setTimeout(
      () => finish(recentOutput.includes(input.marker)),
      Math.max(1_000, input.timeoutMs),
    );
    const appendOutput = (text: string) => {
      recentOutput = (recentOutput + text).slice(-16_384);
      if (recentOutput.includes(input.marker)) {
        finish(true);
      }
    };

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message?.type === "output" && typeof message.data === "string") {
          appendOutput(decodePayload(message.data));
          return;
        }
        if (message?.type === "eof") {
          finish(recentOutput.includes(input.marker));
        }
      } catch {
        // Ignore malformed probe frames and keep waiting.
      }
    });

    socket.addEventListener("error", () =>
      finish(recentOutput.includes(input.marker)),
    );
    socket.addEventListener("close", () =>
      finish(recentOutput.includes(input.marker)),
    );
  });
}

async function dispatchTerminalPaste(
  client: RawBridgeClient,
  input: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId?: string;
    text: string;
  },
): Promise<{ dispatched: boolean; reason: string | null }> {
  return await client.executeJs<{ dispatched: boolean; reason: string | null }>(
    buildTerminalScopeScript(
      input,
      `const scoped = resolveScope();
    if (!(scoped.focusTarget instanceof HTMLElement)) {
      return { dispatched: false, reason: 'focus-target-missing' };
    }
    try {
      scoped.focusTarget.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', input.text ?? '');
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        value: dataTransfer,
      });
      scoped.focusTarget.dispatchEvent(pasteEvent);
      return { dispatched: true, reason: null };
    } catch (error) {
      return {
        dispatched: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }`,
    ),
  );
}

function buildUiRtConsistencySignature(input: {
  uiSummary: UiSessionSummary;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  runtimeState: RuntimeStateSnapshot;
}): string {
  return JSON.stringify({
    ui: input.uiSummary,
    rt: input.rtSummary,
    hostId: input.runtimeState.runtimeStatus.hostId ?? null,
    ptyIds: [...input.runtimeState.ptys.map((pty) => pty.id)].sort(),
  });
}

async function waitForUiRtConsistency(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<{
  uiSummary: UiSessionSummary;
  runtimeState: RuntimeStateSnapshot;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  mismatches: ReturnType<typeof compareSessionSummaries>;
}> {
  const startedAt = Date.now();
  let latest = {
    uiSummary: await collectUiSessionSummary(client),
    runtimeState: await collectRuntimeState(client),
    rtSummary: summarizeRtSessions([]),
    mismatches: [] as ReturnType<typeof compareSessionSummaries>,
  };
  latest.rtSummary = summarizeRtSessions(latest.runtimeState.sessions);
  latest.mismatches = compareSessionSummaries(
    latest.uiSummary,
    latest.rtSummary,
  );
  let stableConsistencySignature =
    latest.mismatches.length === 0
      ? buildUiRtConsistencySignature(latest)
      : null;
  let stableConsistencySamples = stableConsistencySignature ? 1 : 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (latest.mismatches.length === 0 && stableConsistencySamples >= 3) {
      return latest;
    }

    await Bun.sleep(250);
    const uiSummary = await collectUiSessionSummary(client);
    const runtimeState = await collectRuntimeState(client);
    const rtSummary = summarizeRtSessions(runtimeState.sessions);
    const mismatches = compareSessionSummaries(uiSummary, rtSummary);
    latest = { uiSummary, runtimeState, rtSummary, mismatches };

    if (mismatches.length === 0) {
      const nextSignature = buildUiRtConsistencySignature(latest);
      if (nextSignature === stableConsistencySignature) {
        stableConsistencySamples += 1;
      } else {
        stableConsistencySignature = nextSignature;
        stableConsistencySamples = 1;
      }
    } else {
      stableConsistencySignature = null;
      stableConsistencySamples = 0;
    }
  }

  return latest;
}

async function restartRuntimeAndWaitForRecovery(
  client: RawBridgeClient,
  expectedDistinctActiveIdentityKeys: string[],
  timeoutMs: number,
): Promise<RuntimeRestartCheck> {
  await installConsoleTap(client);
  const beforeUiSummary = await collectUiSessionSummary(client);
  const beforeRuntimeState = await collectRuntimeState(client);
  const beforeRtSummary = summarizeRtSessions(beforeRuntimeState.sessions);
  const beforeDistinctTargets = resolveCharterActiveTerminalTargets(
    beforeRuntimeState,
    beforeUiSummary,
  );
  const beforeCanonicalActiveSessionIds =
    getCanonicalActiveTerminalSessionIds(beforeRuntimeState);
  const beforeDistinctActiveSessionIds = beforeDistinctTargets.sessionIds;
  const beforeDistinctActiveIdentityKeys =
    expectedDistinctActiveIdentityKeys.length > 0
      ? Array.from(
          new Set(
            expectedDistinctActiveIdentityKeys.filter((value) => value.length > 0),
          ),
        ).sort((left, right) => left.localeCompare(right))
      : beforeDistinctTargets.distinctIdentityKeys;
  const beforeHostId = beforeRuntimeState.runtimeStatus.hostId ?? null;
  const beforeStartedAt = beforeRuntimeState.runtimeStatus.startedAt ?? null;
  const restartHost = beforeRuntimeState.runtimeStatus.host ?? "127.0.0.1";
  const restartPort =
    typeof beforeRuntimeState.runtimeStatus.port === "number" &&
    Number.isFinite(beforeRuntimeState.runtimeStatus.port)
      ? beforeRuntimeState.runtimeStatus.port
      : 9124;
  const restartStartedAtMs = Date.now();

  await client.executeJs(
    `(() => window.__TAURI__.core.invoke('runtime_service_stop').then(() => true))()`,
  );
  await waitForJs<RuntimeStatusSnapshot>(
    client,
    `(async () => await window.__TAURI__.core.invoke('runtime_service_status').catch((error) => ({ running: false, error: String(error) })))()`,
    (value) => value.running !== true,
    Math.min(timeoutMs, 20_000),
    "runtime stop",
  );
  await client.executeJs(
    `(() => window.__TAURI__.core.invoke('runtime_service_start', ${JSON.stringify(
      {
        host: restartHost,
        port: restartPort,
      },
    )}).then(() => true))()`,
  );
  await waitForJs<RuntimeStatusSnapshot>(
    client,
    `(async () => await window.__TAURI__.core.invoke('runtime_service_status').catch((error) => ({ running: false, error: String(error) })))()`,
    (value) => value.running === true,
    Math.min(timeoutMs, 20_000),
    "runtime start",
  );

  const canonicalRecovery = await waitForCanonicalActiveTerminalRecovery(
    client,
    beforeDistinctActiveIdentityKeys,
    timeoutMs,
  );
  const activeTerminalSessionRecordIds = getActiveTerminalSessionRecordIds(
    canonicalRecovery.runtimeState.sessions,
  );
  const activeTerminalRecoveryKeys = getActiveTerminalRecoveryKeys(
    canonicalRecovery.runtimeState.sessions,
  );
  const distinctActiveSessionIds = canonicalRecovery.distinctActiveSessionIds;
  const distinctActiveIdentityKeys = canonicalRecovery.distinctActiveIdentityKeys;
  const canonicalActiveSessionIds = canonicalRecovery.canonicalActiveSessionIds;
  const canonicalActiveIdentityKeys = canonicalRecovery.canonicalActiveIdentityKeys;
  const canonicalActiveTerminalRecoveryKeys =
    getCanonicalActiveTerminalRecoveryKeys(canonicalRecovery.runtimeState);
  const livePtyRecoveryKeys = getLivePtyRecoveryKeys(
    canonicalRecovery.runtimeState.ptys,
  );
  const livePtyRecoveryKeySet = new Set(livePtyRecoveryKeys);
  const missingActiveTerminalRecoveryKeys = activeTerminalRecoveryKeys.filter(
    (recoveryKey) => !livePtyRecoveryKeySet.has(recoveryKey),
  );
  const missingCanonicalActiveIdentityKeys =
    canonicalRecovery.missingExpectedCanonicalIdentityKeys;
  const missingCanonicalActiveTerminalRecoveryKeys =
    canonicalActiveTerminalRecoveryKeys.filter(
      (recoveryKey) => !livePtyRecoveryKeySet.has(recoveryKey),
    );
  const staleActiveTerminalSessionRecordIds = findStaleActiveTerminalSessions(
    canonicalRecovery.runtimeState,
  )
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right));
  const mismatches = compareSessionSummaries(
    canonicalRecovery.uiSummary,
    canonicalRecovery.rtSummary,
  );
  const missingDistinctActiveIdentityKeys = beforeDistinctActiveIdentityKeys.filter(
    (identityKey) => !distinctActiveIdentityKeys.includes(identityKey),
  );

  const notes = [
    `before host: ${beforeHostId ?? "none"}`,
    `before startedAt: ${beforeStartedAt ?? "none"}`,
    `restart target: ${restartHost}:${restartPort}`,
    `after host: ${canonicalRecovery.runtimeState.runtimeStatus.hostId ?? "none"}`,
    `after startedAt: ${canonicalRecovery.runtimeState.runtimeStatus.startedAt ?? "none"}`,
    `recovery duration ms: ${Date.now() - restartStartedAtMs}`,
    `before active: ${beforeUiSummary.active}`,
    `after active: ${canonicalRecovery.uiSummary.active}`,
    `expected distinct active identity keys: ${beforeDistinctActiveIdentityKeys.join(", ") || "none"}`,
    `before canonical active session ids: ${beforeCanonicalActiveSessionIds.join(", ") || "none"}`,
    `before distinct active session ids: ${beforeDistinctActiveSessionIds.join(", ") || "none"}`,
    `before distinct active identity keys: ${beforeDistinctActiveIdentityKeys.join(", ") || "none"}`,
    `after distinct active session ids: ${distinctActiveSessionIds.join(", ") || "none"}`,
    `after distinct active identity keys: ${distinctActiveIdentityKeys.join(", ") || "none"}`,
    `after canonical active session ids: ${canonicalActiveSessionIds.join(", ") || "none"}`,
    `after canonical active identity keys: ${canonicalActiveIdentityKeys.join(", ") || "none"}`,
    `after PTYs: ${canonicalRecovery.runtimeState.ptys.length}`,
    `after active terminal session record ids: ${activeTerminalSessionRecordIds.join(", ") || "none"}`,
    `after active terminal recovery keys: ${activeTerminalRecoveryKeys.join(", ") || "none"}`,
    `after canonical active terminal recovery keys: ${canonicalActiveTerminalRecoveryKeys.join(", ") || "none"}`,
    `after live PTY recovery keys: ${livePtyRecoveryKeys.join(", ") || "none"}`,
    `missing expected canonical active identity keys after restart: ${missingCanonicalActiveIdentityKeys.join(", ") || "none"}`,
    `missing distinct active identity keys after restart: ${missingDistinctActiveIdentityKeys.join(", ") || "none"}`,
    `after missing active terminal recovery keys: ${missingActiveTerminalRecoveryKeys.join(", ") || "none"}`,
    `after missing canonical active terminal recovery keys: ${missingCanonicalActiveTerminalRecoveryKeys.join(", ") || "none"}`,
    `after stale active terminal session record ids: ${staleActiveTerminalSessionRecordIds.join(", ") || "none"}`,
    `after raw mismatches: ${mismatches.length}`,
    ...beforeDistinctTargets.notes,
    ...canonicalRecovery.notes,
  ];

  return {
    status:
      canonicalRecovery.runtimeState.runtimeStatus.running === true &&
      missingCanonicalActiveIdentityKeys.length === 0 &&
      canonicalActiveSessionIds.length >= beforeDistinctActiveIdentityKeys.length
        ? "passed"
        : "failed",
    recoveryDurationMs: Date.now() - restartStartedAtMs,
    expectedDistinctActiveIdentityKeys: beforeDistinctActiveIdentityKeys,
    beforeUiSummary,
    beforeRtSummary,
    beforePtyCount: beforeRuntimeState.ptys.length,
    beforeHostId,
    beforeCanonicalActiveSessionIds,
    beforeDistinctActiveIdentityKeys,
    beforeDistinctActiveSessionIds,
    afterUiSummary: canonicalRecovery.uiSummary,
    afterRtSummary: canonicalRecovery.rtSummary,
    afterPtyCount: canonicalRecovery.runtimeState.ptys.length,
    afterHostId: canonicalRecovery.runtimeState.runtimeStatus.hostId ?? null,
    afterActiveTerminalSessionRecordIds: activeTerminalSessionRecordIds,
    afterCanonicalActiveSessionIds: canonicalActiveSessionIds,
    afterCanonicalActiveIdentityKeys: canonicalActiveIdentityKeys,
    afterDistinctActiveIdentityKeys: distinctActiveIdentityKeys,
    afterDistinctActiveSessionIds: distinctActiveSessionIds,
    afterActiveTerminalRecoveryKeys: activeTerminalRecoveryKeys,
    afterCanonicalActiveTerminalRecoveryKeys: canonicalActiveTerminalRecoveryKeys,
    afterLivePtyRecoveryKeys: livePtyRecoveryKeys,
    afterMissingActiveTerminalRecoveryKeys: missingActiveTerminalRecoveryKeys,
    afterMissingCanonicalActiveIdentityKeys: missingCanonicalActiveIdentityKeys,
    afterMissingCanonicalActiveTerminalRecoveryKeys:
      missingCanonicalActiveTerminalRecoveryKeys,
    afterStaleActiveTerminalSessionRecordIds: staleActiveTerminalSessionRecordIds,
    afterMismatches: mismatches,
    consoleEntries: await readConsoleEntries(client),
    notes,
  };
}

function getCanonicalActiveTerminalSessionRecords(
  runtimeState: RuntimeStateSnapshot,
): RtSessionRecord[] {
  const livePtyIdSet = new Set(
    runtimeState.ptys
      .map((pty) => pty.id?.trim() ?? "")
      .filter((value) => value.length > 0),
  );
  return runtimeState.sessions
    .filter(
      (record) =>
        record.interaction_mode === "terminal" &&
        record.status !== "completed" &&
        record.status !== "archived",
    )
    .filter((record) => {
      const ptyId = record.pty_id?.trim() ?? "";
      if (ptyId.length > 0 && livePtyIdSet.has(ptyId)) {
        return true;
      }
      return runtimeState.ptys.some((pty) => pty.session_id === record.id);
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function getCanonicalActiveTerminalSessionIds(
  runtimeState: RuntimeStateSnapshot,
): string[] {
  return getCanonicalActiveTerminalSessionRecords(runtimeState)
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right));
}

function getCanonicalActiveTerminalIdentityKeys(
  runtimeState: RuntimeStateSnapshot,
): string[] {
  return Array.from(
    new Set(
      getCanonicalActiveTerminalSessionRecords(runtimeState).map((record) =>
        resolveDistinctActiveTerminalIdentityKey(record),
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function getCanonicalActiveTerminalRecoveryKeys(
  runtimeState: RuntimeStateSnapshot,
): string[] {
  const canonicalSessionIdSet = new Set(
    getCanonicalActiveTerminalSessionIds(runtimeState),
  );
  return Array.from(
    new Set(
      runtimeState.sessions
        .filter((record) => canonicalSessionIdSet.has(record.id))
        .map(resolveTerminalRecoveryKey)
        .filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function resolveCharterActiveTerminalTargets(
  runtimeState: RuntimeStateSnapshot,
  uiSummary: UiSessionSummary,
): {
  distinctIdentityKeys: string[];
  sessionIds: string[];
  notes: string[];
} {
  const sessionIds = getDistinctActiveTerminalSessionIds(
    runtimeState,
    uiSummary.activeSessionIds,
  );
  const distinctIdentityKeys = getDistinctActiveTerminalIdentityKeys(
    runtimeState,
    uiSummary.activeSessionIds,
  );
  const droppedSessionIds = uiSummary.activeSessionIds.filter(
    (sessionId) => !sessionIds.includes(sessionId),
  );
  return {
    distinctIdentityKeys,
    sessionIds,
    notes: [
      `raw UI active session ids: ${uiSummary.activeSessionIds.join(", ") || "none"}`,
      `distinct charter target session ids: ${sessionIds.join(", ") || "none"}`,
      `distinct charter identity keys: ${distinctIdentityKeys.join(", ") || "none"}`,
      `dropped duplicate/non-canonical UI session ids: ${droppedSessionIds.join(", ") || "none"}`,
    ],
  };
}

function resolveDistinctActiveIdentityKeysForSessionIds(
  runtimeState: RuntimeStateSnapshot,
  sessionIds: string[],
): string[] {
  const activeRecordById = new Map(
    getActiveTerminalRecords(runtimeState.sessions).map((record) => [
      record.id,
      record,
    ]),
  );
  return Array.from(
    new Set(
      sessionIds
        .map((sessionId) => activeRecordById.get(sessionId))
        .filter((record): record is RtSessionRecord => !!record)
        .map((record) => resolveDistinctActiveTerminalIdentityKey(record)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function resolvePlannedCharterTargetSessionIds(options: {
  runtimeState: RuntimeStateSnapshot;
  preparedDistinctIdentityKeys: string[];
  fallbackDistinctSessionIds: string[];
}): {
  sessionIds: string[];
  notes: string[];
} {
  const preparedDistinctIdentityKeys = Array.from(
    new Set(
      options.preparedDistinctIdentityKeys.filter((value) => value.length > 0),
    ),
  );
  const currentDistinctRecords = getDistinctActiveTerminalSessionRecords(
    options.runtimeState,
    options.fallbackDistinctSessionIds,
  );
  const currentSessionIdByIdentityKey = new Map(
    currentDistinctRecords.map((record) => [
      resolveDistinctActiveTerminalIdentityKey(record),
      record.id,
    ]),
  );
  const plannedSessionIds = preparedDistinctIdentityKeys
    .map((identityKey) => currentSessionIdByIdentityKey.get(identityKey))
    .filter((value): value is string => typeof value === "string");
  const mergedSessionIds = Array.from(
    new Set([
      ...plannedSessionIds,
      ...currentDistinctRecords.map((record) => record.id),
    ]),
  );
  const missingPreparedIdentityKeys = preparedDistinctIdentityKeys.filter(
    (identityKey) => !currentSessionIdByIdentityKey.has(identityKey),
  );

  if (mergedSessionIds.length >= REQUIRED_CONCURRENT_TILED_TERMINALS) {
    return {
      sessionIds: mergedSessionIds.slice(
        0,
        REQUIRED_CONCURRENT_TILED_TERMINALS,
      ),
      notes: [
        "charter target source: issue818 preparation",
        `issue818 prepared distinct identity keys: ${preparedDistinctIdentityKeys.join(", ") || "none"}`,
        `current distinct session ids: ${currentDistinctRecords.map((record) => record.id).join(", ") || "none"}`,
        `current distinct identity keys: ${currentDistinctRecords.map((record) => resolveDistinctActiveTerminalIdentityKey(record)).join(", ") || "none"}`,
        `missing prepared identity keys in current distinct actives: ${missingPreparedIdentityKeys.join(", ") || "none"}`,
      ],
    };
  }

  return {
    sessionIds: options.fallbackDistinctSessionIds,
    notes: [
      "charter target source: runtime distinct fallback",
      `issue818 prepared distinct identity keys: ${preparedDistinctIdentityKeys.join(", ") || "none"}`,
      `current distinct session ids: ${currentDistinctRecords.map((record) => record.id).join(", ") || "none"}`,
      `current distinct identity keys: ${currentDistinctRecords.map((record) => resolveDistinctActiveTerminalIdentityKey(record)).join(", ") || "none"}`,
      `missing prepared identity keys in current distinct actives: ${missingPreparedIdentityKeys.join(", ") || "none"}`,
      `fallback distinct session ids: ${options.fallbackDistinctSessionIds.join(", ") || "none"}`,
    ],
  };
}

async function waitForDistinctActiveTerminalSessions(
  client: RawBridgeClient,
  expectedCount: number,
  timeoutMs: number,
): Promise<{
  uiSummary: UiSessionSummary;
  runtimeState: RuntimeStateSnapshot;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  distinctActiveIdentityKeys: string[];
  distinctActiveSessionIds: string[];
  notes: string[];
}> {
  const startedAt = Date.now();
  let stableSamples = 0;
  let lastSignature: string | null = null;
  let latest = {
    uiSummary: await collectUiSessionSummary(client),
    runtimeState: await collectRuntimeState(client),
    rtSummary: summarizeRtSessions([]),
    distinctActiveIdentityKeys: [] as string[],
    distinctActiveSessionIds: [] as string[],
  };

  while (Date.now() - startedAt < timeoutMs) {
    latest.runtimeState = await collectRuntimeState(client);
    latest.uiSummary = await collectUiSessionSummary(client);
    latest.rtSummary = summarizeRtSessions(latest.runtimeState.sessions);
    latest.distinctActiveSessionIds = getDistinctActiveTerminalSessionIds(
      latest.runtimeState,
      latest.uiSummary.activeSessionIds,
    );
    latest.distinctActiveIdentityKeys = getDistinctActiveTerminalIdentityKeys(
      latest.runtimeState,
      latest.uiSummary.activeSessionIds,
    );

    const matchesUi =
      latest.distinctActiveSessionIds.length === expectedCount &&
      latest.distinctActiveSessionIds.every((sessionId) =>
        latest.uiSummary.activeSessionIds.includes(sessionId),
      );
    const signature = JSON.stringify({
      distinct: latest.distinctActiveSessionIds,
      identity: latest.distinctActiveIdentityKeys,
      uiActive: latest.uiSummary.activeSessionIds,
      rtActive: latest.rtSummary.activeSessionIds,
    });
    if (matchesUi) {
      stableSamples = signature === lastSignature ? stableSamples + 1 : 1;
      lastSignature = signature;
      if (stableSamples >= 3) {
        return {
          ...latest,
          notes: [
            `distinct active session ids: ${latest.distinctActiveSessionIds.join(", ") || "none"}`,
            `distinct active identity keys: ${latest.distinctActiveIdentityKeys.join(", ") || "none"}`,
            `ui active session ids: ${latest.uiSummary.activeSessionIds.join(", ") || "none"}`,
            `runtime active session ids: ${latest.rtSummary.activeSessionIds.join(", ") || "none"}`,
          ],
        };
      }
    } else {
      stableSamples = 0;
      lastSignature = null;
    }

    await Bun.sleep(250);
  }

  return {
    ...latest,
    notes: [
      `distinct active session wait timed out after ${timeoutMs}ms`,
      `distinct active session ids: ${latest.distinctActiveSessionIds.join(", ") || "none"}`,
      `distinct active identity keys: ${latest.distinctActiveIdentityKeys.join(", ") || "none"}`,
      `ui active session ids: ${latest.uiSummary.activeSessionIds.join(", ") || "none"}`,
      `runtime active session ids: ${latest.rtSummary.activeSessionIds.join(", ") || "none"}`,
    ],
  };
}

async function waitForCanonicalActiveTerminalRecovery(
  client: RawBridgeClient,
  expectedDistinctIdentityKeys: string[],
  timeoutMs: number,
): Promise<{
  uiSummary: UiSessionSummary;
  runtimeState: RuntimeStateSnapshot;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  distinctActiveIdentityKeys: string[];
  distinctActiveSessionIds: string[];
  canonicalActiveIdentityKeys: string[];
  canonicalActiveSessionIds: string[];
  missingExpectedCanonicalIdentityKeys: string[];
  notes: string[];
}> {
  const startedAt = Date.now();
  let stableSamples = 0;
  let lastSignature: string | null = null;
  const normalizedExpectedIdentityKeys = Array.from(
    new Set(expectedDistinctIdentityKeys.filter((value) => value.length > 0)),
  ).sort((left, right) => left.localeCompare(right));
  let latest = {
    uiSummary: await collectUiSessionSummary(client),
    runtimeState: await collectRuntimeState(client),
    rtSummary: summarizeRtSessions([]),
    distinctActiveIdentityKeys: [] as string[],
    distinctActiveSessionIds: [] as string[],
    canonicalActiveIdentityKeys: [] as string[],
    canonicalActiveSessionIds: [] as string[],
    missingExpectedCanonicalIdentityKeys: normalizedExpectedIdentityKeys,
  };

  while (Date.now() - startedAt < timeoutMs) {
    latest.runtimeState = await collectRuntimeState(client);
    latest.uiSummary = await collectUiSessionSummary(client);
    latest.rtSummary = summarizeRtSessions(latest.runtimeState.sessions);
    latest.distinctActiveSessionIds = getDistinctActiveTerminalSessionIds(
      latest.runtimeState,
      latest.uiSummary.activeSessionIds,
    );
    latest.distinctActiveIdentityKeys = getDistinctActiveTerminalIdentityKeys(
      latest.runtimeState,
      latest.uiSummary.activeSessionIds,
    );
    latest.canonicalActiveSessionIds = getCanonicalActiveTerminalSessionIds(
      latest.runtimeState,
    );
    latest.canonicalActiveIdentityKeys = getCanonicalActiveTerminalIdentityKeys(
      latest.runtimeState,
    );
    latest.missingExpectedCanonicalIdentityKeys =
      normalizedExpectedIdentityKeys.filter(
        (identityKey) =>
          !latest.canonicalActiveIdentityKeys.includes(identityKey),
      );

    const recovered =
      latest.runtimeState.runtimeStatus.running === true &&
      latest.missingExpectedCanonicalIdentityKeys.length === 0 &&
      latest.canonicalActiveSessionIds.length >= normalizedExpectedIdentityKeys.length;
    const signature = JSON.stringify({
      canonicalActiveIdentityKeys: latest.canonicalActiveIdentityKeys,
      canonicalActiveSessionIds: latest.canonicalActiveSessionIds,
      distinctActiveIdentityKeys: latest.distinctActiveIdentityKeys,
      distinctActiveSessionIds: latest.distinctActiveSessionIds,
      runtimeActive: latest.rtSummary.activeSessionIds,
      uiActive: latest.uiSummary.activeSessionIds,
      ptyIds: latest.runtimeState.ptys.map((pty) => pty.id).sort(),
    });

    if (recovered) {
      stableSamples = signature === lastSignature ? stableSamples + 1 : 1;
      lastSignature = signature;
      if (stableSamples >= 3) {
        return {
          ...latest,
          notes: [
            `expected distinct active identity keys: ${normalizedExpectedIdentityKeys.join(", ") || "none"}`,
            `canonical active session ids: ${latest.canonicalActiveSessionIds.join(", ") || "none"}`,
            `canonical active identity keys: ${latest.canonicalActiveIdentityKeys.join(", ") || "none"}`,
            `distinct active session ids: ${latest.distinctActiveSessionIds.join(", ") || "none"}`,
            `distinct active identity keys: ${latest.distinctActiveIdentityKeys.join(", ") || "none"}`,
            `missing expected canonical active identity keys: ${latest.missingExpectedCanonicalIdentityKeys.join(", ") || "none"}`,
            `ui active session ids: ${latest.uiSummary.activeSessionIds.join(", ") || "none"}`,
            `runtime active session ids: ${latest.rtSummary.activeSessionIds.join(", ") || "none"}`,
          ],
        };
      }
    } else {
      stableSamples = 0;
      lastSignature = null;
    }

    await Bun.sleep(250);
  }

  return {
    ...latest,
    notes: [
      `canonical active recovery wait timed out after ${timeoutMs}ms`,
      `expected distinct active identity keys: ${normalizedExpectedIdentityKeys.join(", ") || "none"}`,
      `canonical active session ids: ${latest.canonicalActiveSessionIds.join(", ") || "none"}`,
      `canonical active identity keys: ${latest.canonicalActiveIdentityKeys.join(", ") || "none"}`,
      `distinct active session ids: ${latest.distinctActiveSessionIds.join(", ") || "none"}`,
      `distinct active identity keys: ${latest.distinctActiveIdentityKeys.join(", ") || "none"}`,
      `missing expected canonical active identity keys: ${latest.missingExpectedCanonicalIdentityKeys.join(", ") || "none"}`,
      `ui active session ids: ${latest.uiSummary.activeSessionIds.join(", ") || "none"}`,
      `runtime active session ids: ${latest.rtSummary.activeSessionIds.join(", ") || "none"}`,
    ],
  };
}

async function waitForCanonicalActiveTerminalSessions(
  client: RawBridgeClient,
  expectedCount: number,
  timeoutMs: number,
): Promise<{
  uiSummary: UiSessionSummary;
  runtimeState: RuntimeStateSnapshot;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  canonicalActiveSessionIds: string[];
  notes: string[];
}> {
  const startedAt = Date.now();
  let stableSamples = 0;
  let lastSignature: string | null = null;
  let latest = {
    uiSummary: await collectUiSessionSummary(client),
    runtimeState: await collectRuntimeState(client),
    rtSummary: summarizeRtSessions([]),
    canonicalActiveSessionIds: [] as string[],
  };

  while (Date.now() - startedAt < timeoutMs) {
    latest.runtimeState = await collectRuntimeState(client);
    latest.uiSummary = await collectUiSessionSummary(client);
    latest.rtSummary = summarizeRtSessions(latest.runtimeState.sessions);
    latest.canonicalActiveSessionIds = getCanonicalActiveTerminalSessionIds(
      latest.runtimeState,
    );

    const matchesUi =
      latest.canonicalActiveSessionIds.length === expectedCount &&
      latest.canonicalActiveSessionIds.every((sessionId) =>
        latest.uiSummary.activeSessionIds.includes(sessionId),
      );
    const signature = JSON.stringify({
      canonical: latest.canonicalActiveSessionIds,
      uiActive: latest.uiSummary.activeSessionIds,
      rtActive: latest.rtSummary.activeSessionIds,
    });
    if (matchesUi) {
      stableSamples = signature === lastSignature ? stableSamples + 1 : 1;
      lastSignature = signature;
      if (stableSamples >= 3) {
        return {
          ...latest,
          notes: [
            `canonical active session ids: ${latest.canonicalActiveSessionIds.join(", ") || "none"}`,
            `ui active session ids: ${latest.uiSummary.activeSessionIds.join(", ") || "none"}`,
            `runtime active session ids: ${latest.rtSummary.activeSessionIds.join(", ") || "none"}`,
          ],
        };
      }
    } else {
      stableSamples = 0;
      lastSignature = null;
    }

    await Bun.sleep(250);
  }

  return {
    ...latest,
    notes: [
      `canonical active session wait timed out after ${timeoutMs}ms`,
      `canonical active session ids: ${latest.canonicalActiveSessionIds.join(", ") || "none"}`,
      `ui active session ids: ${latest.uiSummary.activeSessionIds.join(", ") || "none"}`,
      `runtime active session ids: ${latest.rtSummary.activeSessionIds.join(", ") || "none"}`,
    ],
  };
}

async function waitForSessionPanel(
  client: RawBridgeClient,
  timeoutMs: number,
  options: {
    expectedSessionId?: string;
  } = {},
): Promise<SessionPanelProbe> {
  const startedAt = Date.now();
  let snapshot = await readTerminalScopeSnapshot(client, { scope: "right-panel" });
  while (Date.now() - startedAt < timeoutMs) {
    const bindingMatches =
      !options.expectedSessionId ||
      snapshot.boundSessionId === options.expectedSessionId;
    if (bindingMatches && terminalScopeReady(snapshot)) {
      break;
    }
    await Bun.sleep(100);
    snapshot = await readTerminalScopeSnapshot(client, { scope: "right-panel" });
  }
  return {
    boundHostId: snapshot.boundHostId,
    boundPtyId: snapshot.boundPtyId,
    boundSessionId: snapshot.boundSessionId,
    ready: terminalScopeReady(snapshot),
    terminalVisible: snapshot.terminalVisible,
    disconnectedVisible: snapshot.disconnectedVisible,
    disconnectedMessage: snapshot.disconnectedMessage,
    disconnectedText: snapshot.disconnectedText,
    terminalErrorMessage: snapshot.terminalErrorMessage,
  };
}

function buildSkippedTerminalInputResult(
  scope: TerminalInputExerciseResult["scope"],
  sessionId: string,
  reason: string,
): TerminalInputExerciseResult {
  return {
    scope,
    sessionId,
    status: "skipped",
    marker: null,
    ptyId: null,
    strategy: "none",
    notes: [reason],
  };
}

async function exerciseTerminalInput(
  client: RawBridgeClient,
  options: {
    scope: TerminalInputExerciseResult["scope"];
    sessionId: string;
    timeoutMs: number;
    allowHelperFallback?: boolean;
  },
): Promise<TerminalInputExerciseResult> {
  const scopeMarker =
    options.scope === "right-panel"
      ? "RP"
      : options.scope === "tiled-pane"
        ? "TP"
        : "FP";
  const marker = `ISSUE806-${scopeMarker}-${Date.now().toString(36).toUpperCase()}`;
  const result: TerminalInputExerciseResult = {
    scope: options.scope,
    sessionId: options.sessionId,
    status: "skipped",
    marker,
    ptyId: null,
    strategy: "none",
    notes: [],
  };

  try {
    const scopeSnapshot = await waitForTerminalScopeReady(
      client,
      {
        scope: options.scope,
        sessionId: options.sessionId,
      },
      Math.min(options.timeoutMs, 4_000),
    );

    if (!scopeSnapshot.terminalVisible) {
      result.notes.push("terminal container not found in current scope");
      return result;
    }

    if (scopeSnapshot.terminalErrorMessage) {
      result.notes.push(
        `terminal rendered explicit error: ${scopeSnapshot.terminalErrorMessage}`,
      );
      return result;
    }

    if (!scopeSnapshot.xtermReady) {
      result.status = "failed";
      result.notes.push("terminal rows were not ready in current scope");
      return result;
    }

    const settleProbe = await waitForTerminalScopeOutputToSettle(
      client,
      {
        scope: options.scope,
        sessionId: options.sessionId,
      },
      Math.min(options.timeoutMs, 1_200),
    );
    result.notes.push(
      settleProbe.settled
        ? `terminal output settled before input (${settleProbe.stableSamples} stable samples)`
        : "terminal output did not fully settle before input; continuing with live surface",
    );

    const { runtimeContext, ptyId } = await resolvePtyIdForSessionId(
      client,
      options.sessionId,
    );
    result.ptyId = ptyId;

    if (!ptyId) {
      result.status = "failed";
      result.notes.push("could not resolve PTY id for session input check");
      return result;
    }

    const pasteResult = await dispatchTerminalPaste(client, {
      scope: options.scope,
      sessionId: options.sessionId,
      text: marker,
    });

    let markerEchoedInUi = false;
    if (pasteResult.dispatched) {
      result.strategy = "paste";
      result.notes.push("dispatched terminal paste event");
      markerEchoedInUi = await waitForTerminalMarker(
        client,
        {
          scope: options.scope,
          sessionId: options.sessionId,
          marker,
        },
        Math.min(options.timeoutMs, 4_000),
      );
    } else {
      result.notes.push(
        `terminal paste dispatch failed: ${pasteResult.reason ?? "unknown reason"}`,
      );
    }

    if (!markerEchoedInUi && options.allowHelperFallback) {
      try {
        await sendRuntimePtyInputViaWs(client, runtimeContext, ptyId, marker);
        result.strategy = "pty-input-ws";
        result.notes.push(
          "sent marker through page-level PTY input websocket helper",
        );
      } catch (error) {
        result.status = "failed";
        result.notes.push(
          `PTY input websocket helper failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return result;
      }

      markerEchoedInUi = await waitForTerminalMarker(
        client,
        {
          scope: options.scope,
          sessionId: options.sessionId,
          marker,
        },
        Math.min(options.timeoutMs, 4_000),
      );
    } else if (!markerEchoedInUi) {
      result.notes.push(
        "UI paste did not produce a visible echo; helper fallback is disabled for this charter path",
      );
    }

    result.status = markerEchoedInUi ? "passed" : "failed";
    result.notes.push(
      markerEchoedInUi
        ? "terminal echoed marker inside the target UI scope after input"
        : "terminal did not echo marker inside the target UI scope after input",
    );

    try {
      await sendRuntimePtyInputViaWs(
        client,
        runtimeContext,
        ptyId,
        "\u007f".repeat(marker.length),
      );
      result.notes.push(
        "attempted cleanup with backspaces over PTY input websocket helper",
      );
    } catch (error) {
      result.notes.push(
        `cleanup input failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  } catch (error) {
    result.status = "failed";
    result.notes.push("terminal input exercise threw before completion");
    result.notes.push(error instanceof Error ? error.message : String(error));
    return result;
  }
}

function buildLargePastePayload(marker: string): string {
  const prefix = `ISSUE897-LARGE-PASTE-BEGIN-${marker}-`;
  const suffix = `-ISSUE897-LARGE-PASTE-END-${marker}`;
  const targetBytes = 4_096;
  const reservedBytes = Buffer.byteLength(`${prefix}${suffix}`, "utf8");
  const fillerBytes = Math.max(0, targetBytes - reservedBytes);
  return `${prefix}${"x".repeat(fillerBytes)}${suffix}`;
}

async function verifyFullscreenTerminalPage(
  client: RawBridgeClient,
  sessionId: string,
  timeoutMs: number,
): Promise<FullscreenTerminalCheck> {
  const result: FullscreenTerminalCheck = {
    status: "skipped",
    sessionId,
    ptyId: null,
    pathname: null,
    disconnectedVisible: false,
    input: null,
    notes: [],
  };
  let enteredFullscreenRoute = false;

  try {
    await ensureSessionsView(client, timeoutMs);
    await clickBySelector(
      client,
      `[data-testid="session-card-${sessionId}"]`,
      `session card ${sessionId}`,
      timeoutMs,
    );
    const panel = await waitForSessionPanel(client, timeoutMs, {
      expectedSessionId: sessionId,
    });
    result.notes.push(
      `right panel before fullscreen: session=${panel.boundSessionId ?? "none"} pty=${panel.boundPtyId ?? "none"} terminalVisible=${String(panel.terminalVisible)} disconnectedVisible=${String(panel.disconnectedVisible)} error=${panel.terminalErrorMessage ?? "none"}`,
    );

    if (
      panel.boundSessionId !== sessionId ||
      !panel.terminalVisible ||
      panel.disconnectedVisible ||
      panel.terminalErrorMessage
    ) {
      result.status = "failed";
      result.notes.push(
        panel.boundSessionId !== sessionId
          ? "right panel remained bound to a different session before opening fullscreen"
          : "right panel did not reach a live PTY terminal state before opening fullscreen",
      );
      return result;
    }

    const { ptyId } = await resolvePtyIdForSessionId(client, sessionId);
    result.ptyId = ptyId;
    if (!ptyId) {
      result.status = "failed";
      result.notes.push("could not resolve PTY id for fullscreen verification");
      return result;
    }

    await clickBySelector(
      client,
      '[data-testid="agent-rightpanel-open-fullscreen"]',
      "right panel fullscreen button",
      timeoutMs,
    );
    enteredFullscreenRoute = true;

    const fullscreenRoute = `/agents/pty/${encodeURIComponent(ptyId)}`;
    const fullscreenState = await waitForJs<{
      pathname: string;
      backVisible: boolean;
      stopVisible: boolean;
      liveVisible: boolean;
      disconnectedVisible: boolean;
    }>(
      client,
      `(() => ({
        pathname: window.location.pathname,
        backVisible: !!document.querySelector('[data-testid="pty-terminal-page-back"]'),
        stopVisible: !!document.querySelector('[data-testid="pty-terminal-page-stop"]'),
        liveVisible: !!document.querySelector('[data-testid="pty-terminal-page-live"]'),
        disconnectedVisible: !!document.querySelector('[data-testid="pty-terminal-page-disconnected"]'),
      }))()`,
      (value) =>
        value.pathname === fullscreenRoute &&
        value.backVisible &&
        value.stopVisible &&
        (value.liveVisible || value.disconnectedVisible),
      timeoutMs,
      `fullscreen PTY route ${ptyId}`,
    );
    result.pathname = fullscreenState.pathname;
    result.disconnectedVisible = fullscreenState.disconnectedVisible;
    result.notes.push(
      `fullscreen route path=${fullscreenState.pathname} liveVisible=${String(fullscreenState.liveVisible)} disconnectedVisible=${String(fullscreenState.disconnectedVisible)} backVisible=${String(fullscreenState.backVisible)} stopVisible=${String(fullscreenState.stopVisible)}`,
    );

    if (fullscreenState.pathname !== fullscreenRoute) {
      result.status = "failed";
      result.notes.push(`fullscreen route mismatch: expected ${fullscreenRoute}`);
      return result;
    }

    const scopeSnapshot = await waitForTerminalScopeReady(
      client,
      { scope: "fullscreen-page", sessionId },
      Math.min(timeoutMs, 6_000),
    );
    result.disconnectedVisible = scopeSnapshot.disconnectedVisible;
    result.notes.push(
      `fullscreen scope: terminalVisible=${String(scopeSnapshot.terminalVisible)} loadingVisible=${String(scopeSnapshot.loadingVisible)} xtermReady=${String(scopeSnapshot.xtermReady)} disconnectedVisible=${String(scopeSnapshot.disconnectedVisible)} error=${scopeSnapshot.terminalErrorMessage ?? "none"}`,
    );

    if (
      !scopeSnapshot.terminalVisible ||
      scopeSnapshot.disconnectedVisible ||
      scopeSnapshot.terminalErrorMessage
    ) {
      result.status = "failed";
      result.notes.push(
        scopeSnapshot.disconnectedVisible
          ? "fullscreen page entered disconnected state unexpectedly"
          : "fullscreen page did not reach a live terminal surface",
      );
      return result;
    }

    result.input = await exerciseTerminalInput(client, {
      scope: "fullscreen-page",
      sessionId,
      timeoutMs,
      allowHelperFallback: true,
    });
    result.notes.push(
      `fullscreen input ${result.input.status} via ${result.input.strategy}`,
    );
    result.notes.push(...result.input.notes);

    result.status =
      fullscreenState.backVisible &&
      fullscreenState.stopVisible &&
      result.input.status === "passed"
        ? "passed"
        : "failed";

    if (!fullscreenState.backVisible || !fullscreenState.stopVisible) {
      result.notes.push("fullscreen page controls were incomplete");
    }

    return result;
  } finally {
    if (enteredFullscreenRoute) {
      const returned = await client.executeJs<boolean>(`(() => {
        const backButton = document.querySelector('[data-testid="pty-terminal-page-back"]');
        if (backButton instanceof HTMLElement) {
          backButton.click();
          return true;
        }
        if (window.location.pathname.startsWith('/agents/pty/')) {
          window.history.pushState({}, '', '/agents');
          window.dispatchEvent(new PopStateEvent('popstate'));
          return true;
        }
        return false;
      })()`);

      if (returned) {
        await ensureAgentsPageReady(client, timeoutMs);
        await ensureSessionsView(client, timeoutMs);
      }
    }
  }
}

async function exerciseLargePaste(
  client: RawBridgeClient,
  sessionId: string,
  timeoutMs: number,
): Promise<LargePasteCheck> {
  const marker = `ISSUE897-LARGE-${Date.now().toString(36).toUpperCase()}`;
  const notes: string[] = [];
  await installConsoleTap(client);
  await ensureSessionsView(client, timeoutMs);
  try {
    await clickBySelector(
      client,
      `[data-testid="session-card-${sessionId}"]`,
      `session card ${sessionId}`,
      timeoutMs,
    );
  } catch (error) {
    const summary = await collectUiSessionSummary(client).catch(() => null);
    return {
      status: "failed",
      sessionId,
      ptyId: null,
      payloadBytes: 0,
      marker,
      pasteDispatched: false,
      markerObserved: false,
      markerObservedViaWs: false,
      inputProbe: null,
      consoleEntries: await readConsoleEntries(client),
      notes: [
        `target session card disappeared before large paste validation: ${error instanceof Error ? error.message : String(error)}`,
        summary
          ? `currently visible session ids: ${summary.visibleSessionIds.join(", ") || "none"}`
          : "could not collect current visible session ids",
      ],
    };
  }
  const panel = await waitForSessionPanel(client, timeoutMs, {
    expectedSessionId: sessionId,
  });
  if (
    panel.boundSessionId !== sessionId ||
    !panel.terminalVisible ||
    panel.disconnectedVisible ||
    panel.terminalErrorMessage
  ) {
    return {
      status: "failed",
      sessionId,
      ptyId: null,
      payloadBytes: 0,
      marker,
      pasteDispatched: false,
      markerObserved: false,
      markerObservedViaWs: false,
      inputProbe: null,
      consoleEntries: await readConsoleEntries(client),
      notes: [
        panel.boundSessionId !== sessionId
          ? `right panel was still bound to ${panel.boundSessionId ?? "none"} before large paste`
          : "session did not reach a usable right-panel terminal before large paste",
        `terminalVisible=${String(panel.terminalVisible)}`,
        `disconnectedVisible=${String(panel.disconnectedVisible)}`,
        `panelPty=${panel.boundPtyId ?? "none"}`,
        `terminalError=${panel.terminalErrorMessage ?? "none"}`,
      ],
    };
  }

  const scopeSnapshot = await waitForTerminalScopeReady(
    client,
    { scope: "right-panel", sessionId },
    Math.min(timeoutMs, 6_000),
  );
  notes.push(
    `large paste preflight: terminalVisible=${String(scopeSnapshot.terminalVisible)} loadingVisible=${String(scopeSnapshot.loadingVisible)} xtermReady=${String(scopeSnapshot.xtermReady)} reconnecting=${String(scopeSnapshot.outputReconnectVisible)} inputError=${String(scopeSnapshot.inputErrorVisible)} disconnected=${String(scopeSnapshot.disconnectedVisible)} error=${scopeSnapshot.terminalErrorMessage ?? "none"}`,
  );
  if (
    !scopeSnapshot.terminalVisible ||
    scopeSnapshot.disconnectedVisible ||
    scopeSnapshot.outputReconnectVisible ||
    scopeSnapshot.inputErrorVisible ||
    scopeSnapshot.terminalErrorMessage
  ) {
    return {
      status: "failed",
      sessionId,
      ptyId: null,
      payloadBytes: 0,
      marker,
      pasteDispatched: false,
      markerObserved: false,
      markerObservedViaWs: false,
      inputProbe: null,
      consoleEntries: await readConsoleEntries(client),
      notes: [
        ...notes,
        "right-panel terminal was not fully writable before large paste",
      ],
    };
  }

  const { runtimeContext, ptyId } = await resolvePtyIdForSessionId(
    client,
    sessionId,
  );
  if (!ptyId) {
    return {
      status: "failed",
      sessionId,
      ptyId: null,
      payloadBytes: 0,
      marker,
      pasteDispatched: false,
      markerObserved: false,
      markerObservedViaWs: false,
      inputProbe: null,
      consoleEntries: await readConsoleEntries(client),
      notes: ["could not resolve PTY id for large paste exercise"],
    };
  }

  const payload = buildLargePastePayload(marker);
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  const pasteResult = await dispatchTerminalPaste(client, {
    scope: "right-panel",
    sessionId,
    text: payload,
  });
  if (!pasteResult.dispatched) {
    notes.push(`terminal paste dispatch failed: ${pasteResult.reason ?? "unknown reason"}`);
    return {
      status: "failed",
      sessionId,
      ptyId,
      payloadBytes,
      marker,
      pasteDispatched: false,
      markerObserved: false,
      markerObservedViaWs: false,
      inputProbe: null,
      consoleEntries: await readConsoleEntries(client),
      notes,
    };
  }

  notes.push(`dispatched ${payloadBytes} bytes via UI paste`);
  const outputProbeTimeoutMs = Math.min(Math.max(timeoutMs, 4_000), 8_000);
  let markerObservedInUi = await waitForTerminalMarker(
    client,
    {
      scope: "right-panel",
      sessionId,
      marker,
    },
    outputProbeTimeoutMs,
  );
  let markerObservedViaWs = false;
  if (!markerObservedInUi) {
    try {
      markerObservedViaWs = await waitForPtyOutputMarkerViaWs(client, {
        runtimeContext,
        ptyId,
        marker,
        timeoutMs: outputProbeTimeoutMs,
      });
      notes.push(
        markerObservedViaWs
          ? "large paste marker was confirmed by a dedicated PTY output websocket probe"
          : "large paste marker was not observed by the dedicated PTY output websocket probe",
      );
    } catch (error) {
      notes.push(
        `large paste output websocket probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  notes.push(
    markerObservedInUi
      ? "large paste marker became visible inside the right-panel terminal"
      : "large paste marker did not become visible inside the right-panel terminal",
  );
  const inputProbe = await exerciseTerminalInput(client, {
    scope: "right-panel",
    sessionId,
    timeoutMs: Math.min(Math.max(timeoutMs, 4_000), 8_000),
    allowHelperFallback: true,
  });
  notes.push(`post-paste input probe ${inputProbe.status} via ${inputProbe.strategy}`);
  notes.push(...inputProbe.notes);
  const consoleEntries = await readConsoleEntries(client);
  const ptyProblemEntries = collectPtyProblemConsoleEntries(consoleEntries);
  if (ptyProblemEntries.length > 0) {
    notes.push(
      ...ptyProblemEntries.map(
        (entry) => `PTY console issue [${entry.level}] ${entry.text}`,
      ),
    );
  }

  return {
    status:
      (markerObservedInUi || markerObservedViaWs) &&
      inputProbe.status === "passed" &&
      ptyProblemEntries.length === 0
        ? "passed"
        : "failed",
    sessionId,
    ptyId,
    payloadBytes,
    marker,
    pasteDispatched: true,
    markerObserved: markerObservedInUi,
    markerObservedViaWs,
    inputProbe,
    consoleEntries,
    notes,
  };
}

async function verifyTiledIsolationChecks(
  client: RawBridgeClient,
  activeSessionIds: string[],
  timeoutMs: number,
): Promise<TiledViewCheck["isolationChecks"]> {
  if (activeSessionIds.length < 2) {
    return [];
  }

  const results: TiledViewCheck["isolationChecks"] = [];

  for (const sourceSessionId of activeSessionIds) {
    const otherSessionIds = activeSessionIds.filter(
      (candidate) => candidate !== sourceSessionId,
    );
    const marker = `ISSUE897-TILED-${sourceSessionId.slice(0, 6)}-${Date.now().toString(36).toUpperCase()}`;
    const sourceScope = await waitForTerminalScopeReady(
      client,
      { scope: "tiled-pane", sessionId: sourceSessionId },
      Math.min(timeoutMs, 4_000),
    );
    if (!sourceScope.terminalVisible || !sourceScope.xtermReady) {
      for (const otherSessionId of otherSessionIds) {
        results.push({
          sourceSessionId,
          otherSessionId,
          marker,
          status: "failed",
          notes: ["source tiled pane was not ready for isolation check"],
        });
      }
      continue;
    }

    const pasteResult = await dispatchTerminalPaste(client, {
      scope: "tiled-pane",
      sessionId: sourceSessionId,
      text: marker,
    });
    if (!pasteResult.dispatched) {
      for (const otherSessionId of otherSessionIds) {
        results.push({
          sourceSessionId,
          otherSessionId,
          marker,
          status: "failed",
          notes: [
            `terminal paste dispatch failed: ${pasteResult.reason ?? "unknown reason"}`,
          ],
        });
      }
      continue;
    }

    const sourceObserved = await waitForTerminalMarker(
      client,
      {
        scope: "tiled-pane",
        sessionId: sourceSessionId,
        marker,
      },
      Math.min(timeoutMs, 4_000),
    );
    await Bun.sleep(500);
    for (const otherSessionId of otherSessionIds) {
      const notes: string[] = [];
      const otherScope = await waitForTerminalScopeReady(
        client,
        { scope: "tiled-pane", sessionId: otherSessionId },
        Math.min(timeoutMs, 4_000),
      );
      if (!otherScope.terminalVisible || !otherScope.xtermReady) {
        results.push({
          sourceSessionId,
          otherSessionId,
          marker,
          status: "failed",
          notes: ["comparison tiled pane was not ready for isolation check"],
        });
        continue;
      }

      const otherObserved = await terminalScopeContainsMarker(client, {
        scope: "tiled-pane",
        sessionId: otherSessionId,
        needle: marker,
      });

      notes.push(
        sourceObserved
          ? "source tiled pane displayed the marker"
          : "source tiled pane did not display the marker",
      );
      notes.push(
        otherObserved
          ? "comparison tiled pane unexpectedly displayed the marker"
          : "comparison tiled pane stayed clean",
      );
      results.push({
        sourceSessionId,
        otherSessionId,
        marker,
        status: sourceObserved && !otherObserved ? "passed" : "failed",
        notes,
      });
    }
  }

  return results;
}

async function detectTerminalLoadingDuringTransition(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const loadingVisible = await client.executeJs<boolean>(
      `(() => !!document.querySelector('[data-testid="pty-terminal-loading"]'))()`,
    );
    if (loadingVisible) {
      return true;
    }
    await Bun.sleep(50);
  }

  return false;
}

async function exerciseSessionCard(
  client: RawBridgeClient,
  sessionId: string,
  expectation: "active" | "completed",
  target: "session-card" | "topology-node",
  selector: string,
  timeoutMs: number,
  options: {
    verifyInput?: boolean;
  } = {},
): Promise<SessionCardExerciseResult> {
  await installConsoleTap(client);
  const loadingPromise = detectTerminalLoadingDuringTransition(
    client,
    Math.min(timeoutMs, 1500),
  );
  try {
    await clickBySelector(client, selector, selector);
  } catch (error) {
    return {
      target,
      sessionId,
      expectation,
      status: "failed",
      loadingObserved: await loadingPromise,
      terminalVisible: false,
      disconnectedVisible: false,
      disconnectedMessage: null,
      terminalErrorMessage: null,
      consoleEntries: await readConsoleEntries(client),
      input: null,
      notes: [
        "target session card/node disappeared before the charter could click it",
        error instanceof Error ? error.message : String(error),
      ],
    };
  }
  const panel = await waitForSessionPanel(client, timeoutMs, {
    expectedSessionId: expectation === "active" ? sessionId : undefined,
  });
  const loadingObserved = await loadingPromise;
  const consoleEntries = await readConsoleEntries(client);
  const ptyProblemEntries = collectPtyProblemConsoleEntries(consoleEntries);
  const notes: string[] = [];
  const shouldVerifyInput =
    options.verifyInput === true && expectation === "active";
  const expectedPtyId =
    expectation === "active"
      ? (
          await resolvePtyIdForSessionId(client, sessionId).catch(() => ({
            ptyId: null,
          }))
        ).ptyId
      : null;

  if (loadingObserved) {
    notes.push("observed terminal loading indicator");
  }
  notes.push(
    `right panel binding session=${panel.boundSessionId ?? "none"} pty=${panel.boundPtyId ?? "none"} host=${panel.boundHostId ?? "none"}`,
  );
  if (panel.terminalVisible) {
    notes.push("right panel terminal container became visible");
  }
  if (panel.disconnectedVisible) {
    notes.push("right panel showed disconnected history/failure state");
  }
  if (panel.disconnectedMessage) {
    notes.push(`ui failure message: ${panel.disconnectedMessage}`);
  }
  if (panel.terminalErrorMessage) {
    notes.push(`terminal overlay error: ${panel.terminalErrorMessage}`);
  }

  const hasAgentHubPtyTrace = consoleEntries.some((entry) =>
    entry.text.includes("[agent-hub][pty][open]"),
  );
  if (hasAgentHubPtyTrace) {
    notes.push("console emitted [agent-hub][pty][open] trace");
  }
  if (ptyProblemEntries.length > 0) {
    notes.push(
      `console recorded ${ptyProblemEntries.length} PTY problem entr${ptyProblemEntries.length === 1 ? "y" : "ies"}`,
    );
  }

  const inputResult =
    shouldVerifyInput && panel.terminalVisible && !panel.terminalErrorMessage
      ? await exerciseTerminalInput(client, {
          scope: "right-panel",
          sessionId,
          timeoutMs,
          allowHelperFallback: true,
        })
      : shouldVerifyInput
        ? buildSkippedTerminalInputResult(
            "right-panel",
            sessionId,
            panel.terminalErrorMessage
              ? `terminal already showed explicit error: ${panel.terminalErrorMessage}`
              : "session did not reach a live right-panel terminal state",
          )
        : null;
  if (inputResult) {
    notes.push(
      `terminal input ${inputResult.status} via ${inputResult.strategy}`,
    );
    if (inputResult.marker) {
      notes.push(`input marker: ${inputResult.marker}`);
    }
    notes.push(...inputResult.notes);
  }

  const hasExplicitFailureUi =
    Boolean(panel.disconnectedVisible && panel.disconnectedMessage) ||
    Boolean(panel.terminalErrorMessage);
  const hasUsableTerminal =
    panel.terminalVisible && !panel.terminalErrorMessage;
  const bindingMatches =
    expectation !== "active" ||
    (panel.boundSessionId === sessionId &&
      (!expectedPtyId || panel.boundPtyId === expectedPtyId));
  const passed =
    expectation === "active"
      ? bindingMatches &&
        hasUsableTerminal &&
        !panel.disconnectedVisible &&
        hasAgentHubPtyTrace
      : (hasExplicitFailureUi || panel.disconnectedVisible) &&
        (!panel.disconnectedVisible || !!panel.disconnectedMessage) &&
        hasAgentHubPtyTrace;
  const inputPassed =
    !shouldVerifyInput
      ? true
      : hasUsableTerminal && inputResult?.status === "passed";

  if (!hasAgentHubPtyTrace) {
    notes.push("missing [agent-hub][pty][open] trace");
  }
  if (!bindingMatches) {
    notes.push(
      `right panel binding mismatch: expected session=${sessionId} pty=${expectedPtyId ?? "none"}`,
    );
  }
  if (ptyProblemEntries.length > 0) {
    notes.push(
      ...ptyProblemEntries.map(
        (entry) => `PTY console issue [${entry.level}] ${entry.text}`,
      ),
    );
  }
  if (panel.disconnectedVisible && !panel.disconnectedMessage) {
    notes.push("disconnected state missing explicit failure message");
  }
  if (expectation === "active" && panel.disconnectedVisible) {
    notes.push("active session unexpectedly fell back to disconnected/history UI");
  }
  if (panel.terminalVisible && panel.terminalErrorMessage) {
    notes.push(
      "live terminal container fell back to explicit terminal error overlay",
    );
  }
  if (
    hasUsableTerminal &&
    shouldVerifyInput &&
    inputResult?.status !== "passed"
  ) {
    notes.push("live terminal did not pass input echo verification");
  }

  return {
    target,
    sessionId,
    expectation,
    status:
      passed && inputPassed && ptyProblemEntries.length === 0
        ? "passed"
        : "failed",
    loadingObserved,
    terminalVisible: panel.terminalVisible,
    disconnectedVisible: panel.disconnectedVisible,
    disconnectedMessage: panel.disconnectedMessage,
    terminalErrorMessage: panel.terminalErrorMessage,
    consoleEntries,
    input: inputResult,
    notes,
  };
}

async function checkProposalInboxPage(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<ProposalPageCheck> {
  await navigateToRoute(client, "/proposals", timeoutMs);

  const state = await waitForJs<ProposalPageCheck>(
    client,
    `(() => ({
      status: 'failed',
      href: window.location.href,
      loading: document.body ? ((document.body.textContent ?? '').includes('请求箱加载中...')) : false,
      page: !!document.querySelector('[data-testid="proposal-inbox-page"]'),
      snippet: document.body ? ((document.body.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 320) || null) : null,
    }))()`,
    (value) => value.page && !value.loading,
    timeoutMs,
    "proposal inbox page",
  );

  return {
    ...state,
    status: state.page && !state.loading ? "passed" : "failed",
  };
}

async function verifyTiledViewBehavior(
  client: RawBridgeClient,
  activeSessionIds: string[],
  timeoutMs: number,
): Promise<TiledViewCheck> {
  await installConsoleTap(client);
  const preparation = await prepareTiledViewForConcurrentSessions(
    client,
    activeSessionIds,
    timeoutMs,
  );
  const requestedSessionIds = preparation.requestedSessionIds;
  const routedSessionIds = preparation.routedSessionIds;
  const missingRequestedSessionIds = requestedSessionIds.filter(
    (sessionId) => !routedSessionIds.includes(sessionId),
  );
  const initialState = await collectTiledViewState(client);
  let loadingObserved = initialState.loadingCount > 0;
  const loadingStartedAt = Date.now();
  while (
    !loadingObserved &&
    Date.now() - loadingStartedAt < Math.min(timeoutMs, 1500)
  ) {
    await Bun.sleep(50);
    loadingObserved = (await collectTiledViewState(client)).loadingCount > 0;
  }
  await Bun.sleep(500);
  const settledState = await collectTiledViewState(client);
  const inputChecks: TerminalInputExerciseResult[] = [];
  for (const sessionId of routedSessionIds) {
    inputChecks.push(
      await exerciseTerminalInput(client, {
        scope: "tiled-pane",
        sessionId,
        timeoutMs,
        allowHelperFallback: true,
      }),
    );
  }
  const isolationChecks = await verifyTiledIsolationChecks(
    client,
    routedSessionIds,
    timeoutMs,
  );
  const clickResult = await client.executeJs<{ clicked: boolean }>(
    `(() => {
      const sessionIds = ${JSON.stringify(routedSessionIds)};
      const candidates = sessionIds.flatMap((sessionId) => ([
        document.querySelector('[data-testid="tiled-grid-stop-' + sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-archive-' + sessionId + '"]'),
        document.querySelector('[data-testid="tiled-grid-pty-disconnected-' + sessionId + '"]'),
      ])).filter(Boolean);

      const anchor = candidates[0];
      if (!(anchor instanceof HTMLElement)) {
        return { clicked: false };
      }

      const pane = anchor.closest('[data-testid^="tiled-slot-"]');
      if (!(pane instanceof HTMLElement)) {
        return { clicked: false };
      }

      pane.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { clicked: true };
    })()`,
  );
  await Bun.sleep(300);
  const afterClickState = await collectTiledViewState(client);

  const paneRectsStable =
    JSON.stringify(settledState.paneRects) ===
    JSON.stringify(afterClickState.paneRects);
  const rightPanelVisible = afterClickState.rightPanelVisible;
  const requiredConcurrentTerminalCount = REQUIRED_CONCURRENT_TILED_TERMINALS;
  const concurrentTerminalPreconditionMet =
    requestedSessionIds.length >= requiredConcurrentTerminalCount;
  const concurrentTerminalTargetMet =
    concurrentTerminalPreconditionMet &&
    missingRequestedSessionIds.length === 0 &&
    afterClickState.liveTerminalCount >= requiredConcurrentTerminalCount;
  const consoleEntries = await readConsoleEntries(client);
  const ptyProblemEntries = collectPtyProblemConsoleEntries(consoleEntries);
  const notes = [
    ...preparation.notes,
    loadingObserved
      ? `observed ${initialState.loadingCount} tiled loading overlay(s)`
      : "no tiled loading overlay observed during first sample",
    `required concurrent live terminals: ${requiredConcurrentTerminalCount}`,
    concurrentTerminalPreconditionMet
      ? "concurrent tiled precondition met before verification"
      : `concurrent tiled precondition unmet before verification: only ${requestedSessionIds.length} stable session(s) were available for a ${requiredConcurrentTerminalCount}-terminal target`,
    `active sessions requested for tiled verification: ${activeSessionIds.length}`,
    `requested distinct session ids: ${requestedSessionIds.join(", ") || "none"}`,
    `active sessions routed into tiled verification: ${routedSessionIds.length}`,
    `routed session ids: ${routedSessionIds.join(", ") || "none"}`,
    `missing requested session ids after tiled preparation: ${missingRequestedSessionIds.join(", ") || "none"}`,
    `live terminals in tiled view: ${afterClickState.liveTerminalCount}`,
    `concurrent live terminal target met: ${String(concurrentTerminalTargetMet)}`,
    `disconnected panes in tiled view: ${afterClickState.disconnectedPaneCount}`,
    ...inputChecks.map(
      (check) =>
        `tiled input ${check.sessionId}: ${check.status} via ${check.strategy}${check.marker ? ` (${check.marker})` : ""}`,
    ),
    ...isolationChecks.map(
      (check) =>
        `tiled isolation ${check.sourceSessionId}->${check.otherSessionId}: ${check.status} (${check.notes.join("; ") || "no notes"})`,
    ),
    clickResult.clicked
      ? "clicked a tiled pane root"
      : "could not locate an interactive tiled pane root to click",
    paneRectsStable
      ? "tiled pane rectangles stayed stable after click"
      : "tiled pane rectangles changed after click",
    rightPanelVisible
      ? "right panel became visible while tiled view stayed active"
      : "right panel stayed closed after tiled pane click",
    ...(ptyProblemEntries.length > 0
      ? ptyProblemEntries.map(
          (entry) => `PTY console issue [${entry.level}] ${entry.text}`,
        )
      : ["no PTY console problems observed during tiled verification"]),
  ];

  return {
    status:
      afterClickState.visible &&
      !rightPanelVisible &&
      paneRectsStable &&
      concurrentTerminalTargetMet &&
      missingRequestedSessionIds.length === 0 &&
      inputChecks.every((check) => check.status === "passed") &&
      ptyProblemEntries.length === 0 &&
      isolationChecks.every((check) => check.status === "passed")
        ? "passed"
        : "failed",
    requestedSessionIds,
    routedSessionIds,
    loadingObserved,
    rightPanelVisible,
    paneRectsStable,
    liveTerminalCount: afterClickState.liveTerminalCount,
    requiredConcurrentTerminalCount,
    concurrentTerminalTargetMet,
    disconnectedPaneCount: afterClickState.disconnectedPaneCount,
    inputChecks,
    isolationChecks,
    consoleEntries,
    notes,
  };
}

async function verifyAgentViewRestorationViaTasks(
  client: RawBridgeClient,
  targetView: "topology" | "sessions" | "tiled",
  timeoutMs: number,
): Promise<CharterCheck> {
  if (targetView === "topology") {
    await ensureTopologyView(client, timeoutMs);
  } else if (targetView === "tiled") {
    await ensureTiledView(client, timeoutMs);
  } else {
    await ensureSessionsView(client, timeoutMs);
  }

  await clickBySelector(
    client,
    '[data-testid="desktop-sidebar-item-tasks"]',
    "tasks sidebar item",
  );
  await waitForJs<{ pathname: string }>(
    client,
    `(() => ({ pathname: window.location.pathname }))()`,
    (value) => value.pathname === "/tasks",
    timeoutMs,
    "tasks page",
  );
  await clickBySelector(
    client,
    '[data-testid="desktop-sidebar-item-agents"]',
    "agents sidebar item",
  );

  const expectedVisibilityCheck =
    targetView === "topology"
      ? `(() => ({
        pathname: window.location.pathname,
        storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
        visible: !!document.querySelector('[data-testid="agent-topology-view"]'),
      }))()`
      : targetView === "tiled"
        ? `(() => ({
          pathname: window.location.pathname,
          storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
          visible: !!document.querySelector('[data-testid="tiled-grid"]'),
        }))()`
        : `(() => ({
          pathname: window.location.pathname,
          storedViewMode: window.localStorage.getItem('exomind:agentHubViewMode'),
          visible: !!document.querySelector('[data-testid="sessions-view"]')
            || !!document.querySelector('[data-testid="sessions-empty-state"]'),
        }))()`;

  const state = await waitForJs<{
    pathname: string;
    storedViewMode: string | null;
    visible: boolean;
  }>(
    client,
    expectedVisibilityCheck,
    (value) => value.pathname === "/agents" && value.visible,
    timeoutMs,
    `restore ${targetView} after tasks`,
  );

  const passed = state.visible && state.storedViewMode === targetView;
  return {
    id: `restore-${targetView}-after-tasks`,
    title: `从任务页返回后恢复网络/${targetView}`,
    status: passed ? "passed" : "failed",
    notes: [
      `pathname=${state.pathname}`,
      `storedViewMode=${state.storedViewMode ?? "null"}`,
      passed
        ? `network view restored to ${targetView}`
        : `network view did not restore to ${targetView}`,
    ],
  };
}

async function verifyMultiViewRoundTrip(
  client: RawBridgeClient,
  timeoutMs: number,
): Promise<MultiViewRoundTripCheck> {
  const sequence = [
    "sessions",
    "tiled",
    "sessions",
    "topology",
    "sessions",
    "tiled",
  ];
  const notes: string[] = [];

  for (const view of sequence) {
    if (view === "sessions") {
      await ensureSessionsView(client, timeoutMs);
    } else if (view === "tiled") {
      await ensureTiledView(client, timeoutMs);
    } else {
      await ensureTopologyView(client, timeoutMs);
    }
    const state = await readAgentHubViewState(client);
    notes.push(
      `${view}: stored=${state.storedViewMode ?? "null"} path=${state.pathname}`,
    );
  }

  const finalState = await readAgentHubViewState(client);
  return {
    status:
      finalState.tiledVisible && finalState.storedViewMode === "tiled"
        ? "passed"
        : "failed",
    sequence,
    finalViewMode: finalState.storedViewMode,
    notes,
  };
}

function buildMarkdownReport(input: {
  timestamp: string;
  instance: CharterInstanceDescriptor;
  agentsPagePreflight: AgentsPagePreflightCheck;
  charterChecks: CharterCheck[];
  topologyNodeChecks: SessionCardExerciseResult[];
  uiSummary: UiSessionSummary;
  rtSummary: ReturnType<typeof summarizeRtSessions>;
  mismatches: ReturnType<typeof compareSessionSummaries>;
  activeSessionChecks: SessionCardExerciseResult[];
  completedSessionCheck: SessionCardExerciseResult | null;
  proposalInboxCheck: ProposalPageCheck;
  legacyEndpointProbe: LegacyEndpointProbe;
  largePasteCheck: LargePasteCheck;
  legacyTransportTelemetry: LegacyTransportTelemetryCheck;
  tiledViewCheck: TiledViewCheck;
  multiViewRoundTripCheck: MultiViewRoundTripCheck;
  runtimeRestartCheck: RuntimeRestartCheck;
  postRestartActiveSessionChecks: SessionCardExerciseResult[];
  postRestartTiledViewCheck: TiledViewCheck;
  preRestartRtSummarySource: "runtime-http" | "sqlite-fallback";
  overallPass: boolean;
}): string {
  const lines = [
    "# Tauri MCP Charter Report",
    "",
    `- Generated at: \`${input.timestamp}\``,
    `- Instance: \`${input.instance.name}\` (${input.instance.source})`,
    `- Web: \`http://localhost:${input.instance.webPort}\``,
    `- Raw bridge: \`ws://127.0.0.1:${input.instance.bridgePort}\``,
    `- Overall: ${input.overallPass ? "PASS" : "FAIL"}`,
    `- Pre-restart RT source: \`${input.preRestartRtSummarySource}\``,
    "",
    "## Agents Preflight",
    "",
    `- Status: ${input.agentsPagePreflight.status.toUpperCase()}`,
    `- Reloaded: \`${String(input.agentsPagePreflight.reloaded)}\``,
    `- Notes: ${input.agentsPagePreflight.notes.join("; ") || "none"}`,
    "",
    "## Charter Checks",
    "",
  ];

  for (const check of input.charterChecks) {
    lines.push(
      `- ${check.id}: ${check.status.toUpperCase()} — ${check.title} (${check.notes.join("; ") || "no notes"})`,
    );
  }

  lines.push("", "## Topology Terminal Nodes", "");

  if (input.topologyNodeChecks.length === 0) {
    lines.push("- No topology PTY nodes were detected.");
  } else {
    for (const check of input.topologyNodeChecks) {
      lines.push(
        `- Topology session \`${check.sessionId}\`: ${check.status.toUpperCase()} (${check.notes.join("; ") || "no notes"})`,
      );
    }
  }

  lines.push(
    "",
    "## Pre-Restart Session Counts",
    "",
    `- UI active/completed/total: \`${input.uiSummary.active}/${input.uiSummary.completed}/${input.uiSummary.total}\``,
    `- RT active/completed/total: \`${input.rtSummary.active}/${input.rtSummary.completed}/${input.rtSummary.total}\``,
    `- UI visible ids: ${input.uiSummary.visibleSessionIds.length > 0 ? input.uiSummary.visibleSessionIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- RT visible ids: ${input.rtSummary.visibleSessionIds.length > 0 ? input.rtSummary.visibleSessionIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    "",
    "## Pre-Restart Session Card Checks",
    "",
  );

  if (input.activeSessionChecks.length === 0) {
    lines.push(
      "- No active session cards were present in the current instance.",
    );
  } else {
    for (const check of input.activeSessionChecks) {
      lines.push(
        `- Active session \`${check.sessionId}\`: ${check.status.toUpperCase()} (input=${check.input?.status ?? "n/a"}; ${check.notes.join("; ") || "no notes"})`,
      );
    }
  }

  if (input.completedSessionCheck) {
    lines.push(
      `- Completed session \`${input.completedSessionCheck.sessionId}\`: ${input.completedSessionCheck.status.toUpperCase()} (${input.completedSessionCheck.notes.join("; ") || "no notes"})`,
    );
  } else {
    lines.push(
      "- No completed session card was present to verify the disconnected-history fallback.",
    );
  }

  lines.push(
    "",
    "## Tiled View",
    "",
    `- Status: ${input.tiledViewCheck.status.toUpperCase()}`,
    `- Loading observed: \`${String(input.tiledViewCheck.loadingObserved)}\``,
    `- Right panel visible while tiled: \`${String(input.tiledViewCheck.rightPanelVisible)}\``,
    `- Pane rects stable after click: \`${String(input.tiledViewCheck.paneRectsStable)}\``,
    `- Required concurrent live terminals: \`${input.tiledViewCheck.requiredConcurrentTerminalCount}\``,
    `- Live terminal count: \`${input.tiledViewCheck.liveTerminalCount}\``,
    `- Concurrent live target met: \`${String(input.tiledViewCheck.concurrentTerminalTargetMet)}\``,
    `- Disconnected pane count: \`${input.tiledViewCheck.disconnectedPaneCount}\``,
    `- Notes: ${input.tiledViewCheck.notes.join("; ") || "none"}`,
  );
  if (input.tiledViewCheck.inputChecks.length === 0) {
    lines.push("- No tiled terminal input checks were executed.");
  } else {
    for (const check of input.tiledViewCheck.inputChecks) {
      lines.push(
        `- Tiled input \`${check.sessionId}\`: ${check.status.toUpperCase()} via \`${check.strategy}\` (${check.notes.join("; ") || "no notes"})`,
      );
    }
  }
  if (input.tiledViewCheck.isolationChecks.length === 0) {
    lines.push("- No tiled isolation checks were executed.");
  } else {
    for (const check of input.tiledViewCheck.isolationChecks) {
      lines.push(
        `- Tiled isolation \`${check.sourceSessionId}\` -> \`${check.otherSessionId}\`: ${check.status.toUpperCase()} (${check.notes.join("; ") || "no notes"})`,
      );
    }
  }
  lines.push(
    "",
    "## Multi-View Round Trip",
    "",
    `- Status: ${input.multiViewRoundTripCheck.status.toUpperCase()}`,
    `- Sequence: ${input.multiViewRoundTripCheck.sequence.join(" -> ")}`,
    `- Final stored view: \`${input.multiViewRoundTripCheck.finalViewMode ?? "null"}\``,
    `- Notes: ${input.multiViewRoundTripCheck.notes.join("; ") || "none"}`,
  );

  lines.push(
    "",
    "## Proposal Inbox",
    "",
    `- Status: ${input.proposalInboxCheck.status.toUpperCase()}`,
    `- Href: \`${input.proposalInboxCheck.href}\``,
    `- Loading visible: \`${String(input.proposalInboxCheck.loading)}\``,
  );

  if (input.proposalInboxCheck.snippet) {
    lines.push(`- Snippet: ${input.proposalInboxCheck.snippet}`);
  }

  lines.push(
    "",
    "## Legacy PTY Transport Removal",
    "",
    `- Legacy endpoint probe: ${input.legacyEndpointProbe.status.toUpperCase()} (pty=\`${input.legacyEndpointProbe.ptyId ?? "null"}\`; input=${input.legacyEndpointProbe.inputStatus ?? "n/a"}; stream=${input.legacyEndpointProbe.streamStatus ?? "n/a"})`,
    `- Legacy telemetry: ${input.legacyTransportTelemetry.status.toUpperCase()} (legacy fetch=${input.legacyTransportTelemetry.legacyFetchCalls.length}; legacy eventsource=${input.legacyTransportTelemetry.legacyEventSourceCalls.length})`,
    `- Probe notes: ${input.legacyEndpointProbe.notes.join("; ") || "none"}`,
    `- Telemetry notes: ${input.legacyTransportTelemetry.notes.join("; ") || "none"}`,
  );

  lines.push(
    "",
    "## Large Paste",
    "",
    `- Status: ${input.largePasteCheck.status.toUpperCase()}`,
    `- Session: \`${input.largePasteCheck.sessionId ?? "null"}\``,
    `- PTY: \`${input.largePasteCheck.ptyId ?? "null"}\``,
    `- Payload bytes: \`${input.largePasteCheck.payloadBytes}\``,
    `- Marker observed: \`${String(input.largePasteCheck.markerObserved)}\``,
    `- Marker observed via output WS: \`${String(input.largePasteCheck.markerObservedViaWs)}\``,
    `- Post-paste input probe: ${input.largePasteCheck.inputProbe ? `${input.largePasteCheck.inputProbe.status.toUpperCase()} via \`${input.largePasteCheck.inputProbe.strategy}\`` : "SKIPPED"}`,
    `- Notes: ${input.largePasteCheck.notes.join("; ") || "none"}`,
  );

  lines.push("", "## Pre-Restart Mismatches", "");
  if (input.mismatches.length === 0) {
    lines.push("- None");
  } else {
    for (const mismatch of input.mismatches) {
      lines.push(
        `- ${mismatch.field}: UI=${JSON.stringify(mismatch.ui)} RT=${JSON.stringify(mismatch.rt)}`,
      );
    }
  }

  lines.push(
    "",
    "## Runtime Restart",
    "",
    `- Status: ${input.runtimeRestartCheck.status.toUpperCase()}`,
    `- Recovery duration ms: \`${input.runtimeRestartCheck.recoveryDurationMs}\``,
    `- Host transition: \`${input.runtimeRestartCheck.beforeHostId ?? "none"}\` -> \`${input.runtimeRestartCheck.afterHostId ?? "none"}\``,
    `- Before UI active/completed/total: \`${input.runtimeRestartCheck.beforeUiSummary.active}/${input.runtimeRestartCheck.beforeUiSummary.completed}/${input.runtimeRestartCheck.beforeUiSummary.total}\``,
    `- After UI active/completed/total: \`${input.runtimeRestartCheck.afterUiSummary.active}/${input.runtimeRestartCheck.afterUiSummary.completed}/${input.runtimeRestartCheck.afterUiSummary.total}\``,
    `- Before RT active/completed/total: \`${input.runtimeRestartCheck.beforeRtSummary.active}/${input.runtimeRestartCheck.beforeRtSummary.completed}/${input.runtimeRestartCheck.beforeRtSummary.total}\``,
    `- After RT active/completed/total: \`${input.runtimeRestartCheck.afterRtSummary.active}/${input.runtimeRestartCheck.afterRtSummary.completed}/${input.runtimeRestartCheck.afterRtSummary.total}\``,
    `- Before PTY count: \`${input.runtimeRestartCheck.beforePtyCount}\``,
    `- After PTY count: \`${input.runtimeRestartCheck.afterPtyCount}\``,
    `- Expected distinct active identity keys: ${input.runtimeRestartCheck.expectedDistinctActiveIdentityKeys.length > 0 ? input.runtimeRestartCheck.expectedDistinctActiveIdentityKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Before canonical active session ids: ${input.runtimeRestartCheck.beforeCanonicalActiveSessionIds.length > 0 ? input.runtimeRestartCheck.beforeCanonicalActiveSessionIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Before distinct active session ids: ${input.runtimeRestartCheck.beforeDistinctActiveSessionIds.length > 0 ? input.runtimeRestartCheck.beforeDistinctActiveSessionIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Before distinct active identity keys: ${input.runtimeRestartCheck.beforeDistinctActiveIdentityKeys.length > 0 ? input.runtimeRestartCheck.beforeDistinctActiveIdentityKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After active terminal session record ids: ${input.runtimeRestartCheck.afterActiveTerminalSessionRecordIds.length > 0 ? input.runtimeRestartCheck.afterActiveTerminalSessionRecordIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After canonical active session ids: ${input.runtimeRestartCheck.afterCanonicalActiveSessionIds.length > 0 ? input.runtimeRestartCheck.afterCanonicalActiveSessionIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After canonical active identity keys: ${input.runtimeRestartCheck.afterCanonicalActiveIdentityKeys.length > 0 ? input.runtimeRestartCheck.afterCanonicalActiveIdentityKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After distinct active session ids: ${input.runtimeRestartCheck.afterDistinctActiveSessionIds.length > 0 ? input.runtimeRestartCheck.afterDistinctActiveSessionIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After distinct active identity keys: ${input.runtimeRestartCheck.afterDistinctActiveIdentityKeys.length > 0 ? input.runtimeRestartCheck.afterDistinctActiveIdentityKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After active terminal recovery keys: ${input.runtimeRestartCheck.afterActiveTerminalRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterActiveTerminalRecoveryKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After canonical active terminal recovery keys: ${input.runtimeRestartCheck.afterCanonicalActiveTerminalRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterCanonicalActiveTerminalRecoveryKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- After live PTY recovery keys: ${input.runtimeRestartCheck.afterLivePtyRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterLivePtyRecoveryKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Missing active terminal recovery keys after restart: ${input.runtimeRestartCheck.afterMissingActiveTerminalRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterMissingActiveTerminalRecoveryKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Missing canonical active identity keys after restart: ${input.runtimeRestartCheck.afterMissingCanonicalActiveIdentityKeys.length > 0 ? input.runtimeRestartCheck.afterMissingCanonicalActiveIdentityKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Missing canonical active terminal recovery keys after restart: ${input.runtimeRestartCheck.afterMissingCanonicalActiveTerminalRecoveryKeys.length > 0 ? input.runtimeRestartCheck.afterMissingCanonicalActiveTerminalRecoveryKeys.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Stale active terminal session record ids after restart: ${input.runtimeRestartCheck.afterStaleActiveTerminalSessionRecordIds.length > 0 ? input.runtimeRestartCheck.afterStaleActiveTerminalSessionRecordIds.map((value) => `\`${value}\``).join(", ") : "(none)"}`,
    `- Notes: ${input.runtimeRestartCheck.notes.join("; ") || "none"}`,
    "",
    "## Post-Restart Active Card Checks",
    "",
  );

  if (input.postRestartActiveSessionChecks.length === 0) {
    lines.push("- No active session cards were present after restart.");
  } else {
    for (const check of input.postRestartActiveSessionChecks) {
      lines.push(
        `- Active session \`${check.sessionId}\`: ${check.status.toUpperCase()} (input=${check.input?.status ?? "n/a"}; ${check.notes.join("; ") || "no notes"})`,
      );
    }
  }

  lines.push(
    "",
    "## Post-Restart Tiled View",
    "",
    `- Status: ${input.postRestartTiledViewCheck.status.toUpperCase()}`,
    `- Required concurrent live terminals: \`${input.postRestartTiledViewCheck.requiredConcurrentTerminalCount}\``,
    `- Live terminal count: \`${input.postRestartTiledViewCheck.liveTerminalCount}\``,
    `- Concurrent live target met: \`${String(input.postRestartTiledViewCheck.concurrentTerminalTargetMet)}\``,
    `- Right panel visible while tiled: \`${String(input.postRestartTiledViewCheck.rightPanelVisible)}\``,
    `- Pane rects stable after click: \`${String(input.postRestartTiledViewCheck.paneRectsStable)}\``,
    `- Disconnected pane count: \`${input.postRestartTiledViewCheck.disconnectedPaneCount}\``,
    `- Notes: ${input.postRestartTiledViewCheck.notes.join("; ") || "none"}`,
  );
  if (input.postRestartTiledViewCheck.inputChecks.length === 0) {
    lines.push("- No post-restart tiled terminal input checks were executed.");
  } else {
    for (const check of input.postRestartTiledViewCheck.inputChecks) {
      lines.push(
        `- Post-restart tiled input \`${check.sessionId}\`: ${check.status.toUpperCase()} via \`${check.strategy}\` (${check.notes.join("; ") || "no notes"})`,
      );
    }
  }
  if (input.postRestartTiledViewCheck.isolationChecks.length === 0) {
    lines.push("- No post-restart tiled isolation checks were executed.");
  } else {
    for (const check of input.postRestartTiledViewCheck.isolationChecks) {
      lines.push(
        `- Post-restart tiled isolation \`${check.sourceSessionId}\` -> \`${check.otherSessionId}\`: ${check.status.toUpperCase()} (${check.notes.join("; ") || "no notes"})`,
      );
    }
  }

  lines.push("", "## Post-Restart Mismatches", "");
  if (input.runtimeRestartCheck.afterMismatches.length === 0) {
    lines.push("- None");
  } else {
    for (const mismatch of input.runtimeRestartCheck.afterMismatches) {
      lines.push(
        `- ${mismatch.field}: UI=${JSON.stringify(mismatch.ui)} RT=${JSON.stringify(mismatch.rt)}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const directInstance = resolveDirectInstance(projectRoot, args);
  const instance: CharterInstanceDescriptor =
    directInstance ??
    (await (async () => {
      const managedInstance = await selectManagedInstance(
        projectRoot,
        args.name,
      );
      return {
        name: managedInstance.name,
        webPort: managedInstance.webPort,
        bridgePort: resolveManagedInstanceBridgePort(managedInstance.webPort),
        runtimeDbPath: path.join(
          projectRoot,
          ".tmp",
          "tauri-dev-state",
          managedInstance.name,
          "app-data",
          "runtime",
          "sessions.sqlite",
        ),
        hmrPort: managedInstance.hmrPort,
        rootPid: managedInstance.rootPid,
        source: "managed" as const,
      };
    })());
  const reportTimestamp = new Date().toISOString().replaceAll(":", "-");
  const outDir = args.outDir;
  const jsonReportPath = path.join(
    outDir,
    `${reportTimestamp}-${instance.name}.json`,
  );
  const markdownReportPath = path.join(
    outDir,
    `${reportTimestamp}-${instance.name}.md`,
  );

  const client = new RawBridgeClient(`ws://127.0.0.1:${instance.bridgePort}`);
  await client.ready();

  try {
    const markPhase = (label: string) => {
      process.stdout.write(`[charter-phase] ${label}\n`);
    };
    await navigateToRoute(client, "/agents", args.timeoutMs);
    const agentsPagePreflight = await ensureAgentsPageReady(
      client,
      args.timeoutMs,
    );
    await installConsoleTap(client);
    await installLegacyTransportTelemetry(client);
    await ensureSessionsView(client, args.timeoutMs);
    const issue818Preparation = await ensureIssue818RecoveryPreparation(
      client,
      args.timeoutMs,
      projectRoot,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          issue818Preparation,
        },
        null,
        2,
      )}\n`,
    );

    const charterChecks: CharterCheck[] = [];
    markPhase("stories:preflight");
    charterChecks.push({
      id: "preflight-1",
      title: "网络页预检可恢复到可操作状态",
      status: agentsPagePreflight.status,
      notes: agentsPagePreflight.notes,
    });
    const restoreSessionsCheck = await verifyAgentViewRestorationViaTasks(
      client,
      "sessions",
      args.timeoutMs,
    );
    charterChecks.push({
      ...restoreSessionsCheck,
      id: "story-1",
      title: "进入网络页时恢复上次使用的会话子页面",
    });

    markPhase("stories:consistency");
    await ensureSessionsView(client, args.timeoutMs);
    const {
      uiSummary,
      runtimeState: rtState,
      rtSummary: runtimeHttpSummary,
      mismatches: runtimeHttpMismatches,
    } = await waitForUiRtConsistency(client, args.timeoutMs);
    const preRestartSqliteRtSummary = trySummarizeRtSessionsFromSqlite(
      instance.runtimeDbPath,
    );
    const sqliteFallbackMismatches = preRestartSqliteRtSummary
      ? compareSessionSummaries(uiSummary, preRestartSqliteRtSummary)
      : null;
    const preRestartRtSummarySource: "runtime-http" | "sqlite-fallback" =
      runtimeHttpMismatches.length === 0
        ? "runtime-http"
        : sqliteFallbackMismatches && sqliteFallbackMismatches.length === 0
          ? "sqlite-fallback"
          : "runtime-http";
    const rtSummary =
      preRestartRtSummarySource === "sqlite-fallback" &&
      preRestartSqliteRtSummary
        ? preRestartSqliteRtSummary
        : runtimeHttpSummary;
    const mismatches = compareSessionSummaries(uiSummary, rtSummary);
    const preRestartTargets = resolveCharterActiveTerminalTargets(rtState, uiSummary);
    const plannedCharterTargets = resolvePlannedCharterTargetSessionIds({
      runtimeState: rtState,
      preparedDistinctIdentityKeys:
        issue818Preparation.activeTerminalDistinctIdentityKeys,
      fallbackDistinctSessionIds: preRestartTargets.sessionIds,
    });
    const charterActiveSessionIds = plannedCharterTargets.sessionIds;
    const charterExpectedIdentityKeys =
      resolveDistinctActiveIdentityKeysForSessionIds(
        rtState,
        charterActiveSessionIds,
      );

    markPhase("stories:topology");
    const topologyViewCheck = await ensureTopologyView(client, args.timeoutMs);
    const topologyNodeTestIds = await waitForTopologyTerminalNodeTestIds(
      client,
      charterActiveSessionIds,
      args.timeoutMs,
    );
    const missingTopologySessionIds = charterActiveSessionIds.filter(
      (sessionId) => !topologyNodeTestIds.includes(`rf__node-pty-${sessionId}`),
    );
    charterChecks.push({
      id: "story-2",
      title: "拓扑图中呈现所有活跃终端节点",
      status:
        topologyViewCheck.status === "passed" &&
        missingTopologySessionIds.length === 0
          ? "passed"
          : "failed",
      notes: [
        ...topologyViewCheck.notes,
        ...plannedCharterTargets.notes,
        ...preRestartTargets.notes,
        `detected topology PTY nodes: ${topologyNodeTestIds.length}`,
        missingTopologySessionIds.length === 0
          ? "all active sessions had topology PTY nodes"
          : `missing topology PTY nodes for: ${missingTopologySessionIds.join(", ")}`,
      ],
    });

    const topologyNodeChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of charterActiveSessionIds) {
      const selector = `[data-testid="rf__node-pty-${sessionId}"]`;
      if (!topologyNodeTestIds.includes(`rf__node-pty-${sessionId}`)) {
        topologyNodeChecks.push({
          target: "topology-node",
          sessionId,
          expectation: "active",
          status: "failed",
          loadingObserved: false,
          terminalVisible: false,
          disconnectedVisible: false,
          disconnectedMessage: null,
          terminalErrorMessage: null,
          consoleEntries: [],
          input: null,
          notes: ["missing topology PTY node"],
        });
        continue;
      }
      topologyNodeChecks.push(
        await exerciseSessionCard(
          client,
          sessionId,
          "active",
          "topology-node",
          selector,
          args.timeoutMs,
          { verifyInput: false },
        ),
      );
    }
    charterChecks.push({
      id: "story-3",
      title: "点击拓扑图终端节点可打开对应 PTY 或明确失败态",
      status: topologyNodeChecks.every((check) => check.status === "passed")
        ? "passed"
        : "failed",
      notes: topologyNodeChecks.map(
        (check) => `${check.sessionId}:${check.status}`,
      ),
    });

    markPhase("stories:session-cards");
    await ensureSessionsView(client, args.timeoutMs);
    const activeSessionChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of charterActiveSessionIds) {
      activeSessionChecks.push(
        await exerciseSessionCard(
          client,
          sessionId,
          "active",
          "session-card",
          `[data-testid="session-card-${sessionId}"]`,
          args.timeoutMs,
          { verifyInput: true },
        ),
      );
    }
    charterChecks.push({
      id: "story-4",
      title: "会话页中每张活跃会话卡都能加载对应 PTY 并接受输入回显",
      status: activeSessionChecks.every((check) => check.status === "passed")
        ? "passed"
        : "failed",
      notes: activeSessionChecks.map(
        (check) =>
          `${check.sessionId}:${check.status}:loading=${String(check.loadingObserved)}:input=${check.input?.status ?? "n/a"}`,
      ),
    });

    const fullscreenTerminalCheck = charterActiveSessionIds[0]
      ? await verifyFullscreenTerminalPage(
          client,
          charterActiveSessionIds[0]!,
          args.timeoutMs,
        )
      : ({
          status: "skipped",
          sessionId: null,
          ptyId: null,
          pathname: null,
          disconnectedVisible: false,
          input: null,
          notes: ["no active session was available for fullscreen PTY verification"],
        } satisfies FullscreenTerminalCheck);
    charterChecks.push({
      id: "story-fullscreen-1",
      title: "右侧 Terminal 进入独立页后仍绑定同一 PTY 并接受输入回显",
      status: fullscreenTerminalCheck.status,
      notes: fullscreenTerminalCheck.notes,
    });

    markPhase("stories:session-switch");
    const repeatedSessionSwitchChecks: SessionCardExerciseResult[] = [];
    if (charterActiveSessionIds.length >= 2) {
      const [firstSessionId, secondSessionId] = charterActiveSessionIds;
      repeatedSessionSwitchChecks.push(
        await exerciseSessionCard(
          client,
          firstSessionId!,
          "active",
          "session-card",
          `[data-testid="session-card-${firstSessionId}"]`,
          args.timeoutMs,
          { verifyInput: true },
        ),
      );
      repeatedSessionSwitchChecks.push(
        await exerciseSessionCard(
          client,
          secondSessionId!,
          "active",
          "session-card",
          `[data-testid="session-card-${secondSessionId}"]`,
          args.timeoutMs,
          { verifyInput: true },
        ),
      );
      repeatedSessionSwitchChecks.push(
        await exerciseSessionCard(
          client,
          firstSessionId!,
          "active",
          "session-card",
          `[data-testid="session-card-${firstSessionId}"]`,
          args.timeoutMs,
          { verifyInput: true },
        ),
      );
    }
    charterChecks.push({
      id: "story-5",
      title: "会话页来回切换活跃卡片时 PTY 可稳定重放",
      status:
        repeatedSessionSwitchChecks.length === 0
          ? "skipped"
          : repeatedSessionSwitchChecks.every(
                (check) => check.status === "passed",
              )
            ? "passed"
            : "failed",
      notes:
        repeatedSessionSwitchChecks.length === 0
          ? ["fewer than two active sessions were present"]
          : repeatedSessionSwitchChecks.map(
              (check) => `${check.sessionId}:${check.status}`,
            ),
    });

    const completedSessionCheck = uiSummary.completedSessionIds[0]
      ? await exerciseSessionCard(
          client,
          uiSummary.completedSessionIds[0]!,
          "completed",
          "session-card",
          `[data-testid="session-card-${uiSummary.completedSessionIds[0]!}"]`,
          args.timeoutMs,
          { verifyInput: false },
        )
      : null;

    const tiledViewCheck = await verifyTiledViewBehavior(
      client,
      charterActiveSessionIds,
      args.timeoutMs,
    );
    charterChecks.push({
      id: "story-6",
      title: "平铺页并行加载 3 个以上活跃 PTY 并接受输入回显",
      status: tiledViewCheck.status,
      notes: tiledViewCheck.notes,
    });
    charterChecks.push({
      id: "story-7",
      title: "点击平铺窗口时右侧 Terminal 保持关闭且布局稳定",
      status:
        !tiledViewCheck.rightPanelVisible && tiledViewCheck.paneRectsStable
          ? "passed"
          : "failed",
      notes: tiledViewCheck.notes,
    });

    markPhase("stories:proposal-navigation");
    const multiViewRoundTripCheck = await verifyMultiViewRoundTrip(
      client,
      args.timeoutMs,
    );
    charterChecks.push({
      id: "story-8",
      title: "拓扑图/会话/平铺多视图往返切换保持稳定",
      status: multiViewRoundTripCheck.status,
      notes: multiViewRoundTripCheck.notes,
    });

    const restoreTiledCheck = await verifyAgentViewRestorationViaTasks(
      client,
      "tiled",
      args.timeoutMs,
    );
    charterChecks.push({
      ...restoreTiledCheck,
      id: "story-9",
      title: "从任务页返回后恢复上次使用的平铺子页面与 PTY",
    });

    await ensureSessionsView(client, args.timeoutMs);
    const proposalInboxCheck = await checkProposalInboxPage(
      client,
      args.timeoutMs,
    );
    await navigateToRoute(client, "/agents", args.timeoutMs);
    await ensureAgentsPageReady(client, args.timeoutMs);
    await ensureSessionsView(client, args.timeoutMs);

    markPhase("stories:runtime-restart");
    const runtimeRestartCheck = await restartRuntimeAndWaitForRecovery(
      client,
      charterExpectedIdentityKeys,
      Math.max(args.timeoutMs, 30_000),
    );
    const canonicalPostRestartState = await waitForCanonicalActiveTerminalSessions(
      client,
      runtimeRestartCheck.afterCanonicalActiveSessionIds.length > 0
        ? runtimeRestartCheck.afterCanonicalActiveSessionIds.length
        : runtimeRestartCheck.afterDistinctActiveSessionIds.length,
      Math.max(args.timeoutMs, 8_000),
    );
    const postRestartActiveSessionIds =
      canonicalPostRestartState.canonicalActiveSessionIds.length > 0
        ? canonicalPostRestartState.canonicalActiveSessionIds
        : runtimeRestartCheck.afterCanonicalActiveSessionIds.length > 0
          ? runtimeRestartCheck.afterCanonicalActiveSessionIds
          : runtimeRestartCheck.afterDistinctActiveSessionIds;

    markPhase("stories:post-restart-session-cards");
    const postRestartActiveSessionChecks: SessionCardExerciseResult[] = [];
    for (const sessionId of postRestartActiveSessionIds) {
      postRestartActiveSessionChecks.push(
        await exerciseSessionCard(
          client,
          sessionId,
          "active",
          "session-card",
          `[data-testid="session-card-${sessionId}"]`,
          args.timeoutMs,
          { verifyInput: true },
        ),
      );
    }
    const postRestartTiledViewCheck = await verifyTiledViewBehavior(
      client,
      postRestartActiveSessionIds,
      args.timeoutMs,
    );
    postRestartTiledViewCheck.notes.unshift(...canonicalPostRestartState.notes);
    charterChecks.push({
      id: "story-12",
      title: "Runtime 重启后切回网络/平铺仍可并发加载 3 个以上 PTY、保持右侧关闭并接受输入回显",
      status: postRestartTiledViewCheck.status,
      notes: postRestartTiledViewCheck.notes,
    });

    const activeCountWithinLimit =
      uiSummary.active < 5 && runtimeRestartCheck.afterUiSummary.active < 5;
    markPhase("stories:large-paste");
    const largePasteCheck = postRestartActiveSessionIds[0]
      ? await exerciseLargePaste(
          client,
          postRestartActiveSessionIds[0]!,
          Math.max(args.timeoutMs, 10_000),
        )
      : ({
          status: "skipped",
          sessionId: null,
          ptyId: null,
          payloadBytes: 0,
          marker: "none",
          pasteDispatched: false,
          markerObserved: false,
          markerObservedViaWs: false,
          inputProbe: null,
          consoleEntries: [],
          notes: ["no active session remained after restart for large paste validation"],
        } satisfies LargePasteCheck);
    charterChecks.push({
      id: "story-10",
      title: "右侧 Terminal 可承受 4KB UI 粘贴并保持交互可验证",
      status: largePasteCheck.status,
      notes: largePasteCheck.notes,
    });
    charterChecks.push({
      id: "story-11",
      title: "Runtime 重启后在 3 秒内恢复 PTY 交互",
      status:
        runtimeRestartCheck.status === "passed" &&
        runtimeRestartCheck.recoveryDurationMs <= 3_000
          ? "passed"
          : "failed",
      notes: [
        ...runtimeRestartCheck.notes,
        `recoveryDurationMs=${runtimeRestartCheck.recoveryDurationMs}`,
      ],
    });
    markPhase("stories:legacy-removal");
    const legacyTransportTelemetry = await readLegacyTransportTelemetry(client);
    legacyTransportTelemetry.notes.push(
      "telemetry captured before the intentional legacy endpoint probe",
    );
    charterChecks.push({
      id: "story-legacy-2",
      title: "前端不再触发旧 PTY HTTP/SSE transport",
      status: legacyTransportTelemetry.status,
      notes: legacyTransportTelemetry.notes,
    });
    const legacyEndpointProbeSessionId =
      postRestartActiveSessionIds[0] ??
      runtimeRestartCheck.afterCanonicalActiveSessionIds[0] ??
      runtimeRestartCheck.afterUiSummary.activeSessionIds[0] ??
      uiSummary.activeSessionIds[0] ??
      null;
    const legacyEndpointProbe = legacyEndpointProbeSessionId
      ? await probeLegacyPtyEndpoints(client, legacyEndpointProbeSessionId)
      : ({
          status: "skipped",
          ptyId: null,
          inputStatus: null,
          streamStatus: null,
          notes: ["no active session was available for legacy endpoint probing"],
        } satisfies LegacyEndpointProbe);
    charterChecks.push({
      id: "story-legacy-1",
      title: "旧 PTY HTTP/SSE 端点返回 404",
      status: legacyEndpointProbe.status,
      notes: legacyEndpointProbe.notes,
    });

    const storyChecksPassed = charterChecks.every(
      (check) => check.status === "passed" || check.status === "skipped",
    );
    const activeChecksPassed = activeSessionChecks.every(
      (check) => check.status === "passed",
    );
    const postRestartActiveChecksPassed = postRestartActiveSessionChecks.every(
      (check) => check.status === "passed",
    );
    const completedCheckPassed = completedSessionCheck
      ? completedSessionCheck.status === "passed"
      : true;
    const overallPass =
      activeCountWithinLimit &&
      storyChecksPassed &&
      mismatches.length === 0 &&
      activeChecksPassed &&
      runtimeRestartCheck.status === "passed" &&
      postRestartActiveChecksPassed &&
      completedCheckPassed &&
      proposalInboxCheck.status === "passed" &&
      legacyTransportTelemetry.status === "passed" &&
      legacyEndpointProbe.status !== "failed" &&
      largePasteCheck.status !== "failed" &&
      runtimeRestartCheck.recoveryDurationMs <= 3_000;

    markPhase("report:write");
    const report = {
      generatedAt: new Date().toISOString(),
      instance,
      rawBridge: {
        url: `ws://127.0.0.1:${instance.bridgePort}`,
      },
      assertions: {
        activeCountWithinLimit,
        storyChecksPassed,
        uiRtConsistent: mismatches.length === 0,
        activeChecksPassed,
        runtimeRestartPassed: runtimeRestartCheck.status === "passed",
        postRestartActiveChecksPassed,
        completedCheckPassed,
        proposalInboxLoaded: proposalInboxCheck.status === "passed",
        legacyTransportTelemetryPassed:
          legacyTransportTelemetry.status === "passed",
        legacyEndpointProbePassed: legacyEndpointProbe.status !== "failed",
        largePastePassed: largePasteCheck.status !== "failed",
        runtimeRecoveryWithin3s: runtimeRestartCheck.recoveryDurationMs <= 3_000,
      },
      agentsPagePreflight,
      charterChecks,
      topologyNodeChecks,
      preRestartRtSummarySource,
      uiSummary,
      rtSummary,
      mismatches,
      preRestartSqliteRtSummary,
      preRestartRuntimeHttpSummary: runtimeHttpSummary,
      preRestartRuntimeHttpMismatches: runtimeHttpMismatches,
      activeSessionChecks,
      completedSessionCheck,
      proposalInboxCheck,
      legacyEndpointProbe,
      largePasteCheck,
      legacyTransportTelemetry,
      tiledViewCheck,
      multiViewRoundTripCheck,
      runtimeRestartCheck,
      postRestartActiveSessionChecks,
      postRestartTiledViewCheck,
      sqliteRtSummary: trySummarizeRtSessionsFromSqlite(instance.runtimeDbPath),
      overallPass,
    };

    await mkdir(outDir, { recursive: true });
    await writeFile(
      jsonReportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      markdownReportPath,
      buildMarkdownReport({
        timestamp: report.generatedAt,
        instance,
        agentsPagePreflight,
        charterChecks,
        topologyNodeChecks,
        uiSummary,
        rtSummary,
        mismatches,
        activeSessionChecks,
        completedSessionCheck,
        proposalInboxCheck,
        legacyEndpointProbe,
        largePasteCheck,
        legacyTransportTelemetry,
        tiledViewCheck,
        multiViewRoundTripCheck,
        runtimeRestartCheck,
        postRestartActiveSessionChecks,
        postRestartTiledViewCheck,
        preRestartRtSummarySource,
        overallPass,
      }),
      "utf8",
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          overallPass,
          instance: instance.name,
          bridgePort: instance.bridgePort,
          activeCount: runtimeRestartCheck.afterUiSummary.active,
          mismatchCount: runtimeRestartCheck.afterMismatches.length,
          jsonReportPath,
          markdownReportPath,
        },
        null,
        2,
      )}\n`,
    );

    if (!overallPass) {
      process.exitCode = 1;
    }
  } finally {
    client.close();
  }
}

await main();
