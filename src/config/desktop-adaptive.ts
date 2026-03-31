import { createConfigModule } from './config-factory';

const DESKTOP_ADAPTIVE_STORAGE_KEY = 'exomind:desktopAdaptiveEnabled'; // desktop adaptive（桌面端适配）存储键
const DESKTOP_ADAPTIVE_CHANGED_EVENT = 'exomind:desktop-adaptive-changed'; // custom event（自定义事件）

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

const desktopAdaptiveModule = createConfigModule<boolean>({
  storageKey: DESKTOP_ADAPTIVE_STORAGE_KEY,
  eventName: DESKTOP_ADAPTIVE_CHANGED_EVENT,
  defaultValue: true,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getDesktopAdaptiveEnabled(): boolean {
  return desktopAdaptiveModule.get();
}

export function setDesktopAdaptiveEnabled(enabled: boolean): void {
  desktopAdaptiveModule.set(enabled);
}

export function subscribeDesktopAdaptiveChanges(listener: (enabled: boolean) => void): () => void {
  return desktopAdaptiveModule.subscribe(listener);
}
