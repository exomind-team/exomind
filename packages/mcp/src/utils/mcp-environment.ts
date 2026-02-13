import type { ExoMindEnvironment } from '../../../../src/lib/environment/environment';
import type { ASRInput, ASRResult, IASRPort } from '../../../../src/lib/environment/interfaces/asr.port';
import type { RuntimeKind } from '../../../../src/lib/environment/bootstrap';
import { WebEventLogStorageAdapter } from '../../../../src/lib/adapters/web-eventlog-storage';
import { NodeFileStorageAdapter } from './node-file-storage';

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

export function createMcpEnvironment(): ExoMindEnvironment {
  const runtime: RuntimeKind = 'web';

  const env = {
    asr: new UnavailableAsrPort(),
    storage: new NodeFileStorageAdapter(),
    eventlog: new WebEventLogStorageAdapter(resolveUserId()),
    runtime,
    capabilities() {
      return { asr: false, storage: true, eventlog: true };
    },
  };

  return env as unknown as ExoMindEnvironment;
}
