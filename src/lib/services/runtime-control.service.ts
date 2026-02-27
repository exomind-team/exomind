import type { IRuntimePort, StartRuntimeInput } from '@/lib/environment/interfaces/runtime.port';
import type { RuntimeServiceStatus } from '@/lib/types/agent-hub';
import { TauriRuntimeAdapter } from '@/lib/adapters/tauri-runtime-adapter';

export interface RuntimeControlService {
  startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus>;
  stopRuntime(): Promise<RuntimeServiceStatus>;
  getStatus(): Promise<RuntimeServiceStatus>;
}

export type { StartRuntimeInput };

export class RuntimeControlServiceImpl implements RuntimeControlService {
  constructor(private readonly runtimePort: IRuntimePort) {}

  async startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus> {
    return this.runtimePort.startRuntime(input);
  }

  async stopRuntime(): Promise<RuntimeServiceStatus> {
    return this.runtimePort.stopRuntime();
  }

  async getStatus(): Promise<RuntimeServiceStatus> {
    return this.runtimePort.getStatus();
  }
}

let runtimeControlServiceInstance: RuntimeControlService | null = null;

export function getRuntimeControlService(): RuntimeControlService {
  if (!runtimeControlServiceInstance) {
    runtimeControlServiceInstance = new RuntimeControlServiceImpl(new TauriRuntimeAdapter());
  }
  return runtimeControlServiceInstance;
}

export function resetRuntimeControlServiceForTests(): void {
  runtimeControlServiceInstance = null;
}
