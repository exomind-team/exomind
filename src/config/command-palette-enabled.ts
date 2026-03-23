import { createConfigModule } from './config-factory';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const _module = createConfigModule<boolean>({
  storageKey: 'exomind:commandPaletteEnabled',
  eventName: 'exomind:command-palette-enabled-changed',
  defaultValue: false,
  normalize: normalizeBoolean,
});

export function getCommandPaletteEnabled(): boolean {
  return _module.get();
}

export function setCommandPaletteEnabled(enabled: boolean): void {
  _module.set(enabled);
}

export function subscribeCommandPaletteEnabledChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return _module.subscribe(listener);
}
