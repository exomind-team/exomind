/** Shared keyboard semantics; independent of runtime configuration/storage. */
export const INPUT_SEND_MODE_VALUES = ['enter-send', 'ctrl-enter-send'] as const;
export type InputSendMode = (typeof INPUT_SEND_MODE_VALUES)[number];
export interface EnterSubmitEvent {
  key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean;
}

export function shouldSubmitOnEnter(mode: InputSendMode, event: EnterSubmitEvent): boolean {
  if (event.key !== 'Enter' || event.altKey || event.shiftKey) return false;
  return mode === 'enter-send' ? !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey;
}

export function inputSendShortcutLabel(mode: InputSendMode): string {
  return mode === 'enter-send' ? 'Enter 发送 · Shift + Enter 换行' : 'Ctrl / ⌘ + Enter 发送';
}
