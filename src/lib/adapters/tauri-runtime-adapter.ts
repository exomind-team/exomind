import { invoke, isTauri } from '@tauri-apps/api/core';
import type {
  IRuntimePort,
  RuntimeReachableAddress,
  StartRuntimeInput,
} from '@/lib/environment/interfaces/runtime.port';
import type { RuntimeServiceStatus } from '@/lib/types/agent-hub';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  persistEmbeddedRuntimeStatus,
} from '@/config/runtime-target';

const DEFAULT_RUNTIME_STATUS: RuntimeServiceStatus = {
  running: false,
  host: '127.0.0.1',
  port: DEFAULT_EMBEDDED_RUNTIME_PORT,
  error: 'tauri runtime control only',
};

function rememberEmbeddedRuntimeStatus(status: RuntimeServiceStatus): RuntimeServiceStatus {
  if (status.running) {
    persistEmbeddedRuntimeStatus({
      host: status.host,
      port: status.port,
      hostId: status.hostId,
      authSecret: status.authSecret,
    });
  }
  return status;
}

export class TauriRuntimeAdapter implements IRuntimePort {
  async startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus> {
    if (!(await isTauri())) {
      return { ...DEFAULT_RUNTIME_STATUS, host: input.host, port: input.port };
    }
    const status = await invoke<RuntimeServiceStatus>('runtime_service_start', {
      host: input.host,
      port: input.port,
    });
    return rememberEmbeddedRuntimeStatus(status);
  }

  async stopRuntime(): Promise<RuntimeServiceStatus> {
    if (!(await isTauri())) {
      return DEFAULT_RUNTIME_STATUS;
    }
    const status = await invoke<RuntimeServiceStatus>('runtime_service_stop');
    return rememberEmbeddedRuntimeStatus(status);
  }

  async getStatus(): Promise<RuntimeServiceStatus> {
    if (!(await isTauri())) {
      return DEFAULT_RUNTIME_STATUS;
    }
    const status = await invoke<RuntimeServiceStatus>('runtime_service_status');
    return rememberEmbeddedRuntimeStatus(status);
  }

  async getReachableAddress(remoteHost: string, remotePort: number): Promise<RuntimeReachableAddress> {
    if (!(await isTauri())) {
      return {
        host: '127.0.0.1',
        port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      };
    }
    return invoke<RuntimeReachableAddress>('runtime_service_reachable_address', {
      remoteHost,
      remotePort,
    });
  }
}
