import { invoke, isTauri } from '@tauri-apps/api/core';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import {
  resumeRuntimeConfigBootstrap,
  suspendRuntimeConfigBootstrap,
} from '@/config/runtime-config-cache';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  getEmbeddedRuntimeNetworkMode,
  getRuntimeExternalAddress,
  getRuntimeExternalAuthToken,
  getRuntimeTargetMode,
  resolveEmbeddedRuntimeBindHost,
  setRuntimeExternalAddress,
  setRuntimeExternalAuthToken,
  setRuntimeTargetMode,
  type RuntimeTargetMode,
} from '@/config/runtime-target';

function normalizeRuntimeTargetMode(
  mode: string | null | undefined,
): RuntimeTargetMode {
  return mode === 'external' ? 'external' : 'embedded';
}

function normalizeRuntimeExternalAddress(address: string | null | undefined): string | null {
  if (typeof address !== 'string') {
    return null;
  }
  const trimmed = address.trim();
  return trimmed.length > 0 ? trimmed : null;
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
        port: DEFAULT_EMBEDDED_RUNTIME_PORT,
      });
      resumeRuntimeConfigBootstrap();
    } else {
      await runtimeControlService.stopRuntime();
      suspendRuntimeConfigBootstrap();
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

export async function setPersistedRuntimeExternalAddress(address: string): Promise<string> {
  const previousAddress = getRuntimeExternalAddress();

  setRuntimeExternalAddress(address);

  if (!await isTauri()) {
    return getRuntimeExternalAddress();
  }

  try {
    const persistedAddress = await invoke<string>('runtime_external_address_set', { address });
    setRuntimeExternalAddress(persistedAddress);
    return persistedAddress;
  } catch (error) {
    setRuntimeExternalAddress(previousAddress);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function setPersistedRuntimeExternalAuthToken(token: string): Promise<string> {
  const previousToken = getRuntimeExternalAuthToken();

  setRuntimeExternalAuthToken(token);

  try {
    return getRuntimeExternalAuthToken();
  } catch (error) {
    setRuntimeExternalAuthToken(previousToken);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function hydratePersistedRuntimeTargetConfig(): Promise<void> {
  if (!await isTauri()) {
    return;
  }

  const [persistedMode, persistedAddress] = await Promise.all([
    invoke<string>('runtime_target_mode_get').catch(() => null),
    invoke<string>('runtime_external_address_get').catch(() => null),
  ]);

  const normalizedAddress = normalizeRuntimeExternalAddress(persistedAddress);
  if (normalizedAddress) {
    setRuntimeExternalAddress(normalizedAddress);
  }

  setRuntimeTargetMode(normalizeRuntimeTargetMode(persistedMode));
}
