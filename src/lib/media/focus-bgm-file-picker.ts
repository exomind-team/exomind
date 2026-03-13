import { invoke, isTauri } from '@tauri-apps/api/core';
import type { FocusBgmTrack } from '@/config/focus-bgm-preferences';

function normalizePickedTrack(track: FocusBgmTrack): FocusBgmTrack {
  return {
    path: track.path.trim(),
    name: track.name.trim() || track.path.trim().replace(/\\/g, '/').split('/').pop() || track.path.trim(),
  };
}

export async function pickFocusBgmTracks(): Promise<FocusBgmTrack[]> {
  if (!await isTauri()) {
    throw new Error('仅桌面端支持选择本地背景音频');
  }

  const picked = await invoke<FocusBgmTrack[] | null>('pick_audio_files');
  if (!Array.isArray(picked)) {
    return [];
  }

  return picked
    .filter((track): track is FocusBgmTrack => Boolean(track?.path && track?.name))
    .map(normalizePickedTrack);
}

export async function readFocusBgmTrackBytes(path: string): Promise<Uint8Array> {
  if (!await isTauri()) {
    throw new Error('仅桌面端支持读取本地背景音频');
  }

  const bytes = await invoke<number[]>('read_file_binary', { path });
  return new Uint8Array(bytes);
}
