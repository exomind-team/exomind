interface RuntimeSessionCacheEntry {
  agentId: string;
  sessionId: string;
  hostId?: string;
  hostAddress: string;
  updatedAt: string;
}

type RuntimeSessionCacheStore = Record<string, RuntimeSessionCacheEntry>;

const RUNTIME_SESSION_CACHE_KEY = 'exomind:runtime-agent-session-cache:v1';

function buildCacheKey(agentId: string, hostId: string | undefined, hostAddress: string): string {
  return `${hostId ?? hostAddress}::${agentId}`;
}

function readStore(): RuntimeSessionCacheStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RUNTIME_SESSION_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as RuntimeSessionCacheStore : {};
  } catch {
    return {};
  }
}

function writeStore(store: RuntimeSessionCacheStore): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RUNTIME_SESSION_CACHE_KEY, JSON.stringify(store));
}

export function rememberRuntimeSession(input: {
  agentId: string;
  sessionId: string;
  hostId?: string;
  hostAddress: string;
}): void {
  const store = readStore();
  const key = buildCacheKey(input.agentId, input.hostId, input.hostAddress);
  store[key] = {
    ...input,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

export function readRememberedRuntimeSession(input: {
  agentId: string;
  hostId?: string;
  hostAddress: string;
}): string | null {
  const store = readStore();
  const key = buildCacheKey(input.agentId, input.hostId, input.hostAddress);
  return store[key]?.sessionId ?? null;
}
