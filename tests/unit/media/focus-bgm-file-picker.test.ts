import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

describe('focus bgm file picker（专注背景音文件选择）', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.isTauri.mockResolvedValue(false);
    mocks.invoke.mockResolvedValue(null);
  });

  it('rejects custom local track picking on web（Web 下拒绝本地持久音频选择）', async () => {
    const module = await import('@/lib/media/focus-bgm-file-picker');

    await expect(module.pickFocusBgmTracks()).rejects.toThrow('仅桌面端支持选择本地背景音频');
  });

  it('returns tauri-picked tracks in original order（Tauri 下按原顺序返回多音频）', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'pick_audio_files') {
        return [
          { path: 'D:/music/rain.mp3', name: 'rain.mp3' },
          { path: 'D:/music/cafe.flac', name: 'cafe.flac' },
        ];
      }
      return null;
    });

    const module = await import('@/lib/media/focus-bgm-file-picker');

    await expect(module.pickFocusBgmTracks()).resolves.toEqual([
      { path: 'D:/music/rain.mp3', name: 'rain.mp3' },
      { path: 'D:/music/cafe.flac', name: 'cafe.flac' },
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith('pick_audio_files');
  });

  it('reads selected track bytes via tauri command（通过 Tauri 命令读取音频字节）', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      if (command === 'read_file_binary') {
        expect(payload).toEqual({ path: 'D:/music/rain.mp3' });
        return [1, 2, 3, 4];
      }
      return null;
    });

    const module = await import('@/lib/media/focus-bgm-file-picker');

    await expect(module.readFocusBgmTrackBytes('D:/music/rain.mp3')).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
