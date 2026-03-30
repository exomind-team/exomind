import { invoke, isTauri } from '@tauri-apps/api/core';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import {
  getEmbeddedRuntimeNetworkMode,
  getPreferredEmbeddedRuntimePort,
  getRuntimeTargetMode,
  resolveEmbeddedRuntimeBindHost,
  setRuntimeTargetMode,
  type RuntimeTargetMode,
} from '@/config/runtime-target';

function normalizeRuntimeTargetMode(
  mode: string | null | undefined,
): RuntimeTargetMode {
  return mode === 'external' ? 'external' : 'embedded';
}

export async function setPersistedRuntimeTargetMode(
  mode: RuntimeTargetMode,
): Promise<RuntimeTargetMode> {
  const previousMode = getRuntimeTargetMode();
  const normalized = normalizeRuntimeTargetMode(mode);
  let persistedMode: RuntimeTargetMode | null = null;

  if (!await isTauri()) {
    setRuntimeTargetMode(normalized);
    return normalized;
  }

  try {
    persistedMode = normalizeRuntimeTargetMode(
      await invoke<string>('runtime_target_mode_set', { mode: normalized }),
    );
    const runtimeControlService = getRuntimeControlService();

    if (persistedMode === 'embedded') {
      await runtimeControlService.startRuntime({
        host: resolveEmbeddedRuntimeBindHost(getEmbeddedRuntimeNetworkMode()),
        port: getPreferredEmbeddedRuntimePort(),
      });
    } else {
      await runtimeControlService.stopRuntime();
    }

    setRuntimeTargetMode(persistedMode);
    return persistedMode;
  } catch (error) {
    if (persistedMode !== null && persistedMode !== previousMode) {
      await invoke<string>('runtime_target_mode_set', { mode: previousMode }).catch(() => previousMode);
    }
    setRuntimeTargetMode(previousMode);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
