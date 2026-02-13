import type { ASRInput, ASRResult, IASRPort } from '../../../../src/lib/environment/interfaces/asr.port';
import type { RuntimeKind } from '../../../../src/lib/environment/bootstrap';
import { WebEventLogStorageAdapter } from '../../../../src/lib/adapters/web-eventlog-storage';
import { NodeFileStorageAdapter } from './node-file-storage';
import { RemoteEventLogPort } from '../ports/remote-eventlog-port';

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

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveRemoteDbUrl(userId: string): string | null {
  const baseUrl = process.env.EXOMIND_MCP_SYNC_SERVER_URL?.trim();
  if (!baseUrl) return null;
  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(userId)}`;
}

export function createMcpEnvironment(): {
  asr: IASRPort;
  storage: NodeFileStorageAdapter;
  eventlog: WebEventLogStorageAdapter | RemoteEventLogPort;
  runtime: RuntimeKind;
  capabilities(): Record<string, boolean>;
} {
  const runtime: RuntimeKind = 'web';

  const userId = resolveUserId();
  const remoteDbUrl = userId ? resolveRemoteDbUrl(userId) : null;
  const eventlog = remoteDbUrl ? new RemoteEventLogPort(remoteDbUrl) : new WebEventLogStorageAdapter(userId);

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
