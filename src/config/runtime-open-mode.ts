import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  getEmbeddedRuntimeNetworkMode,
  setEmbeddedRuntimeNetworkMode,
  type EmbeddedRuntimeNetworkMode,
} from '@/config/runtime-target';

function normalizeEmbeddedRuntimeNetworkMode(
  mode: string | null | undefined,
): EmbeddedRuntimeNetworkMode {
  return mode === 'lan' ? 'lan' : 'local';
}

export async function setPersistedEmbeddedRuntimeNetworkMode(
  mode: EmbeddedRuntimeNetworkMode,
): Promise<EmbeddedRuntimeNetworkMode> {
  const previousMode = getEmbeddedRuntimeNetworkMode();
  const normalized = normalizeEmbeddedRuntimeNetworkMode(mode);
  setEmbeddedRuntimeNetworkMode(normalized);

  if (!await isTauri()) {
    return normalized;
  }

  try {
    const persistedMode = normalizeEmbeddedRuntimeNetworkMode(
      await invoke<string>('runtime_network_mode_set', { mode: normalized }),
    );
    if (persistedMode !== normalized) {
      setEmbeddedRuntimeNetworkMode(persistedMode);
    }
    return persistedMode;
  } catch (error) {
    setEmbeddedRuntimeNetworkMode(previousMode);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
