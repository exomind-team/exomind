import { invoke, isTauri } from '@tauri-apps/api/core';

export type DevInstanceRuntimeInfo = {
  pid: number | null;
};

export async function loadTauriRuntimeInstanceDiagnostics(): Promise<DevInstanceRuntimeInfo> {
  if (!await isTauri()) {
    return { pid: null };
  }

  return invoke<DevInstanceRuntimeInfo>('dev_instance_runtime_info');
}
