import { createConfigModule } from './config-factory';

export const INPUT_SEND_MODE_VALUES = ['enter-send', 'ctrl-enter-send'] as const;
export type InputSendMode = (typeof INPUT_SEND_MODE_VALUES)[number];
export type EnterSubmitEvent = {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

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

export function shouldSubmitOnEnter(mode: InputSendMode, event: EnterSubmitEvent): boolean {
  if (event.key !== 'Enter') return false;
  if (event.altKey) return false;

  if (mode === 'enter-send') {
    return !event.shiftKey && !event.ctrlKey && !event.metaKey;
  }

  if (event.shiftKey) return false;
  return event.ctrlKey || event.metaKey;
}
