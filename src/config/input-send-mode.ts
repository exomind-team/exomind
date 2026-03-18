import { createConfigModule } from './config-factory';

export const INPUT_SEND_MODE_VALUES = ['enter-send', 'ctrl-enter-send'] as const;
export type InputSendMode = (typeof INPUT_SEND_MODE_VALUES)[number];

function normalizeMode(rawValue: string | null | undefined): InputSendMode {
  if (rawValue === 'enter-send') return 'enter-send';
  return 'ctrl-enter-send';
}

const _module = createConfigModule<InputSendMode>({
  storageKey: 'exomind:inputSendMode',
  eventName: 'exomind:input-send-mode-changed',
  defaultValue: 'ctrl-enter-send',
  normalize: normalizeMode,
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
