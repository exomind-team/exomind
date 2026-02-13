import type { ASRInput, ASRResult, IASRPort } from '../../../../src/lib/environment/interfaces/asr.port';
import { NodeFileStorageAdapter } from './node-file-storage';

class UnavailableAsrPort implements IASRPort {
  isAvailable(): boolean {
    return false;
  }

  async transcribe(_input: ASRInput): Promise<ASRResult> {
    throw new Error('ASR is not available in MCP runtime');
  }
}

export function createMcpEnvironment(): { asr: IASRPort; storage: NodeFileStorageAdapter } {
  return {
    asr: new UnavailableAsrPort(),
    storage: new NodeFileStorageAdapter(),
  };
}
