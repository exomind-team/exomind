import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";

const workflowRunId = "43214581730";
const workflowRunUrl = "https://github.com/exomind-team/exomind/actions/runs/43214581730";
const releaseCommit = "c8933b14431bc2733a5ece4d60791ec8bd655ba2";
const expectedInstallerSha256 = "3d1a00f37f5e608fa40d0f6b919ca35a702b397e4dccf13bbb79485ab74603ba";
const defaultInstaller =
  "F:/ExoMind-task-artifacts/2026-11-12/alpha04-release-isolation/ci-43214581730/windows-nsis/target/release/bundle/nsis/ExoMind_0.6.0-alpha04_x64-setup.exe";
const defaultArtifactRoot = "F:/ExoMind-task-artifacts/2026-11-12/alpha04-release-isolation/runs";
const isolatedAppId = "com.exomind.app.v06";
const configMarkerKey = "exomind:alpha04:release-isolation";

type Check = {
  name: string;
  passed: boolean;
  detail?: unknown;
};

type Stage = {
  stage: string;
  at: string;
  detail?: unknown;
};

type Instance = {
  name: string;
  installDir: string;
  executable: string;
  root: string;
  child: ChildProcess;
  cdpPort: number;
  logPath: string;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const installer = path.resolve(parseArg("installer") || defaultInstaller);
const runId = `alpha04-release-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const artifactRoot = path.resolve(parseArg("artifact-root") || defaultArtifactRoot, runId);
const reportPath = path.join(artifactRoot, "report.json");
const checks: Check[] = [];
const stages: Stage[] = [];

class CdpSession {
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
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
      socket.addEventListener("error", () => reject(new Error("CDP socket error")), {
        once: true,
      });
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

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const output = await this.request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (output.exceptionDetails) throw new Error(JSON.stringify(output.exceptionDetails));
    return output.result.value as T;
  }

  close() {
    this.socket.close();
  }
}

function recordStage(stage: string, detail?: unknown) {
  stages.push({ stage, at: new Date().toISOString(), detail });
}

function check(name: string, condition: boolean, detail?: unknown) {
  checks.push({ name, passed: condition, detail });
  if (!condition) throw new Error(`assertion failed: ${name}`);
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
    await delay(250);
  }
  throw new Error(`${label} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writeJson(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function memorySnapshot() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  return {
    totalGiB: Number((totalBytes / 1024 ** 3).toFixed(2)),
    freeGiB: Number((freeBytes / 1024 ** 3).toFixed(2)),
    freePercent: Number(((freeBytes / totalBytes) * 100).toFixed(1)),
  };
}

function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child);
      else output.push(child);
    }
  };
  visit(root);
  return output;
}

function treeMetadata(root: string) {
  if (!existsSync(root)) return { exists: false, files: 0, bytes: 0, latestMtimeMs: 0 };
  const files = listFilesRecursive(root);
  let bytes = 0;
  let latestMtimeMs = 0;
  for (const file of files) {
    const stat = statSync(file);
    bytes += stat.size;
    latestMtimeMs = Math.max(latestMtimeMs, stat.mtimeMs);
  }
  return { exists: true, files: files.length, bytes, latestMtimeMs };
}

function treeContains(root: string, marker: string) {
  const markerBytes = Buffer.from(marker);
  for (const file of listFilesRecursive(root)) {
    try {
      if (readFileSync(file).includes(markerBytes)) return true;
    } catch {
      // A live WebView may rotate a file while this read-only probe runs.
    }
  }
  return false;
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
    setTimeout(() => done(false), 400);
  });
}

async function findFreePort(start: number) {
  for (let port = start; port < start + 500; port += 1) {
    const server = createServer();
    const free = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (free) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
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

async function cdpTargets(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return (await response.json()) as Array<{
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl: string;
  }>;
}

async function connectLabel(port: number, label: string, timeoutMs = 25000) {
  return waitFor(
    async () => {
      for (const target of await cdpTargets(port)) {
        if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
        let session: CdpSession | undefined;
        try {
          session = await CdpSession.connect(target);
          const actualLabel = await session.evaluate<string>(
            `window.__TAURI__?.window?.getCurrentWindow?.().label ?? ""`,
          );
          if (actualLabel === label) return session;
        } catch {
          // The target may still be navigating. Retry after the next poll.
        }
        session?.close();
      }
      return false;
    },
    timeoutMs,
    `CDP target label ${label}`,
  );
}

async function getWindowLabels(main: CdpSession) {
  return main.evaluate<string[]>(
    `window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows')`,
  );
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
  return JSON.parse(
    execFileSync("python", ["-c", python, dbPath, query, profileId], { encoding: "utf8" }),
  ) as any[];
}

async function apiJson(runtimePort: number, method: string, route: string, profileId: string, body?: unknown) {
  const separator = route.includes("?") ? "&" : "?";
  const url = `http://127.0.0.1:${runtimePort}${route}${separator}user_id=${encodeURIComponent(profileId)}`;
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

async function putConfig(runtimePort: number, value: string) {
  const response = await fetch(
    `http://127.0.0.1:${runtimePort}/config/${encodeURIComponent(configMarkerKey)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "user",
        value,
        sensitive: false,
        source: "alpha04-release-isolation",
        sourceOrigin: null,
      }),
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`PUT config: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function listConfig(runtimePort: number) {
  const response = await fetch(
    `http://127.0.0.1:${runtimePort}/config?scope=user&prefix=${encodeURIComponent("exomind:alpha04")}`,
  );
  if (!response.ok) throw new Error(`GET config: ${response.status} ${await response.text()}`);
  return (await response.json()) as Array<{ key: string; value: string }>;
}

async function getRuntime(cdp: CdpSession) {
  return waitFor(
    async () => {
      const status = await cdp.evaluate<any>(
        `(async () => { try { return await window.__TAURI_INTERNALS__.invoke('runtime_service_status'); } catch { return null; } })()`,
      );
      return status?.running ? status : false;
    },
    30000,
    "runtime status",
  );
}

async function createProfile(cdp: CdpSession, slug: string) {
  const password = `Auto-${randomUUID()}`;
  await waitFor(
    async () => cdp.evaluate(`!!document.querySelector('[data-testid="desktop-sidebar-account-entry"]')`),
    25000,
    "account entry",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="desktop-sidebar-account-entry"]').click()`);
  await waitFor(
    async () =>
      cdp.evaluate(
        `Array.from(document.querySelectorAll('[role="dialog"] button, dialog button')).some((b) => (b.innerText || '').includes('去创建'))`,
      ),
    8000,
    "create profile entry",
  );
  await cdp.evaluate(
    `Array.from(document.querySelectorAll('[role="dialog"] button, dialog button')).find((b) => (b.innerText || '').includes('去创建')).click()`,
  );
  await waitFor(
    async () => cdp.evaluate(`document.querySelectorAll('[role="dialog"] input, dialog input').length >= 3`),
    8000,
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
      cdp.evaluate<{ activeProfileId?: string } | null>(
        `(() => { try { return JSON.parse(localStorage.getItem('exomind:profile-session') || 'null'); } catch { return null; } })()`,
      ),
    25000,
    "profile session",
  );
  if (!session.activeProfileId) throw new Error("profile session missing activeProfileId");
  return { profileId: session.activeProfileId, slug };
}

function createDecoyLegacyFixture(root: string) {
  const appData = path.join(root, "app-data");
  const runtime = path.join(root, "runtime");
  const webview = path.join(root, "webview-main");
  for (const file of [
    path.join(appData, ".exomind", "legacy-sentinel.txt"),
    path.join(appData, "settings", "legacy-sentinel.txt"),
    path.join(appData, "eventlog", "legacy-sentinel.txt"),
    path.join(runtime, "legacy-sentinel.txt"),
    path.join(webview, "legacy-sentinel.txt"),
  ]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `synthetic legacy sentinel ${file}\n`, "utf8");
  }
  return {
    appData,
    runtime,
    webview,
    hashes: Object.fromEntries(
      listFilesRecursive(root).map((file) => [path.relative(root, file), sha256(file)]),
    ),
  };
}

function assertDecoyUnchanged(root: string, originalHashes: Record<string, string>) {
  const current = Object.fromEntries(
    listFilesRecursive(root).map((file) => [path.relative(root, file), sha256(file)]),
  );
  check(
    "synthetic legacy fixture is unchanged",
    JSON.stringify(current) === JSON.stringify(originalHashes),
    { originalHashes, current },
  );
}

function instanceEnvironment(root: string, cdpPort: number) {
  const decoyRuntime = path.join(root, "decoy-runtime");
  const decoyLegacy = path.join(root, "legacy-fixture");
  mkdirSync(decoyRuntime, { recursive: true });
  const legacy = createDecoyLegacyFixture(decoyLegacy);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    EXOMIND_DEV_APP_DATA_DIR: path.join(root, "app-data"),
    EXOMIND_DEV_RUNTIME_DATA_DIR: path.join(root, "runtime"),
    EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR: path.join(root, "webview-main"),
    EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT: path.join(root, "webview-overlay"),
    EXOMIND_DEV_LEGACY_SHARED_APP_DATA_DIR: legacy.appData,
    EXOMIND_DEV_LEGACY_SHARED_RUNTIME_DIR: legacy.runtime,
    EXOMIND_DEV_LEGACY_SHARED_WEBVIEW_MAIN_DATA_DIR: legacy.webview,
    EXOMIND_RT_PORT: "9124",
    EXOMIND_RT_DATA_DIR: decoyRuntime,
    EXOMIND_RT_HOST_ID: `ignored-${path.basename(root)}`,
    EXOMIND_RT_MESH_STATE_PATH: path.join(decoyRuntime, "mesh-state.json"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
  };
  for (const key of [
    "SIGNAL",
    "EVENTLOG",
    "TASK",
    "TIMEBLOCK",
    "SESSION",
    "CONFIG",
    "REMINDER",
  ]) {
    environment[`EXOMIND_RT_${key}_SQLITE_PATH`] = path.join(
      decoyRuntime,
      `${key.toLowerCase()}.sqlite`,
    );
  }
  return {
    environment,
    decoyRuntime,
    legacyRoot: decoyLegacy,
    legacyHashes: legacy.hashes,
  };
}

async function installRelease(installerPath: string, installDir: string) {
  mkdirSync(installDir, { recursive: true });
  const result = spawnSync(installerPath, ["/S", `/D=${installDir}`], {
    windowsHide: true,
    stdio: "ignore",
  });
  check(`NSIS installer exits successfully for ${path.basename(installDir)}`, result.status === 0, {
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error) : undefined,
  });
}

async function launchInstance(options: {
  name: string;
  installDir: string;
  root: string;
  cdpPort: number;
}) {
  const { name, installDir, root, cdpPort } = options;
  mkdirSync(root, { recursive: true });
  const executable = path.join(installDir, "exomind.exe");
  check(`${name} release executable exists`, existsSync(executable), executable);
  const environmentInfo = instanceEnvironment(root, cdpPort);
  const logPath = path.join(root, "automation.log");
  const log = openSync(logPath, "a");
  const child = spawn(executable, [], {
    cwd: installDir,
    env: environmentInfo.environment,
    detached: false,
    windowsHide: false,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  if (!child.pid) throw new Error(`failed to launch ${name}`);
  writeJson(path.join(root, "launch.json"), {
    name,
    installDir,
    executable,
    executableSha256: sha256(executable),
    root,
    pid: child.pid,
    cdpPort,
    requestedRuntimePort: 9124,
    startedAt: new Date().toISOString(),
  });
  recordStage("launch", { name, installDir, executable, pid: child.pid, root, cdpPort });
  return {
    instance: { name, installDir, executable, root, child, cdpPort, logPath } satisfies Instance,
    environmentInfo,
  };
}

async function waitForExit(child: ChildProcess, timeoutMs = 30000) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("instance did not exit")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 0);
    });
  });
}

function assertRootPaths(instance: Instance, decoyRuntime: string, marker: string) {
  const appData = path.join(instance.root, "app-data");
  const runtime = path.join(instance.root, "runtime");
  const runtimeSqliteFiles = existsSync(runtime)
    ? readdirSync(runtime).filter((name) => name.endsWith(".sqlite"))
    : [];
  const decoySqliteFiles = existsSync(decoyRuntime)
    ? readdirSync(decoyRuntime).filter((name) => name.endsWith(".sqlite"))
    : [];
  check("AppData device identity lives under isolated root", existsSync(path.join(appData, "device_id.txt")), {
    path: path.join(appData, "device_id.txt"),
  });
  check("runtime databases live under isolated root", runtimeSqliteFiles.length >= 5, runtimeSqliteFiles);
  check("decoy runtime has no sqlite database", decoySqliteFiles.length === 0, decoySqliteFiles);
  check(
    "test marker is present in the isolated runtime",
    existsSync(path.join(runtime, "eventlog.sqlite")) &&
      readFileSync(path.join(runtime, "eventlog.sqlite")).includes(Buffer.from(marker)),
    marker,
  );
  for (const label of ["main", "now-workbench-overlay", "action-dock", "voice-overlay"]) {
    const dataDir =
      label === "main"
        ? path.join(instance.root, "webview-main")
        : path.join(instance.root, "webview-overlay", label);
    check(`WebView data directory exists for ${label}`, existsSync(dataDir) && readdirSync(dataDir).length > 0, {
      label,
      dataDir,
    });
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
  await delay(800);
  check(`${command} exits the release process`, exitCode === 0 || exitCode === null, { exitCode });
  check(`${command} releases the owned runtime port`, !(await isPortOpen(runtimePort)), runtimePort);
  check(`${command} releases the CDP port`, !(await isPortOpen(instance.cdpPort)), instance.cdpPort);
}

function defaultDataMetadata() {
  const roaming = path.join(process.env.APPDATA || "", isolatedAppId);
  const local = path.join(process.env.LOCALAPPDATA || "", isolatedAppId);
  return {
    roaming: { path: roaming, ...treeMetadata(roaming) },
    local: { path: local, ...treeMetadata(local) },
  };
}

async function runA(
  installDir: string,
  root: string,
  cdpPort: number,
  marker: string,
) {
  const launched = await launchInstance({
    name: `${runId}-a`,
    installDir,
    root,
    cdpPort,
  });
  const instance = launched.instance;
  let main: CdpSession | undefined;
  try {
    main = await connectLabel(cdpPort, "main");
    const status = await getRuntime(main);
    check(
      "release app version is 0.6.0-alpha04",
      (await main.evaluate<string>(`window.__TAURI__.app.getVersion()`)) === "0.6.0-alpha04",
    );
    check(
      "release app process owns the requested PID",
      (await main.evaluate<{ pid: number }>(
        `window.__TAURI_INTERNALS__.invoke('dev_instance_runtime_info')`,
      )).pid === instance.child.pid,
      { pid: instance.child.pid },
    );
    check("release app does not adopt occupied 9124", status.port !== 9124, status);
    check("release app owns an embedded runtime", status.externalRuntime === false, status);
    check("release runtime PID matches app PID", status.pid === instance.child.pid, {
      status,
      pid: instance.child.pid,
    });
    await main.evaluate(
      `window.__TAURI_INTERNALS__.invoke('runtime_network_mode_set', { mode: 'local' })`,
    );
    const profile = await createProfile(main, `${runId}-a`);
    check("release profile is synthetic", profile.profileId.startsWith("profile-"), profile);
    await main.evaluate(
      `localStorage.setItem('exomind:alpha04:root-marker', ${JSON.stringify(marker)}); true`,
    );
    await putConfig(status.port, marker);
    await apiJson(status.port, "POST", "/eventlog", profile.profileId, {
      id: `release-event-a-${randomUUID()}`,
      content: marker,
      tags: ["alpha04-release-isolation"],
      metadata: { synthetic: true, runId },
    });
    await main.evaluate(`document.querySelector('[data-testid="now-page-view-toggle-record"]').click()`);
    await waitFor(
      async () => main!.evaluate(`document.body.innerText.includes(${JSON.stringify(marker)})`),
      15000,
      "release record UI readback",
    );
    check("release record is visible in the real main WebView", true, marker);

    await apiJson(status.port, "POST", "/timeblocks/start", profile.profileId, {
      name: "Alpha04 release countdown",
      mode: "countdown",
      targetMinutes: 1,
      taskIds: [],
    });
    await delay(150);
    await apiJson(status.port, "POST", "/timeblocks/pause", profile.profileId);
    await delay(100);
    await apiJson(status.port, "POST", "/timeblocks/resume", profile.profileId);
    await delay(100);
    await apiJson(status.port, "POST", "/timeblocks/stop", profile.profileId);
    await delay(100);
    await apiJson(status.port, "POST", "/timeblocks/end", profile.profileId, {
      feedback: "Alpha04 release isolation feedback.",
    });
    const blocks = asArray(await apiJson(status.port, "GET", "/timeblocks", profile.profileId));
    check(
      "release countdown and feedback complete",
      blocks.some(
        (block) =>
          block.name === "Alpha04 release countdown" &&
          block.blockType === "active" &&
          Boolean(block.endTime),
      ),
      blocks,
    );
    await apiJson(status.port, "POST", "/timeblocks/start", profile.profileId, {
      name: "Alpha04 release active",
      mode: "countup",
      targetMinutes: null,
      taskIds: [],
    });
    await main.evaluate(`window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_show')`);
    await main.evaluate(
      `window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_profile_set', { profileId: ${JSON.stringify(profile.profileId)} })`,
    );
    const windowLabels = await getWindowLabels(main);
    check(
      "main and all auxiliary release WebViews exist",
      windowLabels.includes("main") &&
        windowLabels.includes("now-workbench-overlay") &&
        windowLabels.includes("action-dock") &&
        windowLabels.includes("voice-overlay"),
      windowLabels,
    );
    const overlayProfile = await main.evaluate<string | null>(
      `window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_profile_get')`,
    );
    check(
      "main and now overlay share the same synthetic profile",
      overlayProfile === profile.profileId,
      { overlayProfile, profileId: profile.profileId },
    );
    assertRootPaths(instance, launched.environmentInfo.decoyRuntime, marker);
    recordStage("instance-a-data", {
      profile: profile.profileId,
      marker,
      status,
      windowLabels,
    });

    await stopInstance(instance, main, "app_main_window_close", status.port);
    main = undefined;
    const storedBlocks = readSqliteRows(
      instance.root,
      "timeblocks.sqlite",
      "select id, name, end_time, block_type from timeblocks where scope_key = ? order by start_time",
      profile.profileId,
    );
    check(
      "release active block remains in isolated storage",
      storedBlocks.some(
        (block: any[]) =>
          block[1] === "Alpha04 release active" && block[3] === "active" && block[2] === null,
      ),
      storedBlocks,
    );
    assertDecoyUnchanged(
      launched.environmentInfo.legacyRoot,
      launched.environmentInfo.legacyHashes,
    );

    const restart = await launchInstance({
      name: `${runId}-a-restart`,
      installDir,
      root,
      cdpPort,
    });
    const restarted = restart.instance;
    main = await connectLabel(cdpPort, "main");
    const restartStatus = await getRuntime(main);
    check(
      "release restart reuses the isolated profile",
      (await main.evaluate<{ activeProfileId?: string } | null>(
        `JSON.parse(localStorage.getItem('exomind:profile-session') || 'null')`,
      ))?.activeProfileId === profile.profileId,
    );
    check(
      "release restart preserves WebView marker",
      await main.evaluate<boolean>(
        `localStorage.getItem('exomind:alpha04:root-marker') === ${JSON.stringify(marker)}`,
      ),
    );
    check("release restart preserves runtime host identity", restartStatus.hostId === status.hostId, {
      before: status.hostId,
      after: restartStatus.hostId,
    });
    const restartedConfig = await listConfig(restartStatus.port);
    check(
      "release restart preserves config setting",
      restartedConfig.some(
        (entry) => entry.key === configMarkerKey && entry.value === marker,
      ),
      restartedConfig,
    );
    const restoredEvents = asArray(
      await apiJson(restartStatus.port, "GET", "/eventlog", profile.profileId),
    );
    check(
      "release restart preserves record",
      restoredEvents.some((event) => event.content === marker),
      restoredEvents.map((event) => event.content),
    );
    const restoredActive = await apiJson(
      restartStatus.port,
      "GET",
      "/timeblocks/active",
      profile.profileId,
    );
    check(
      "release restart preserves active timeblock",
      restoredActive?.name === "Alpha04 release active" &&
        restoredActive.blockType === "active" &&
        !restoredActive.endTime,
      restoredActive,
    );
    await main.evaluate(`window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_show')`);
    await main.evaluate(
      `window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_profile_set', { profileId: ${JSON.stringify(profile.profileId)} })`,
    );
    const restartWindowLabels = await getWindowLabels(main);
    check(
      "release restart restores all four WebView surfaces",
      restartWindowLabels.includes("main") &&
        restartWindowLabels.includes("now-workbench-overlay") &&
        restartWindowLabels.includes("action-dock") &&
        restartWindowLabels.includes("voice-overlay"),
      restartWindowLabels,
    );
    await stopInstance(restarted, main, "app_request_exit", restartStatus.port);
    main = undefined;
    assertDecoyUnchanged(restart.environmentInfo.legacyRoot, restart.environmentInfo.legacyHashes);
    recordStage("instance-a-restart-data", {
      profile: profile.profileId,
      hostId: restartStatus.hostId,
      restoredEvents: restoredEvents.length,
    });
    return { profile, hostId: status.hostId };
  } finally {
    main?.close();
    if (instance.child.exitCode === null) instance.child.kill();
  }
}

async function runB(
  installDir: string,
  root: string,
  cdpPort: number,
  marker: string,
  firstProfile: string,
  firstHostId: string,
  firstMarker: string,
) {
  const launched = await launchInstance({
    name: `${runId}-b`,
    installDir,
    root,
    cdpPort,
  });
  const instance = launched.instance;
  let main: CdpSession | undefined;
  try {
    main = await connectLabel(cdpPort, "main");
    const status = await getRuntime(main);
    check(
      "second release install gets a different runtime host identity",
      status.hostId !== firstHostId,
      { firstHostId, secondHostId: status.hostId },
    );
    check("second release install does not adopt occupied 9124", status.port !== 9124, status);
    const profile = await createProfile(main, `${runId}-b`);
    check("second release install gets a different profile", profile.profileId !== firstProfile, {
      firstProfile,
      secondProfile: profile.profileId,
    });
    check(
      "second release install has no first-root WebView marker",
      (await main.evaluate<string | null>(
        `localStorage.getItem('exomind:alpha04:root-marker')`,
      )) !== firstMarker,
    );
    const initialConfig = await listConfig(status.port);
    check(
      "second release install has no first-root config settings",
      !initialConfig.some((entry) => entry.key === configMarkerKey),
      initialConfig,
    );
    await main.evaluate(
      `localStorage.setItem('exomind:alpha04:root-marker', ${JSON.stringify(marker)}); true`,
    );
    await main.evaluate(
      `window.__TAURI_INTERNALS__.invoke('runtime_network_mode_set', { mode: 'local' })`,
    );
    await putConfig(status.port, marker);
    await apiJson(status.port, "POST", "/eventlog", profile.profileId, {
      id: `release-event-b-${randomUUID()}`,
      content: marker,
      tags: ["alpha04-release-isolation"],
      metadata: { synthetic: true, runId },
    });
    const events = asArray(await apiJson(status.port, "GET", "/eventlog", profile.profileId));
    check(
      "second release install only reads its own record",
      events.some((event) => event.content === marker) &&
        !events.some((event) => event.content === firstMarker),
      events.map((event) => event.content),
    );
    await main.evaluate(`window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_show')`);
    await main.evaluate(
      `window.__TAURI_INTERNALS__.invoke('now_workbench_overlay_profile_set', { profileId: ${JSON.stringify(profile.profileId)} })`,
    );
    const windowLabels = await getWindowLabels(main);
    check(
      "second release install exposes all four WebView surfaces",
      windowLabels.includes("main") &&
        windowLabels.includes("now-workbench-overlay") &&
        windowLabels.includes("action-dock") &&
        windowLabels.includes("voice-overlay"),
      windowLabels,
    );
    assertRootPaths(instance, launched.environmentInfo.decoyRuntime, marker);
    const deviceId = readFileSync(
      path.join(instance.root, "app-data", "device_id.txt"),
      "utf8",
    ).trim();
    const settingsPath = path.join(
      instance.root,
      "app-data",
      "settings",
      "runtime-network-mode.json",
    );
    check("second release AppData has isolated settings", existsSync(settingsPath), settingsPath);
    const eventsA = readSqliteRows(
      path.join(artifactRoot, "root-a"),
      "eventlog.sqlite",
      "select content from eventlog_events where user_key = ? order by timestamp",
      firstProfile,
    );
    check(
      "first release root remains separate from second install",
      eventsA.some((row: any[]) => row[0] === firstMarker) &&
        !eventsA.some((row: any[]) => row[0] === marker),
      eventsA.map((row: any[]) => row[0]),
    );
    await stopInstance(instance, main, "app_request_exit", status.port);
    main = undefined;
    assertDecoyUnchanged(
      launched.environmentInfo.legacyRoot,
      launched.environmentInfo.legacyHashes,
    );
    recordStage("instance-b-isolation", {
      profile: profile.profileId,
      hostId: status.hostId,
      deviceId,
      marker,
      windowLabels,
    });
    return { profile, hostId: status.hostId, deviceId };
  } finally {
    main?.close();
    if (instance.child.exitCode === null) instance.child.kill();
  }
}

async function main() {
  mkdirSync(artifactRoot, { recursive: true });
  const memory = memorySnapshot();
  writeJson(path.join(artifactRoot, "memory-gate.json"), memory);
  check(
    "memory gate records enough free memory",
    memory.freeGiB >= 4 && memory.freePercent >= 15,
    memory,
  );
  check("release installer exists", existsSync(installer), installer);
  const installerHash = sha256(installer);
  check("release installer hash matches CI artifact", installerHash === expectedInstallerSha256, {
    installer,
    installerHash,
    expectedInstallerSha256,
  });
  const defaultDataBefore = defaultDataMetadata();
  recordStage("provenance", {
    workflowRunId,
    workflowRunUrl,
    releaseCommit,
    installer,
    installerHash,
    memory,
  });

  const installA = path.join(artifactRoot, "install-a");
  const installB = path.join(artifactRoot, "install-b");
  await installRelease(installer, installA);
  await installRelease(installer, installB);
  const executableA = path.join(installA, "exomind.exe");
  const executableB = path.join(installB, "exomind.exe");
  check(
    "both independent release install directories contain an executable",
    existsSync(executableA) && existsSync(executableB),
    { executableA, executableB },
  );
  check(
    "both release installs use the same CI-built executable",
    sha256(executableA) === sha256(executableB),
    {
      executableA,
      executableASha256: sha256(executableA),
      executableB,
      executableBSha256: sha256(executableB),
    },
  );

  const externalDecoy = await isPortOpen(9124);
  const ownedDecoy = externalDecoy ? undefined : await holdDecoy(9124);
  recordStage("runtime-port-decoy", {
    port: 9124,
    kind: externalDecoy ? "external-listener" : "owned-decoy",
  });
  try {
    const cdpA = await findFreePort(19511);
    const cdpB = await findFreePort(cdpA + 1);
    const markerA = `ALPHA04-RELEASE-A-${runId}`;
    const markerB = `ALPHA04-RELEASE-B-${runId}`;
    const resultA = await runA(
      installA,
      path.join(artifactRoot, "root-a"),
      cdpA,
      markerA,
    );
    const deviceA = readFileSync(
      path.join(artifactRoot, "root-a", "app-data", "device_id.txt"),
      "utf8",
    ).trim();
    const resultB = await runB(
      installB,
      path.join(artifactRoot, "root-b"),
      cdpB,
      markerB,
      resultA.profile.profileId,
      resultA.hostId,
      markerA,
    );
    check("two release installs mint different device identities", deviceA !== resultB.deviceId, {
      deviceA,
      deviceB: resultB.deviceId,
    });
    const defaultDataAfter = defaultDataMetadata();
    check(
      "default 0.6 app-data metadata is unchanged by isolated runs",
      JSON.stringify(defaultDataAfter) === JSON.stringify(defaultDataBefore),
      { before: defaultDataBefore, after: defaultDataAfter },
    );
    check(
      "isolated test marker is absent from the default 0.6 app-data roots",
      !treeContains(defaultDataBefore.roaming.path, markerA) &&
        !treeContains(defaultDataBefore.roaming.path, markerB) &&
        !treeContains(defaultDataBefore.local.path, markerA) &&
        !treeContains(defaultDataBefore.local.path, markerB),
      defaultDataBefore,
    );
    recordStage("cross-root-summary", {
      profileA: resultA.profile.profileId,
      profileB: resultB.profile.profileId,
      hostIdA: resultA.hostId,
      hostIdB: resultB.hostId,
      deviceA,
      deviceB: resultB.deviceId,
    });
  } finally {
    await closeServer(ownedDecoy);
  }

  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    scope: "A1.2 strict release installation isolation",
    workflowRunId,
    workflowRunUrl,
    releaseCommit,
    installer,
    installerSha256: expectedInstallerSha256,
    platform: "Windows",
    checks,
    stages,
    passed: checks.every((item) => item.passed),
  };
  writeJson(reportPath, report);
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        runId,
        reportPath,
        checks: checks.length,
        failed: checks.filter((item) => !item.passed).map((item) => item.name),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  mkdirSync(artifactRoot, { recursive: true });
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    scope: "A1.2 strict release installation isolation",
    workflowRunId,
    workflowRunUrl,
    releaseCommit,
    installer,
    checks,
    stages,
    passed: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
  };
  writeJson(reportPath, report);
  console.error(JSON.stringify({ passed: false, reportPath, error: report.error }, null, 2));
  process.exitCode = 1;
});
