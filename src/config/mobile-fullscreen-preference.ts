import { createConfigModule } from './config-factory';

const fullscreen = createConfigModule<boolean>({
  storageKey: 'exomind:mobileFullscreenEnabled',
  eventName: 'exomind:mobile-fullscreen-enabled-changed',
  defaultValue: false,
  normalize: (value) => value === 'true',
});

// A display preference belongs to this device, not the synchronized profile.
export const getMobileFullscreenEnabled = fullscreen.get;
export const setMobileFullscreenEnabled = fullscreen.set;
export const subscribeMobileFullscreenChanges = fullscreen.subscribe;
