import type { ASRInput, ASRResult, IASRPort } from '../../../../src/lib/environment/interfaces/asr.port';
import type { RuntimeKind } from '../../../../src/lib/environment/bootstrap';
import { WebEventLogStorageAdapter } from '../../../../src/lib/adapters/web-eventlog-storage';
import { NodeFileStorageAdapter } from './node-file-storage';
import { RemoteEventLogPort } from '../ports/remote-eventlog-port';
import { RtEventLogPort } from '../ports/rt-eventlog-port';

class UnavailableAsrPort implements IASRPort {
  isAvailable(): boolean {
    return false;
  }

  async transcribe(_input: ASRInput): Promise<ASRResult> {
    throw new Error('ASR is not available in MCP runtime');
  }
}

function resolveUserId(): string | undefined {
  const raw = process.env.EXOMIND_MCP_USER_ID?.trim();
  return raw ? raw : undefined;
}

type EventLogMode = 'auto' | 'local' | 'remote' | 'rt';

function resolveEventLogMode(): EventLogMode {
  const raw = process.env.EXOMIND_MCP_EVENTLOG_MODE?.trim().toLowerCase();
  if (raw === 'local' || raw === 'remote' || raw === 'auto' || raw === 'rt') {
    return raw;
  }
  return 'auto';
}

function resolveRtUrl(): string {
  const explicit = process.env.EXOMIND_MCP_RT_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  return 'http://localhost:1949';
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveSyncServerBaseUrl(): string {
  const explicit = process.env.EXOMIND_MCP_SYNC_SERVER_URL?.trim();
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }

  const portRaw = process.env.EXOMIND_POUCHDB_PORT?.trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : 6984;
  const normalizedPort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 6984;
  return `http://localhost:${normalizedPort}`;
}

function buildRemoteDbUrl(baseUrl: string, userId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(userId)}`;
}

export function createMcpEnvironment(): {
  asr: IASRPort;
  storage: NodeFileStorageAdapter;
  eventlog: WebEventLogStorageAdapter | RemoteEventLogPort | RtEventLogPort;
  runtime: RuntimeKind;
  capabilities(): Record<string, boolean>;
} {
  const runtime: RuntimeKind = 'web';

  const userId = resolveUserId();
  const mode = resolveEventLogMode();

  let eventlog: WebEventLogStorageAdapter | RemoteEventLogPort | RtEventLogPort;

  if (mode === 'rt') {
    // Explicit RT mode — always use the Runtime HTTP backend.
    const rtUrl = resolveRtUrl();
    eventlog = new RtEventLogPort(rtUrl, userId || 'anonymous');
  } else if (mode === 'auto' && process.env.EXOMIND_MCP_RT_URL) {
    // Auto mode with RT URL explicitly configured — prefer RT.
    const rtUrl = resolveRtUrl();
    eventlog = new RtEventLogPort(rtUrl, userId || 'anonymous');
  } else {
    // Original remote / local / auto logic.
    const syncBaseUrl = resolveSyncServerBaseUrl();
    const remoteDbUrl = userId ? buildRemoteDbUrl(syncBaseUrl, userId) : null;

    const shouldUseRemote =
      mode === 'remote' || (mode === 'auto' && Boolean(userId));

    if (mode === 'remote' && !userId) {
      throw new Error('EXOMIND_MCP_USER_ID is required when EXOMIND_MCP_EVENTLOG_MODE=remote');
    }

    eventlog =
      shouldUseRemote && remoteDbUrl
        ? new RemoteEventLogPort(remoteDbUrl)
        : new WebEventLogStorageAdapter(userId);
  }

  const env = {
    asr: new UnavailableAsrPort(),
    storage: new NodeFileStorageAdapter(),
    eventlog,
    runtime,
    capabilities() {
      return { asr: false, storage: true, eventlog: true };
    },
  };

  return env;
}

// === 用户认证相关 ===

export interface AuthResult {
  valid: boolean;
  userId: string | null;
  passwordHash: string | null;
  reason?: string;
}

function resolveUserPassword(): string | undefined {
  return process.env.EXOMIND_MCP_USER_PASSWD?.trim();
}

export async function validateUserCredentials(): Promise<AuthResult> {
  const userId = resolveUserId();
  const password = resolveUserPassword();

  // 情况 1: 没有设置 USER_ID → 必须报错（MCP 只支持远程模式）
  if (!userId) {
    console.error('[MCP] ERROR: USER_ID is required. MCP only supports remote mode.');
    return { valid: false, userId: null, passwordHash: null, reason: 'USER_ID required' };
  }

  // 情况 2: 没有设置 USER_PASSWD → 必须报错
  if (!password) {
    const error = '[MCP] ERROR: USER_PASSWD is required for remote mode';
    console.error(error);
    return { valid: false, userId, passwordHash: null, reason: 'USER_PASSWD required' };
  }

  // 情况 3: 验证通过
  console.log(`[MCP] User authenticated: ${userId}`);
  return {
    valid: true,
    userId,
    passwordHash: password,
    reason: 'authenticated'
  };
}
