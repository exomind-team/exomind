import type { RuntimeServiceStatus } from '@/lib/types/agent-hub';

export interface StartRuntimeInput {
  host: string;
  port: number;
}

export interface RuntimeReachableAddress {
  host: string;
  port: number;
  hostId?: string;
}

export interface IRuntimePort {
  startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus>;
  stopRuntime(): Promise<RuntimeServiceStatus>;
  getStatus(): Promise<RuntimeServiceStatus>;
  getReachableAddress(remoteHost: string, remotePort: number): Promise<RuntimeReachableAddress>;
}
