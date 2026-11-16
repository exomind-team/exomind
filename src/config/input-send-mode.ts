import { createConfigModule } from './config-factory';
import type { InputSendMode } from '@/lib/input-send-shortcut';
export { INPUT_SEND_MODE_VALUES, shouldSubmitOnEnter } from '@/lib/input-send-shortcut';
export type { InputSendMode, EnterSubmitEvent } from '@/lib/input-send-shortcut';

function normalizeMode(rawValue: string | null | undefined): InputSendMode {
  if (rawValue === 'enter-send') return 'enter-send';
  return 'ctrl-enter-send';
}

const _module = createConfigModule<InputSendMode>({
  storageKey: 'exomind:inputSendMode',
  eventName: 'exomind:input-send-mode-changed',
  defaultValue: 'ctrl-enter-send',
  normalize: normalizeMode,
  persistMode: 'runtime-preferred',
});

export function getInputSendMode(): InputSendMode {
  return _module.get();
}

export function setInputSendMode(mode: InputSendMode): InputSendMode {
  return _module.set(mode);
}

export function subscribeInputSendModeChanges(
  listener: (mode: InputSendMode) => void,
): () => void {
  return _module.subscribe(listener);
}
