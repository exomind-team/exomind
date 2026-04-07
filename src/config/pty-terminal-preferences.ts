import { createConfigModule } from './config-factory';

export const PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS_STORAGE_KEY =
  'exomind:ptyWaitingInputIdleTimeoutSeconds';
export const PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS_CHANGED_EVENT =
  'exomind:ptyWaitingInputIdleTimeoutSecondsChanged';
export const PTY_TERMINAL_REPLAY_LIMIT_KB_STORAGE_KEY =
  'exomind:ptyTerminalReplayLimitKb';
export const PTY_TERMINAL_REPLAY_LIMIT_KB_CHANGED_EVENT =
  'exomind:ptyTerminalReplayLimitKbChanged';

export const DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS = 60;
export const MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS = 1;
export const MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS = 600;
export const DEFAULT_PTY_TERMINAL_REPLAY_LIMIT_KB = 256;
export const MIN_PTY_TERMINAL_REPLAY_LIMIT_KB = 128;
export const MAX_PTY_TERMINAL_REPLAY_LIMIT_KB = 2048;

const PTY_TERMINAL_SCROLLBACK_BYTES_PER_LINE = 96;
const MIN_PTY_TERMINAL_SCROLLBACK_LINES = 1000;
const MAX_PTY_TERMINAL_SCROLLBACK_LINES = 20000;

function clampPtyWaitingInputIdleTimeoutSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS;
  }

  return Math.min(
    MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
    Math.max(MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS, Math.round(value)),
  );
}

function clampPtyTerminalReplayLimitKb(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PTY_TERMINAL_REPLAY_LIMIT_KB;
  }

  return Math.min(
    MAX_PTY_TERMINAL_REPLAY_LIMIT_KB,
    Math.max(MIN_PTY_TERMINAL_REPLAY_LIMIT_KB, Math.round(value)),
  );
}

const ptyWaitingInputIdleTimeoutSecondsModule = createConfigModule<number>({
  storageKey: PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS_STORAGE_KEY,
  eventName: PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS_CHANGED_EVENT,
  defaultValue: DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
  normalize: (rawValue) => clampPtyWaitingInputIdleTimeoutSeconds(Number.parseInt(rawValue ?? '', 10)),
  serialize: (value) => String(clampPtyWaitingInputIdleTimeoutSeconds(value)),
  persistMode: 'runtime-preferred',
});

const ptyTerminalReplayLimitKbModule = createConfigModule<number>({
  storageKey: PTY_TERMINAL_REPLAY_LIMIT_KB_STORAGE_KEY,
  eventName: PTY_TERMINAL_REPLAY_LIMIT_KB_CHANGED_EVENT,
  defaultValue: DEFAULT_PTY_TERMINAL_REPLAY_LIMIT_KB,
  normalize: (rawValue) => clampPtyTerminalReplayLimitKb(Number.parseInt(rawValue ?? '', 10)),
  serialize: (value) => String(clampPtyTerminalReplayLimitKb(value)),
  persistMode: 'runtime-preferred',
});

export function getPtyWaitingInputIdleTimeoutSeconds(): number {
  return ptyWaitingInputIdleTimeoutSecondsModule.get();
}

export function setPtyWaitingInputIdleTimeoutSeconds(value: number): number {
  return ptyWaitingInputIdleTimeoutSecondsModule.set(value);
}

export function subscribePtyWaitingInputIdleTimeoutSecondsChanges(
  listener: (value: number) => void,
): () => void {
  return ptyWaitingInputIdleTimeoutSecondsModule.subscribe(listener);
}

export function getPtyTerminalReplayLimitKb(): number {
  return ptyTerminalReplayLimitKbModule.get();
}

export function setPtyTerminalReplayLimitKb(value: number): number {
  return ptyTerminalReplayLimitKbModule.set(value);
}

export function subscribePtyTerminalReplayLimitKbChanges(
  listener: (value: number) => void,
): () => void {
  return ptyTerminalReplayLimitKbModule.subscribe(listener);
}

export function resolvePtyTerminalScrollbackLines(replayLimitKb: number): number {
  const normalizedKb = clampPtyTerminalReplayLimitKb(replayLimitKb);
  const approxLines = Math.round((normalizedKb * 1024) / PTY_TERMINAL_SCROLLBACK_BYTES_PER_LINE);
  return Math.min(
    MAX_PTY_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_PTY_TERMINAL_SCROLLBACK_LINES, approxLines),
  );
}
