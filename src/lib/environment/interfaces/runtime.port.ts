import type { RuntimeServiceStatus } from '@/lib/types/agent-hub';

export interface StartRuntimeInput {
  host: string;
  port: number;
}

export interface IRuntimePort {
  startRuntime(input: StartRuntimeInput): Promise<RuntimeServiceStatus>;
  stopRuntime(): Promise<RuntimeServiceStatus>;
  getStatus(): Promise<RuntimeServiceStatus>;
}
