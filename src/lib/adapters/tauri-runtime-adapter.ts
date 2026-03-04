import { invoke, isTauri } from '@tauri-apps/api/core';
import type { IRuntimePort, StartRuntimeInput } from '@/lib/environment/interfaces/runtime.port';
import type { RuntimeServiceStatus } from '@/lib/types/agent-hub';

const DEFAULT_RUNTIME_STATUS: RuntimeServiceStatus = {
  running: false,
  host: '127.0.0.1',
  port: 1949,
  error: 'tauri runtime control only',
};

export class TauriRuntimeAdapter implements IRuntimePort {
  async startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus> {
    if (!(await isTauri())) {
      return { ...DEFAULT_RUNTIME_STATUS, host: input.host, port: input.port };
    }
    return invoke<RuntimeServiceStatus>('runtime_service_start', {
      host: input.host,
      port: input.port,
    });
  }

  async stopRuntime(): Promise<RuntimeServiceStatus> {
    if (!(await isTauri())) {
      return DEFAULT_RUNTIME_STATUS;
    }
    return invoke<RuntimeServiceStatus>('runtime_service_stop');
  }

  async getStatus(): Promise<RuntimeServiceStatus> {
    if (!(await isTauri())) {
      return DEFAULT_RUNTIME_STATUS;
    }
    return invoke<RuntimeServiceStatus>('runtime_service_status');
  }
}
