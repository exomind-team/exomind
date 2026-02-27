import { invoke, isTauri } from '@tauri-apps/api/core';
import type { RuntimeServiceStatus } from '@/lib/types/agent-hub';

export interface StartRuntimeInput {
  host: string;
  port: number;
}

export interface RuntimeControlService {
  startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus>;
  stopRuntime(): Promise<RuntimeServiceStatus>;
  getStatus(): Promise<RuntimeServiceStatus>;
}

const DEFAULT_RUNTIME_STATUS: RuntimeServiceStatus = {
  running: false,
  host: '127.0.0.1',
  port: 4077,
  error: 'tauri runtime control only',
};

export class RuntimeControlServiceImpl implements RuntimeControlService {
  async startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus> {
    if (!(await isTauri())) {
      return {
        ...DEFAULT_RUNTIME_STATUS,
        host: input.host,
        port: input.port,
      };
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

let runtimeControlServiceInstance: RuntimeControlService | null = null;

export function getRuntimeControlService(): RuntimeControlService {
  if (!runtimeControlServiceInstance) {
    runtimeControlServiceInstance = new RuntimeControlServiceImpl();
  }
  return runtimeControlServiceInstance;
}

export function resetRuntimeControlServiceForTests(): void {
  runtimeControlServiceInstance = null;
}
