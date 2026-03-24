import { beforeEach, describe, expect, it, vi } from 'vitest';

const filePickerMocks = vi.hoisted(() => ({
  readFocusBgmTrackBytes: vi.fn(),
}));

vi.mock('@/lib/media/focus-bgm-file-picker', () => ({
  readFocusBgmTrackBytes: filePickerMocks.readFocusBgmTrackBytes,
}));

describe('focus bgm player（专注背景音播放器）', () => {
  let audioInstances: MockAudio[];
  let gainNodes: MockGainNode[];

  class MockAudio {
    src: string;
    loop = false;
    volume = 1;
    preload = '';
    currentTime = 0;
    onended: (() => void) | null = null;
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();

    constructor(src: string) {
      this.src = src;
      audioInstances.push(this);
    }
  }

  class MockGainNode {
    gain = { value: 1 };
    connect = vi.fn();
    disconnect = vi.fn();
  }

  class MockBufferSourceNode {
    buffer: unknown = null;
    loop = false;
    onended: (() => void) | null = null;
    connect = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    disconnect = vi.fn();
  }

  class MockAudioContext {
    destination = {};
    state: 'running' | 'suspended' | 'closed' = 'running';
    createGain = vi.fn(() => {
      const node = new MockGainNode();
      gainNodes.push(node);
      return node;
    });
    createBuffer = vi.fn((_channels: number, length: number, _sampleRate: number) => ({
      getChannelData: (_channel: number) => new Float32Array(length),
    }));
    createBufferSource = vi.fn(() => new MockBufferSourceNode());
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    suspend = vi.fn(async () => {
      this.state = 'suspended';
    });
    close = vi.fn(async () => {
      this.state = 'closed';
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    audioInstances = [];
    gainNodes = [];

    vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);
    vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
    vi.stubGlobal('URL', class MockUrl extends URL {} as unknown as typeof URL);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://track-1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    filePickerMocks.readFocusBgmTrackBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it('plays generated noise preset and updates state（可播放生成型噪音预设）', async () => {
    const module = await import('@/lib/media/focus-bgm-player');
    const player = module.createFocusBgmPlayer();

    const stateListener = vi.fn();
    const unsubscribe = player.subscribe(stateListener);

    await player.startFromPreferences({
      enabled: true,
      sourceType: 'preset',
      presetId: 'pink-noise',
      customTracks: [],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 55,
    });

    expect(player.getState()).toEqual(expect.objectContaining({
      status: 'playing',
      trackLabel: 'Pink noise',
      sourceType: 'preset',
    }));
    expect(stateListener).toHaveBeenCalled();

    unsubscribe();
  });

  it('plays custom tracks sequentially（本地多音频可顺序播放）', async () => {
    const module = await import('@/lib/media/focus-bgm-player');
    const player = module.createFocusBgmPlayer();

    await player.startFromPreferences({
      enabled: true,
      sourceType: 'custom',
      presetId: 'white-noise',
      customTracks: [
        { path: 'D:/music/one.mp3', name: 'one.mp3' },
        { path: 'D:/music/two.mp3', name: 'two.mp3' },
      ],
      playbackMode: 'sequence',
      stopBehavior: 'manual-end',
      volume: 80,
    });

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);

    audioInstances[0].onended?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(audioInstances).toHaveLength(2);
    expect(filePickerMocks.readFocusBgmTrackBytes).toHaveBeenCalledWith('D:/music/one.mp3');
    expect(filePickerMocks.readFocusBgmTrackBytes).toHaveBeenCalledWith('D:/music/two.mp3');
    expect(player.getState()).toEqual(expect.objectContaining({
      status: 'playing',
      trackLabel: 'two.mp3',
      currentIndex: 1,
    }));
  });

  it('restarts playlist in loop mode（循环模式会回到第一首）', async () => {
    const module = await import('@/lib/media/focus-bgm-player');
    const player = module.createFocusBgmPlayer();

    await player.startFromPreferences({
      enabled: true,
      sourceType: 'custom',
      presetId: 'white-noise',
      customTracks: [
        { path: 'D:/music/one.mp3', name: 'one.mp3' },
        { path: 'D:/music/two.mp3', name: 'two.mp3' },
      ],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 80,
    });

    audioInstances[0].onended?.();
    await Promise.resolve();
    await Promise.resolve();
    audioInstances[1].onended?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(audioInstances).toHaveLength(3);
    expect(player.getState()).toEqual(expect.objectContaining({
      status: 'playing',
      currentIndex: 0,
    }));
  });

  it('supports pause and resume（支持暂停与恢复）', async () => {
    const module = await import('@/lib/media/focus-bgm-player');
    const player = module.createFocusBgmPlayer();

    await player.startFromPreferences({
      enabled: true,
      sourceType: 'custom',
      presetId: 'white-noise',
      customTracks: [{ path: 'D:/music/one.mp3', name: 'one.mp3' }],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 30,
    });

    await player.pause();
    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(player.getState().status).toBe('paused');

    await player.resume();
    expect(audioInstances[0].play).toHaveBeenCalledTimes(2);
    expect(player.getState().status).toBe('playing');
  });

  it('updates custom track volume without restarting playback（运行中调整本地音频音量应立即生效且不重播）', async () => {
    const module = await import('@/lib/media/focus-bgm-player');
    const player = module.createFocusBgmPlayer();

    await player.startFromPreferences({
      enabled: true,
      sourceType: 'custom',
      presetId: 'white-noise',
      customTracks: [{ path: 'D:/music/one.mp3', name: 'one.mp3' }],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 20,
    });

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].volume).toBe(0.2);

    await player.syncRuntimePreferences({
      enabled: true,
      sourceType: 'custom',
      presetId: 'white-noise',
      customTracks: [{ path: 'D:/music/one.mp3', name: 'one.mp3' }],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 75,
    });

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].volume).toBe(0.75);
  });

  it('updates preset gain without recreating noise runtime（运行中调整预设噪音音量应立即生效）', async () => {
    const module = await import('@/lib/media/focus-bgm-player');
    const player = module.createFocusBgmPlayer();

    await player.startFromPreferences({
      enabled: true,
      sourceType: 'preset',
      presetId: 'brown-noise',
      customTracks: [],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 25,
    });

    expect(gainNodes).toHaveLength(1);
    expect(gainNodes[0].gain.value).toBe(0.25);

    await player.syncRuntimePreferences({
      enabled: true,
      sourceType: 'preset',
      presetId: 'brown-noise',
      customTracks: [],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 65,
    });

    expect(gainNodes).toHaveLength(1);
    expect(gainNodes[0].gain.value).toBe(0.65);
  });
});
