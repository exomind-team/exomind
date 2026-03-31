import { createConfigModule } from './config-factory';

export const VOICE_OVERLAY_OPACITY_STORAGE_KEY = 'exomind:voiceOverlayOpacity';
export const VOICE_OVERLAY_OPACITY_CHANGED_EVENT = 'exomind:voice-overlay-opacity-changed';
export const VOICE_OVERLAY_SHOW_DIAGNOSTICS_STORAGE_KEY = 'exomind:voiceOverlayShowDiagnostics';
export const VOICE_OVERLAY_SHOW_DIAGNOSTICS_CHANGED_EVENT = 'exomind:voice-overlay-show-diagnostics-changed';
export const VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY = 'exomind:voiceOverlayTranscriptLines';
export const VOICE_OVERLAY_TRANSCRIPT_LINES_CHANGED_EVENT = 'exomind:voice-overlay-transcript-lines-changed';
export const VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY = 'exomind:voiceOverlayBottomOffset';
export const VOICE_OVERLAY_BOTTOM_OFFSET_CHANGED_EVENT = 'exomind:voice-overlay-bottom-offset-changed';

export const DEFAULT_VOICE_OVERLAY_OPACITY = 70;
export const MIN_VOICE_OVERLAY_OPACITY = 20;
export const MAX_VOICE_OVERLAY_OPACITY = 98;
export const DEFAULT_VOICE_OVERLAY_SHOW_DIAGNOSTICS = false;
export const DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES = 3;
export const MIN_VOICE_OVERLAY_TRANSCRIPT_LINES = 1;
export const MAX_VOICE_OVERLAY_TRANSCRIPT_LINES = 5;
export const DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET = 56;
export const MIN_VOICE_OVERLAY_BOTTOM_OFFSET = 24;
export const MAX_VOICE_OVERLAY_BOTTOM_OFFSET = 160;

function clampOverlayOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOICE_OVERLAY_OPACITY;
  }

  return Math.min(
    MAX_VOICE_OVERLAY_OPACITY,
    Math.max(MIN_VOICE_OVERLAY_OPACITY, Math.round(value)),
  );
}

function normalizeBoolean(rawValue: string | null | undefined, fallback: boolean): boolean {
  if (rawValue == null) {
    return fallback;
  }
  return rawValue === 'true';
}

function clampOverlayTranscriptLines(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES;
  }

  return Math.min(
    MAX_VOICE_OVERLAY_TRANSCRIPT_LINES,
    Math.max(MIN_VOICE_OVERLAY_TRANSCRIPT_LINES, Math.round(value)),
  );
}

function clampOverlayBottomOffset(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET;
  }

  return Math.min(
    MAX_VOICE_OVERLAY_BOTTOM_OFFSET,
    Math.max(MIN_VOICE_OVERLAY_BOTTOM_OFFSET, Math.round(value)),
  );
}

const opacityModule = createConfigModule<number>({
  storageKey: VOICE_OVERLAY_OPACITY_STORAGE_KEY,
  eventName: VOICE_OVERLAY_OPACITY_CHANGED_EVENT,
  defaultValue: DEFAULT_VOICE_OVERLAY_OPACITY,
  normalize: (rawValue) => clampOverlayOpacity(Number.parseInt(rawValue ?? '', 10)),
  serialize: (value) => String(clampOverlayOpacity(value)),
  persistMode: 'runtime-preferred',
});

const diagnosticsModule = createConfigModule<boolean>({
  storageKey: VOICE_OVERLAY_SHOW_DIAGNOSTICS_STORAGE_KEY,
  eventName: VOICE_OVERLAY_SHOW_DIAGNOSTICS_CHANGED_EVENT,
  defaultValue: DEFAULT_VOICE_OVERLAY_SHOW_DIAGNOSTICS,
  normalize: (rawValue) => normalizeBoolean(rawValue, DEFAULT_VOICE_OVERLAY_SHOW_DIAGNOSTICS),
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

const transcriptLinesModule = createConfigModule<number>({
  storageKey: VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY,
  eventName: VOICE_OVERLAY_TRANSCRIPT_LINES_CHANGED_EVENT,
  defaultValue: DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES,
  normalize: (rawValue) => clampOverlayTranscriptLines(Number.parseInt(rawValue ?? '', 10)),
  serialize: (value) => String(clampOverlayTranscriptLines(value)),
  persistMode: 'runtime-preferred',
});

const bottomOffsetModule = createConfigModule<number>({
  storageKey: VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY,
  eventName: VOICE_OVERLAY_BOTTOM_OFFSET_CHANGED_EVENT,
  defaultValue: DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET,
  normalize: (rawValue) => clampOverlayBottomOffset(Number.parseInt(rawValue ?? '', 10)),
  serialize: (value) => String(clampOverlayBottomOffset(value)),
  persistMode: 'runtime-preferred',
});

export function getVoiceOverlayOpacity(): number {
  return opacityModule.get();
}

export function setVoiceOverlayOpacity(value: number): number {
  return opacityModule.set(value);
}

export function subscribeVoiceOverlayOpacityChanges(
  listener: (value: number) => void,
): () => void {
  return opacityModule.subscribe(listener);
}

export function getVoiceOverlayShowDiagnostics(): boolean {
  return diagnosticsModule.get();
}

export function setVoiceOverlayShowDiagnostics(value: boolean): boolean {
  return diagnosticsModule.set(value);
}

export function subscribeVoiceOverlayShowDiagnosticsChanges(
  listener: (value: boolean) => void,
): () => void {
  return diagnosticsModule.subscribe(listener);
}

export function getVoiceOverlayTranscriptLines(): number {
  return transcriptLinesModule.get();
}

export function setVoiceOverlayTranscriptLines(value: number): number {
  return transcriptLinesModule.set(value);
}

export function subscribeVoiceOverlayTranscriptLinesChanges(
  listener: (value: number) => void,
): () => void {
  return transcriptLinesModule.subscribe(listener);
}

export function getVoiceOverlayBottomOffset(): number {
  return bottomOffsetModule.get();
}

export function setVoiceOverlayBottomOffset(value: number): number {
  return bottomOffsetModule.set(value);
}

export function subscribeVoiceOverlayBottomOffsetChanges(
  listener: (value: number) => void,
): () => void {
  return bottomOffsetModule.subscribe(listener);
}
