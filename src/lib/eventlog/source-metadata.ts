import type { EventSourceMetadata } from '../types/event';
import { createUuidV4 } from '../utils/uuid';

const SYNC_STORE_KEY = 'exomind:sync-store';
const DEVICE_ID_KEY = 'exomind:deviceId';
const DEVICE_NAME_KEY = 'exomind:deviceName';

const UNKNOWN_DEVICE_NAME = '未知设备';
const UNKNOWN_PLATFORM = 'Unknown';

interface SyncStoreSnapshot {
  state?: {
    credentials?: {
      deviceName?: unknown;
      platform?: unknown;
    };
  };
  credentials?: {
    deviceName?: unknown;
    platform?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLocalStorageString(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = localStorage.getItem(key);
    return readString(value);
  } catch {
    return null;
  }
}

function readSyncStoreSnapshot(): SyncStoreSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(SYNC_STORE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as SyncStoreSnapshot) : null;
  } catch {
    return null;
  }
}

function readCredentialField(field: 'deviceName' | 'platform'): string | null {
  const snapshot = readSyncStoreSnapshot();
  if (!snapshot) {
    return null;
  }

  const stateCredentials = snapshot.state?.credentials;
  const rootCredentials = snapshot.credentials;

  return (
    readString(stateCredentials?.[field])
    ?? readString(rootCredentials?.[field])
    ?? null
  );
}

function detectPlatformFromNavigator(): string {
  if (typeof navigator === 'undefined') {
    return UNKNOWN_PLATFORM;
  }

  const ua = navigator.userAgent ?? '';
  const nativePlatform = readString(navigator.platform) ?? UNKNOWN_PLATFORM;

  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac/.test(ua)) return 'macOS';
  if (/Win/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return nativePlatform;
}

function resolvePlatform(): string {
  return readCredentialField('platform') ?? detectPlatformFromNavigator();
}

function resolveDeviceName(platform: string): string {
  return (
    readCredentialField('deviceName')
    ?? readLocalStorageString(DEVICE_NAME_KEY)
    ?? (platform !== UNKNOWN_PLATFORM ? `${platform} Device` : UNKNOWN_DEVICE_NAME)
  );
}

function resolveDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'unknown-device';
  }

  const stored = readLocalStorageString(DEVICE_ID_KEY);
  if (stored) {
    return stored;
  }

  const created = createUuidV4();
  try {
    localStorage.setItem(DEVICE_ID_KEY, created);
  } catch {
    return 'unknown-device';
  }
  return created;
}

export function getEventSourceMetadata(): EventSourceMetadata {
  const platform = resolvePlatform();
  return {
    deviceId: resolveDeviceId(),
    deviceName: resolveDeviceName(platform),
    platform,
    app: 'ExoMind',
  };
}
