import type {
  FocusBgmPlaybackMode,
  FocusBgmPreferences,
} from '@/config/focus-bgm-preferences';
import { getFocusBgmPresetById, type FocusBgmPreset } from '@/lib/media/focus-bgm-presets';
import { readFocusBgmTrackBytes } from '@/lib/media/focus-bgm-file-picker';

export interface FocusBgmPlayerState {
  status: 'idle' | 'playing' | 'paused';
  sourceType: FocusBgmPreferences['sourceType'] | null;
  trackLabel: string | null;
  currentIndex: number;
  total: number;
}

interface NoiseRuntime {
  context: AudioContext;
  gainNode: GainNode;
  sourceNode: AudioBufferSourceNode;
}

function guessAudioMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function createNoiseBuffer(
  context: AudioContext,
  preset: FocusBgmPreset,
): AudioBuffer {
  const sampleRate = 44_100;
  const durationSeconds = 2;
  const frameCount = sampleRate * durationSeconds;
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);

  let pinkB0 = 0;
  let pinkB1 = 0;
  let pinkB2 = 0;
  let pinkB3 = 0;
  let pinkB4 = 0;
  let pinkB5 = 0;
  let pinkB6 = 0;
  let brownLast = 0;

  for (let index = 0; index < frameCount; index += 1) {
    const white = Math.random() * 2 - 1;
    if (preset.noiseColor === 'white') {
      channel[index] = white * 0.22;
      continue;
    }

    if (preset.noiseColor === 'pink') {
      pinkB0 = 0.99886 * pinkB0 + white * 0.0555179;
      pinkB1 = 0.99332 * pinkB1 + white * 0.0750759;
      pinkB2 = 0.96900 * pinkB2 + white * 0.1538520;
      pinkB3 = 0.86650 * pinkB3 + white * 0.3104856;
      pinkB4 = 0.55000 * pinkB4 + white * 0.5329522;
      pinkB5 = -0.7616 * pinkB5 - white * 0.0168980;
      const pink = pinkB0 + pinkB1 + pinkB2 + pinkB3 + pinkB4 + pinkB5 + pinkB6 + white * 0.5362;
      pinkB6 = white * 0.115926;
      channel[index] = pink * 0.11;
      continue;
    }

    brownLast = (brownLast + 0.02 * white) / 1.02;
    channel[index] = brownLast * 3.5 * 0.18;
  }

  return buffer;
}

export class FocusBgmPlayer {
  private listeners = new Set<(state: FocusBgmPlayerState) => void>();
  private state: FocusBgmPlayerState = {
    status: 'idle',
    sourceType: null,
    trackLabel: null,
    currentIndex: -1,
    total: 0,
  };
  private lastPreferences: FocusBgmPreferences | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private activeObjectUrl: string | null = null;
  private noiseRuntime: NoiseRuntime | null = null;
  private disposed = false;

  private hasPlayableRuntime(preferences: FocusBgmPreferences): boolean {
    return preferences.enabled
      && (preferences.sourceType === 'preset' || preferences.customTracks.length > 0);
  }

  private areTrackListsEqual(
    left: FocusBgmPreferences['customTracks'],
    right: FocusBgmPreferences['customTracks'],
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((track, index) => {
      const candidate = right[index];
      return candidate?.path === track.path && candidate?.name === track.name;
    });
  }

  private applyVolume(preferences: FocusBgmPreferences): void {
    const volume = preferences.volume / 100;

    if (this.activeAudio) {
      this.activeAudio.volume = volume;
    }

    if (this.noiseRuntime) {
      this.noiseRuntime.gainNode.gain.value = volume;
    }
  }

  getState(): FocusBgmPlayerState {
    return this.state;
  }

  subscribe(listener: (state: FocusBgmPlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  private setState(next: FocusBgmPlayerState): void {
    this.state = next;
    this.emit();
  }

  private clearActiveObjectUrl(): void {
    if (!this.activeObjectUrl) {
      return;
    }

    URL.revokeObjectURL(this.activeObjectUrl);
    this.activeObjectUrl = null;
  }

  private async teardownNoiseRuntime(): Promise<void> {
    if (!this.noiseRuntime) {
      return;
    }

    this.noiseRuntime.sourceNode.stop();
    this.noiseRuntime.sourceNode.disconnect();
    this.noiseRuntime.gainNode.disconnect();
    await this.noiseRuntime.context.close();
    this.noiseRuntime = null;
  }

  async stop(): Promise<void> {
    this.lastPreferences = this.lastPreferences;
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.onended = null;
      this.activeAudio = null;
    }
    await this.teardownNoiseRuntime();
    this.clearActiveObjectUrl();
    this.setState({
      status: 'idle',
      sourceType: null,
      trackLabel: null,
      currentIndex: -1,
      total: 0,
    });
  }

  async startFromPreferences(preferences: FocusBgmPreferences): Promise<void> {
    this.lastPreferences = preferences;

    if (!preferences.enabled) {
      await this.stop();
      return;
    }

    if (preferences.sourceType === 'preset') {
      await this.startPreset(preferences);
      return;
    }

    if (preferences.customTracks.length === 0) {
      await this.stop();
      return;
    }

    await this.startCustomTrack(preferences, 0);
  }

  async syncRuntimePreferences(preferences: FocusBgmPreferences): Promise<void> {
    const previous = this.lastPreferences;
    this.lastPreferences = preferences;

    if (this.state.status === 'idle') {
      return;
    }

    if (!this.hasPlayableRuntime(preferences)) {
      await this.stop();
      return;
    }

    if (!previous) {
      this.applyVolume(preferences);
      return;
    }

    const sourceChanged = previous.sourceType !== preferences.sourceType;
    const presetChanged = preferences.sourceType === 'preset' && previous.presetId !== preferences.presetId;
    const tracksChanged = preferences.sourceType === 'custom'
      && !this.areTrackListsEqual(previous.customTracks, preferences.customTracks);

    if (sourceChanged || presetChanged || tracksChanged) {
      await this.startFromPreferences(preferences);
      return;
    }

    this.applyVolume(preferences);
  }

  async pause(): Promise<void> {
    if (this.state.status !== 'playing') {
      return;
    }

    if (this.activeAudio) {
      this.activeAudio.pause();
    }
    if (this.noiseRuntime) {
      await this.noiseRuntime.context.suspend();
    }

    this.setState({
      ...this.state,
      status: 'paused',
    });
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') {
      return;
    }

    if (this.activeAudio) {
      await this.activeAudio.play();
    }
    if (this.noiseRuntime) {
      await this.noiseRuntime.context.resume();
    }

    this.setState({
      ...this.state,
      status: 'playing',
    });
  }

  async toggle(): Promise<void> {
    if (this.state.status === 'playing') {
      await this.pause();
      return;
    }

    if (this.state.status === 'paused') {
      await this.resume();
      return;
    }

    if (this.lastPreferences?.enabled) {
      await this.startFromPreferences(this.lastPreferences);
    }
  }

  private async startPreset(preferences: FocusBgmPreferences): Promise<void> {
    await this.stop();

    const AudioContextCtor = globalThis.AudioContext;
    if (!AudioContextCtor) {
      throw new Error('AudioContext is unavailable in current runtime');
    }

    const preset = getFocusBgmPresetById(preferences.presetId);
    const context = new AudioContextCtor();
    const gainNode = context.createGain();
    gainNode.gain.value = preferences.volume / 100;
    const sourceNode = context.createBufferSource();
    sourceNode.buffer = createNoiseBuffer(context, preset);
    sourceNode.loop = true;
    sourceNode.connect(gainNode);
    gainNode.connect(context.destination);
    sourceNode.start();

    this.noiseRuntime = { context, gainNode, sourceNode };
    this.setState({
      status: 'playing',
      sourceType: 'preset',
      trackLabel: preset.label,
      currentIndex: 0,
      total: 1,
    });
  }

  private async startCustomTrack(
    preferences: FocusBgmPreferences,
    index: number,
  ): Promise<void> {
    const track = preferences.customTracks[index];
    if (!track) {
      await this.stop();
      return;
    }

    if (this.noiseRuntime) {
      await this.teardownNoiseRuntime();
    }
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.onended = null;
      this.activeAudio = null;
    }
    this.clearActiveObjectUrl();

    const bytes = await readFocusBgmTrackBytes(track.path);
    const blob = new Blob([bytes], { type: guessAudioMimeType(track.path) });
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.loop = false;
    audio.preload = 'auto';
    audio.currentTime = 0;
    audio.volume = preferences.volume / 100;
    audio.onended = () => {
      void this.handleTrackEnded(index);
    };
    await audio.play();

    this.activeAudio = audio;
    this.activeObjectUrl = objectUrl;
    this.setState({
      status: 'playing',
      sourceType: 'custom',
      trackLabel: track.name,
      currentIndex: index,
      total: preferences.customTracks.length,
    });
  }

  private async handleTrackEnded(currentIndex: number): Promise<void> {
    if (this.disposed) {
      return;
    }

    const preferences = this.lastPreferences;
    if (!preferences || !this.hasPlayableRuntime(preferences)) {
      await this.stop();
      return;
    }

    const mode: FocusBgmPlaybackMode = preferences.playbackMode;

    const nextIndex = currentIndex + 1;
    if (nextIndex < preferences.customTracks.length) {
      await this.startCustomTrack(preferences, nextIndex);
      return;
    }

    if (mode === 'loop' && preferences.customTracks.length > 0) {
      await this.startCustomTrack(preferences, 0);
      return;
    }

    await this.stop();
  }

  async destroy(): Promise<void> {
    this.disposed = true;
    await this.stop();
    this.listeners.clear();
  }
}

let focusBgmPlayerInstance: FocusBgmPlayer | null = null;

export function createFocusBgmPlayer(): FocusBgmPlayer {
  return new FocusBgmPlayer();
}

export function getFocusBgmPlayer(): FocusBgmPlayer {
  if (!focusBgmPlayerInstance) {
    focusBgmPlayerInstance = createFocusBgmPlayer();
  }

  return focusBgmPlayerInstance;
}
