export type FocusBgmPresetId = 'white-noise' | 'pink-noise' | 'brown-noise';

export type FocusBgmPresetKind = 'noise';

export interface FocusBgmPreset {
  id: FocusBgmPresetId;
  label: string;
  kind: FocusBgmPresetKind;
  noiseColor: 'white' | 'pink' | 'brown';
}

export const FOCUS_BGM_PRESETS: readonly FocusBgmPreset[] = [
  {
    id: 'white-noise',
    label: 'White noise',
    kind: 'noise',
    noiseColor: 'white',
  },
  {
    id: 'pink-noise',
    label: 'Pink noise',
    kind: 'noise',
    noiseColor: 'pink',
  },
  {
    id: 'brown-noise',
    label: 'Brown noise',
    kind: 'noise',
    noiseColor: 'brown',
  },
] as const;

export const DEFAULT_FOCUS_BGM_PRESET_ID: FocusBgmPresetId = 'white-noise';

export function getFocusBgmPresetById(id: string | null | undefined): FocusBgmPreset {
  const normalized = (id ?? '').trim() as FocusBgmPresetId;
  return (
    FOCUS_BGM_PRESETS.find((preset) => preset.id === normalized)
    ?? FOCUS_BGM_PRESETS.find((preset) => preset.id === DEFAULT_FOCUS_BGM_PRESET_ID)
    ?? FOCUS_BGM_PRESETS[0]
  );
}
