import { getDeveloperModeEnabled } from '@/config/developer-mode';
import { getDevtoolsEnabled } from '@/config/devtools-mode';
import { log } from '@/lib/logger';

type ErudaModule = typeof import('eruda');
type ErudaInstance = ErudaModule['default'];

let erudaModulePromise: Promise<ErudaModule> | null = null;
let erudaInstance: ErudaInstance | null = null;
let isInitialized = false;

function shouldEnableDevtools(): boolean {
  if (typeof window === 'undefined') return false;
  return getDeveloperModeEnabled() && getDevtoolsEnabled();
}

async function loadEruda(): Promise<ErudaInstance> {
  if (!erudaModulePromise) {
    erudaModulePromise = import('eruda');
  }
  const module = await erudaModulePromise;
  return module.default;
}

export async function syncDevtoolsWithSettings(): Promise<void> {
  try {
    if (!shouldEnableDevtools()) {
      if (isInitialized && erudaInstance) {
        erudaInstance.destroy();
      }
      isInitialized = false;
      return;
    }

    if (isInitialized) return;

    erudaInstance = await loadEruda();
    erudaInstance.init();
    isInitialized = true;
  } catch (error) {
    log.warn(`[devtools-runtime] Failed to sync devtools: ${error instanceof Error ? error.message : String(error)}`);
  }
}
