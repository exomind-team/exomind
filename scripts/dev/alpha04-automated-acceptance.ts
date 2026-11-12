import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer, type Server } from "node:net";
import path from "node:path";

const repository = process.cwd();
const candidate = "F:/ExoMind-task-artifacts/2026-11-11/candidates/0.6.0-alpha04/exomind-0.6.0-alpha04.exe";
const candidateSha256 = "2c8cf0fc706b63b45440b12a5d0b84365b1aead10e897b6ea165d045f6adf009";
const runId = `alpha04-auto-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const artifactRoot = path.join("F:/ExoMind-task-artifacts/2026-11-12/alpha04-automated", runId);
const reportPath = path.join(artifactRoot, "report.json");

type Check = {
  name: string;
  passed: boolean;
  detail?: unknown;
};

type Instance = {
  name: string;
  root: string;
  child: ChildProcess;
  cdpPort: number;
  bridgePort: number;
  decoy: Server;
  logPath: string;
};

class CdpSession {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();

  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: unknown;
      };
      if (!message.id) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timeout);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timeout);
        entry.reject(new Error("CDP closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(target: { webSocketDebuggerUrl: string }) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP socket error")), { once: true });
    });
    const session = new CdpSession(socket);
    await session.request("Runtime.enable");
    await session.request("Page.enable");
    return session;
  }

  request(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string) {
    const output = await this.request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (output.exceptionDetails) throw new Error(JSON.stringify(output.exceptionDetails));
    return output.result.value;
  }

  close() {
    this.socket.close();
  }
}

class BridgeClient {
  private socket: WebSocket;
  private counter = 0;
  private pending = new Map<
    string,
    {
      resolve: (value: { success: boolean; data?: unknown; error?: string }) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private opened: Promise<void>;

  constructor(private readonly url: string) {
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error(`bridge socket failed: ${url}`)), {
        once: true,
      });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: string;
        success?: boolean;
        data?: unknown;
        error?: string;
      };
      const entry = message.id ? this.pending.get(message.id) : undefined;
      if (!entry) return;
      this.pending.delete(message.id!);
      clearTimeout(entry.timeout);
      if (message.success) entry.resolve({ success: true, data: message.data });
      else entry.reject(new Error(message.error ?? "bridge command failed"));
    });
    this.socket.addEventListener("close", () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timeout);
        entry.reject(new Error("bridge socket closed"));
      }
      this.pending.clear();
    });
  }

  async executeJs<T>(windowLabel: string, script: string, timeoutMs = 10000) {
    await this.opened;
    const id = `auto-${++this.counter}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bridge timeout: ${windowLabel}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (response) => resolve(response.data as T),
        reject,
        timeout,
      });
      this.socket.send(
        JSON.stringify({
          id,
          command: "execute_js",
          args: { windowLabel, script },
        }),
      );
    });
  }

  close() {
    this.socket.close();
  }
}

const checks: Check[] = [];
const stages: Array<{ stage: string; at: string; detail?: unknown }> = [];

function recordStage(stage: string, detail?: unknown) {
  stages.push({ stage, at: new Date().toISOString(), detail });
}

function check(name: string, condition: boolean, detail?: unknown) {
  checks.push({ name, passed: condition, detail });
  if (!condition) throw new Error(`assertion failed: ${name}`);
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T | false>, timeoutMs: number, label: string): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value as T;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${label} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

function isPortOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 300);
  });
}

async function findFreePort(start: number) {
  for (let port = start; port < start + 300; port += 1) {
    const server = createServer();
    const free = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (free) {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      return port;
    }
  }
  throw new Error(`no free port from ${start}`);
}

async function holdDecoy(port: number) {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return server;
}

async function closeServer(server: Server | undefined) {
  if (!server || !server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function readSqliteRows(root: string, database: string, query: string, profileId: string) {
  const dbPath = path.join(root, "runtime", database);
  const python = [
    "import json, sqlite3, sys",
    "conn = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)",
    "rows = conn.execute(sys.argv[2], (sys.argv[3],)).fetchall()",
    "conn.close()",
    "print(json.dumps(rows))",
  ].join("\n");
  return JSON.parse(execFileSync("python", ["-c", python, dbPath, query, profileId], { encoding: "utf8" })) as any[];
}

async function cdpTargets(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return (await response.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
}

async function connectPage(port: number, predicate: (target: { url: string }) => boolean) {
  const target = await waitFor(
    async () => (await cdpTargets(port)).find((item) => item.type === "page" && predicate(item)),
    20000,
    `CDP target on ${port}`,
  );
  return CdpSession.connect(target);
}

async function launchInstance(options: {
  name: string;
  root: string;
  cdpPort: number;
  bridgePort: number;
  decoy: Server;
}) {
  const { name, root, cdpPort, bridgePort, decoy } = options;
  mkdirSync(root, { recursive: true });
  const decoyDir = path.join(root, "ignored-environment");
  mkdirSync(decoyDir, { recursive: true });
  writeFileSync(
    path.join(decoyDir, "routes.json"),
    JSON.stringify([{ topic: "must.not.load", target_type: "frontend", target_ref: "test" }]),
    "utf8",
  );

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    EXOMIND_DEV_APP_DATA_DIR: path.join(root, "app-data"),
    EXOMIND_DEV_RUNTIME_DATA_DIR: path.join(root, "runtime"),
    EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR: path.join(root, "webview-main"),
    EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT: path.join(root, "webview-overlay"),
    EXOMIND_RT_PORT: "9124",
    EXOMIND_MCP_BRIDGE_BASE_PORT: String(bridgePort),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
    EXOMIND_RT_DATA_DIR: decoyDir,
    EXOMIND_RT_HOST_ID: `ignored-${name}`,
    EXOMIND_RT_MESH_STATE_PATH: path.join(decoyDir, "mesh.json"),
    EXOMIND_RT_SIGNAL_ROUTES_DEFAULT: path.join(decoyDir, "routes.json"),
  };
  for (const key of [
    "SIGNAL_SQLITE",
    "EVENTLOG_SQLITE",
    "TASK_SQLITE",
    "TIMEBLOCK_SQLITE",
    "SESSION_SQLITE",
    "CONFIG_SQLITE",
    "REMINDER_SQLITE",
  ]) {
    environment[`EXOMIND_RT_${key}_PATH`] = path.join(decoyDir, `${key.toLowerCase()}.sqlite`);
  }

  const logPath = path.join(root, "automation.log");
  const log = openSync(logPath, "a");
  const child = spawn(candidate, [], {
    cwd: repository,
    env: environment,
    detached: false,
    windowsHide: false,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  if (!child.pid) throw new Error(`failed to launch ${name}`);
  writeFileSync(
    path.join(root, "launch.json"),
    JSON.stringify(
      {
        name,
        root,
        executable: candidate,
        pid: child.pid,
        cdpPort,
        bridgePort,
        requestedRtPort: 9124,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  recordStage("launch", { name, root, pid: child.pid, cdpPort, bridgePort });
  return { name, root, child, cdpPort, bridgePort, decoy, logPath } satisfies Instance;
}

async function waitForExit(child: ChildProcess, timeoutMs = 20000) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("instance did not exit")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 0);
    });
  });
}

async function getRuntime(cdp: CdpSession) {
  return waitFor(
    async () => {
      const status = await cdp.evaluate(
        `(async () => { try { return await window.__TAURI_INTERNALS__.invoke('runtime_service_status'); } catch { return null; } })()`,
      );
      return status?.running ? status : false;
    },
    25000,
    "runtime status",
  );
}

async function getMainValue<T>(cdp: CdpSession, expression: string) {
  return (await cdp.evaluate(expression)) as T;
}

async function createProfile(cdp: CdpSession, slug: string) {
  const password = `Auto-${randomUUID()}`;
  await waitFor(
    async () => cdp.evaluate(`!!document.querySelector('[data-testid="desktop-sidebar-account-entry"]')`),
    15000,
    "account entry",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="desktop-sidebar-account-entry"]').click()`);
  await waitFor(
    async () =>
      cdp.evaluate(
        `Array.from(document.querySelectorAll('[role="dialog"] button, dialog button')).some((b) => (b.innerText || '').includes('去创建'))`,
      ),
    5000,
    "create profile entry",
  );
  await cdp.evaluate(
    `Array.from(document.querySelectorAll('[role="dialog"] button, dialog button')).find((b) => (b.innerText || '').includes('去创建')).click()`,
  );
  await waitFor(
    async () => cdp.evaluate(`document.querySelectorAll('[role="dialog"] input, dialog input').length >= 3`),
    5000,
    "profile inputs",
  );
  await cdp.evaluate(`(() => {
    const inputs = Array.from(document.querySelectorAll('[role="dialog"] input, dialog input'));
    const values = ${JSON.stringify([slug, password, password])};
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputs.slice(0, 3).forEach((input, index) => {
      setter.call(input, values[index]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const create = Array.from(document.querySelectorAll('[role="dialog"] button, dialog button')).find((b) => (b.innerText || '').trim() === '创建档案');
    if (!create) return false;
    create.click();
    return true;
  })()`);
  const session = await waitFor(
    async () =>
      getMainValue<{ activeProfileId?: string } | null>(
        cdp,
        `(() => { try { return JSON.parse(localStorage.getItem('exomind:profile-session') || 'null'); } catch { return null; } })()`,
      ),
    15000,
    "profile session",
  );
  if (!session.activeProfileId) throw new Error("profile session missing activeProfileId");
  return { profileId: session.activeProfileId, slug };
}

async function apiJson(runtimePort: number, method: string, route: string, profileId: string, body?: unknown) {
  const url = `http://127.0.0.1:${runtimePort}${route}${route.includes("?") ? "&" : "?"}user_id=${encodeURIComponent(profileId)}`;
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value: any = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}

function asArray(value: any) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

async function verifyRuntimeDb(root: string, profileId: string, marker: string) {
  const runtimeDir = path.join(root, "runtime");
  const decoyDir = path.join(root, "ignored-environment");
  const sqliteFiles = readdirSync(runtimeDir).filter((name) => name.endsWith(".sqlite"));
  const decoySqlite = readdirSync(decoyDir).filter((name) => name.endsWith(".sqlite"));
  check("runtime databases live under isolated root", sqliteFiles.length > 0, sqliteFiles);
  check("decoy database paths stay empty", decoySqlite.length === 0, decoySqlite);
  const eventDb = path.join(runtimeDir, "eventlog.sqlite");
  check("eventlog sqlite exists", existsSync(eventDb), eventDb);
  if (existsSync(eventDb)) {
    const raw = readFileSync(eventDb);
    check("eventlog db contains marker bytes", raw.includes(Buffer.from(marker)), marker);
  }
}

async function stopInstance(
  instance: Instance,
  cdp: CdpSession | undefined,
  command: "app_main_window_close" | "app_request_exit",
  runtimePort: number,
) {
  if (cdp) {
    await cdp
      .evaluate(
        `(() => { window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}).catch(() => {}); return true; })()`,
      )
      .catch(() => undefined);
    cdp.close();
  }
  const exitCode = await waitForExit(instance.child);
  await delay(500);
  check(`${command} exits the process`, exitCode === 0 || exitCode === null, { exitCode });
  check(`${command} releases the owned runtime port`, !(await isPortOpen(runtimePort)), runtimePort);
  check(`${command} releases the bridge port`, !(await isPortOpen(instance.bridgePort)), instance.bridgePort);
  check(`${command} releases the CDP port`, !(await isPortOpen(instance.cdpPort)), instance.cdpPort);
}

async function main() {
  mkdirSync(artifactRoot, { recursive: true });
  check("candidate exists", existsSync(candidate), candidate);
  check("candidate hash matches", sha256(candidate) === candidateSha256, candidateSha256);
  recordStage("candidate", { candidate, sha256: candidateSha256 });

  const decoy = await holdDecoy(9124);
  recordStage("decoy-listener", { host: "127.0.0.1", port: 9124 });
  let instance: Instance | undefined;
  let cdp: CdpSession | undefined;
  let bridge: BridgeClient | undefined;
  try {
    const cdpPort = await findFreePort(19411);
    const bridgePort = await findFreePort(19423);
    const rootA = path.join(artifactRoot, "root-a");
    instance = await launchInstance({ name: `${runId}-a`, root: rootA, cdpPort, bridgePort, decoy });
    await waitFor(async () => isPortOpen(bridgePort), 20000, "bridge port A");
    bridge = new BridgeClient(`ws://127.0.0.1:${bridgePort}`);
    cdp = await connectPage(cdpPort, (target) => target.url.includes("tauri.localhost") && !target.url.includes("overlay") && !target.url.includes("action-dock") && !target.url.includes("voice"));
    const statusA = await getRuntime(cdp);
    check("Alpha04 app version", (await getMainValue(cdp, `window.__TAURI__.app.getVersion()`)) === "0.6.0-alpha04");
    check("owned runtime is not external", statusA.externalRuntime === false, statusA);
    check("owned runtime pid matches process", statusA.pid === instance.child.pid, { statusA, pid: instance.child.pid });
    check("requested 9124 was not adopted", statusA.port !== 9124, { port: statusA.port });
    const profile = await createProfile(cdp, `${runId}-a`);
    check("profile is isolated", profile.profileId.startsWith("profile-") && profile.profileId !== "profile-alpha04-manual-20261112", profile);
    await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_show')`);
    const overlayProfile = await waitFor(
      async () => {
        const current = await bridge!.executeJs<{ activeProfileId?: string } | null>(
          "now-workbench-overlay",
          `JSON.parse(localStorage.getItem('exomind:profile-session') || 'null')`,
        );
        return current?.activeProfileId === profile.profileId ? current : false;
      },
      15000,
      "overlay profile session",
    );
    check("main and overlay share synthetic profile", overlayProfile?.activeProfileId === profile.profileId, { overlayProfile, profileId: profile.profileId });
    const windowLabels = ["main", "now-workbench-overlay", "action-dock", "voice-overlay"];
    const windowDetails = await Promise.all(
      windowLabels.map(async (label) => ({
        label,
        detail: await bridge!.executeJs<{ href: string; title: string }>(
          label,
          `({ href: location.href, title: document.title })`,
        ),
      })),
    );
    check("main and all auxiliary WebViews exist", windowDetails.every((item) => Boolean(item.detail?.href)), windowDetails);

    const markerA = `ALPHA04-AUTO-A-${runId}`;
    await cdp.evaluate(
      `localStorage.setItem('exomind:alpha04:root-marker', ${JSON.stringify(markerA)}); true`,
    );
    await apiJson(statusA.port, "POST", "/eventlog", profile.profileId, {
      id: `auto-event-a-${randomUUID()}`,
      content: markerA,
      tags: ["alpha04-auto"],
      metadata: { synthetic: true, runId },
    });
    await cdp.evaluate(`document.querySelector('[data-testid="now-page-view-toggle-record"]').click()`);
    await waitFor(async () => cdp!.evaluate(`document.body.innerText.includes(${JSON.stringify(markerA)})`), 10000, "record UI readback");
    check("record is visible in the real WebView", true, markerA);
    await apiJson(statusA.port, "POST", "/timeblocks/start", profile.profileId, {
      name: "Alpha04 automated countdown",
      mode: "countdown",
      targetMinutes: 1,
      taskIds: [],
    });
    await delay(150);
    await apiJson(statusA.port, "POST", "/timeblocks/pause", profile.profileId);
    await delay(100);
    await apiJson(statusA.port, "POST", "/timeblocks/resume", profile.profileId);
    await delay(100);
    await apiJson(statusA.port, "POST", "/timeblocks/stop", profile.profileId);
    await delay(100);
    await apiJson(statusA.port, "POST", "/timeblocks/end", profile.profileId, { feedback: "Alpha04 automated feedback." });
    const completedBlocks = asArray(await apiJson(statusA.port, "GET", "/timeblocks", profile.profileId));
    check(
      "completed countdown timeblock exists",
      completedBlocks.some(
        (block) => block.name === "Alpha04 automated countdown" && block.blockType === "active" && Boolean(block.endTime),
      ),
      completedBlocks,
    );
    await apiJson(statusA.port, "POST", "/timeblocks/start", profile.profileId, {
      name: "Alpha04 automated active",
      mode: "countup",
      targetMinutes: null,
      taskIds: [],
    });
    await verifyRuntimeDb(rootA, profile.profileId, markerA);
    recordStage("instance-a-data", { profile: profile.profileId, marker: markerA });

    await stopInstance(instance, cdp, "app_main_window_close", statusA.port);
    bridge.close();
    bridge = undefined;
    const beforeRestartBlocks = readSqliteRows(
      rootA,
      "timeblocks.sqlite",
      "select id, name, end_time, block_type from timeblocks where scope_key = ? order by start_time",
      profile.profileId,
    );
    check(
      "active block remains in storage after titlebar close",
      beforeRestartBlocks.some(
        (block: any[]) => block[1] === "Alpha04 automated active" && block[3] === "active" && block[2] === null,
      ),
      beforeRestartBlocks,
    );
    cdp = undefined;

    await closeServer(instance.decoy);
    instance.decoy = await holdDecoy(9124);
    instance = await launchInstance({
      name: `${runId}-a-restart`,
      root: rootA,
      cdpPort: instance.cdpPort,
      bridgePort: instance.bridgePort,
      decoy: instance.decoy,
    });
    await waitFor(async () => isPortOpen(instance!.bridgePort), 20000, "bridge port A restart");
    bridge = new BridgeClient(`ws://127.0.0.1:${instance.bridgePort}`);
    cdp = await connectPage(instance.cdpPort, (target) => target.url.includes("tauri.localhost") && !target.url.includes("overlay") && !target.url.includes("action-dock") && !target.url.includes("voice"));
    const statusRestart = await getRuntime(cdp);
    check("restart reuses synthetic profile", (await getMainValue<{ activeProfileId?: string } | null>(cdp, `JSON.parse(localStorage.getItem('exomind:profile-session') || 'null')`))?.activeProfileId === profile.profileId);
    check("restart keeps runtime host identity", statusRestart.hostId === statusA.hostId, { before: statusA.hostId, after: statusRestart.hostId });
    await delay(2500);
    const restoredEvents = asArray(await apiJson(statusRestart.port, "GET", "/eventlog", profile.profileId));
    check("record survives restart", restoredEvents.some((event) => event.content === markerA), restoredEvents.map((event) => event.content));
    const restoredActive = await apiJson(
      statusRestart.port,
      "GET",
      "/timeblocks/active",
      profile.profileId,
    );
    check(
      "active timeblock survives restart",
      restoredActive?.name === "Alpha04 automated active"
        && restoredActive.blockType === "active"
        && !restoredActive.endTime,
      restoredActive,
    );
    await stopInstance(instance, cdp, "app_request_exit", statusRestart.port);
    bridge.close();
    bridge = undefined;
    cdp = undefined;

    const rootB = path.join(artifactRoot, "root-b");
    const cdpPortB = await findFreePort(19441);
    const bridgePortB = await findFreePort(19453);
    await closeServer(instance.decoy);
    instance = await launchInstance({ name: `${runId}-b`, root: rootB, cdpPort: cdpPortB, bridgePort: bridgePortB, decoy: await holdDecoy(9124) });
    await waitFor(async () => isPortOpen(bridgePortB), 20000, "bridge port B");
    bridge = new BridgeClient(`ws://127.0.0.1:${bridgePortB}`);
    cdp = await connectPage(cdpPortB, (target) => target.url.includes("tauri.localhost") && !target.url.includes("overlay") && !target.url.includes("action-dock") && !target.url.includes("voice"));
    const statusB = await getRuntime(cdp);
    const profileB = await createProfile(cdp, `${runId}-b`);
    check("second root gets a different profile", profileB.profileId !== profile.profileId, { a: profile.profileId, b: profileB.profileId });
    check("second root has no first-root localStorage marker", !(await getMainValue<boolean>(cdp, `localStorage.getItem(${JSON.stringify("exomind:alpha04:root-marker")}) === ${JSON.stringify(markerA)}`)));
    const markerB = `ALPHA04-AUTO-B-${runId}`;
    await apiJson(statusB.port, "POST", "/eventlog", profileB.profileId, {
      id: `auto-event-b-${randomUUID()}`,
      content: markerB,
      tags: ["alpha04-auto"],
      metadata: { synthetic: true, runId },
    });
    const eventsB = asArray(await apiJson(statusB.port, "GET", "/eventlog", profileB.profileId));
    check("second root only reads its own record", eventsB.some((event) => event.content === markerB) && !eventsB.some((event) => event.content === markerA), eventsB.map((event) => event.content));
    const eventsA = readSqliteRows(
      rootA,
      "eventlog.sqlite",
      "select content from eventlog_events where user_key = ? order by timestamp",
      profile.profileId,
    );
    check(
      "first root remains separate from second root",
      eventsA.some((row: any[]) => row[0] === markerA) && !eventsA.some((row: any[]) => row[0] === markerB),
      eventsA.map((row: any[]) => row[0]),
    );
    await stopInstance(instance, cdp, "app_request_exit", statusB.port);
    bridge.close();
    bridge = undefined;
    cdp = undefined;
    recordStage("instance-b-isolation", { profile: profileB.profileId, marker: markerB });
  } finally {
    if (cdp) cdp.close();
    if (bridge) bridge.close();
    if (instance) {
      if (instance.child.exitCode === null) instance.child.kill();
      await closeServer(instance.decoy);
    }
  }

  const report = {
    runId,
    candidate,
    candidateSha256,
    sourceCommit: "fe93aa331234061c854f184a786a722393eba7ed",
    startedAt: new Date().toISOString(),
    checks,
    stages,
    passed: checks.every((item) => item.passed),
    remaining: ["A0.3 synthetic old 0.5 behavior baseline", "A3.1 old-vs-Alpha baseline comparison"],
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ passed: report.passed, runId, reportPath, checks: checks.length }, null, 2));
}

main().catch((error) => {
  const report = {
    runId,
    candidate,
    candidateSha256,
    startedAt: new Date().toISOString(),
    checks,
    stages,
    passed: false,
    error: error instanceof Error ? error.message : String(error),
  };
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.error(JSON.stringify({ passed: false, reportPath, error: report.error }, null, 2));
  process.exitCode = 1;
});
