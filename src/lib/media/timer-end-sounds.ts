export type TimerEndSoundPresetId =
  | 'dang'
  | 'ring-10'
  | 'cow-mooing'
  | 'pass-round'
  | 'level-up'
  | 'space-center-alert';

export interface TimerEndSoundPreset {
  id: TimerEndSoundPresetId;
  label: string;
  url: string;
}

export const TIMER_END_SOUND_PRESETS: readonly TimerEndSoundPreset[] = [
  {
    id: 'dang',
    label: 'Dang',
    url: new URL('../../assets/sounds/timer-end/timer-end-dang.wav', import.meta.url).toString(),
  },
  {
    id: 'ring-10',
    label: 'Ring 10',
    url: new URL('../../assets/sounds/timer-end/timer-end-ring-10.wav', import.meta.url).toString(),
  },
  {
    id: 'cow-mooing',
    label: 'Cow mooing',
    url: new URL('../../assets/sounds/timer-end/timer-end-cow-mooing.wav', import.meta.url).toString(),
  },
  {
    id: 'pass-round',
    label: 'Pass round',
    url: new URL('../../assets/sounds/timer-end/timer-end-pass-round.wav', import.meta.url).toString(),
  },
  {
    id: 'level-up',
    label: 'Level up',
    url: new URL('../../assets/sounds/timer-end/timer-end-level-up.ogg', import.meta.url).toString(),
  },
  {
    id: 'space-center-alert',
    label: 'Space center alert',
    url: new URL('../../assets/sounds/timer-end/timer-end-space-center-alert.wav', import.meta.url).toString(),
  },
] as const;

export const DEFAULT_TIMER_END_SOUND_PRESET_ID: TimerEndSoundPresetId = 'dang';

export function getTimerEndSoundPresetById(
  id: string | null | undefined,
): TimerEndSoundPreset {
  const normalizedId = (id ?? '').trim() as TimerEndSoundPresetId;
  return (
    TIMER_END_SOUND_PRESETS.find((preset) => preset.id === normalizedId) ??
    TIMER_END_SOUND_PRESETS.find((preset) => preset.id === DEFAULT_TIMER_END_SOUND_PRESET_ID) ??
    TIMER_END_SOUND_PRESETS[0]
  );
}

