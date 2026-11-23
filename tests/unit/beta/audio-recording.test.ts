import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BetaAudioRecordingController,
  type BetaAudioRecordingPlatform,
} from '@/beta/beta-audio-recording';

class FakeTrack {
  stop = vi.fn();
}

class FakeStream {
  constructor(readonly tracks = [new FakeTrack()]) {}
  getTracks() { return this.tracks as unknown as MediaStreamTrack[]; }
}

class FakeRecorder {
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: MediaRecorder['ondataavailable'] = null;
  onerror: MediaRecorder['onerror'] = null;
  onstop: MediaRecorder['onstop'] = null;
  start = vi.fn((_timeslice?: number) => { this.state = 'recording'; });
  stop = vi.fn(() => {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.call(this as unknown as MediaRecorder, new Event('stop')));
  });

  emit(bytes: number, type = this.mimeType) {
    const data = new Blob([new Uint8Array(bytes)], { type });
    this.ondataavailable?.call(this as unknown as MediaRecorder, { data } as BlobEvent);
  }
}

function createHarness(platform: Partial<BetaAudioRecordingPlatform> = {}) {
  const streams: FakeStream[] = [];
  const recorders: FakeRecorder[] = [];
  const getUserMedia = vi.fn(async () => {
    const stream = new FakeStream(); streams.push(stream); return stream as unknown as MediaStream;
  });
  const createRecorder = vi.fn(() => {
    const recorder = new FakeRecorder(); recorders.push(recorder); return recorder as unknown as MediaRecorder;
  });
  const controller = new BetaAudioRecordingController({
    getUserMedia: getUserMedia as unknown as BetaAudioRecordingPlatform['getUserMedia'],
    createRecorder: createRecorder as unknown as BetaAudioRecordingPlatform['createRecorder'],
    isTypeSupported: () => true,
    ...platform,
  });
  return { controller, getUserMedia, createRecorder, streams, recorders };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => { vi.useRealTimers(); });

describe('BetaAudioRecordingController', () => {
  it('returns the current pending File only by explicit profile-scoped read and keeps it out of the snapshot', async () => {
    const { controller, recorders } = createHarness();
    expect(controller.getPendingFile('profile-p')).toBeNull();
    await controller.start('profile-p');
    recorders[0].emit(9);
    await controller.stop();

    const pendingFile = controller.getPendingFile('profile-p');
    expect(pendingFile).toBeInstanceOf(File);
    expect(pendingFile?.size).toBe(9);
    expect(controller.getPendingFile('profile-q')).toBeNull();
    expect(controller.snapshot()).not.toHaveProperty('file');

    expect(controller.discard('profile-p')).toBe(true);
    expect(controller.getPendingFile('profile-p')).toBeNull();
    controller.dispose();
  });

  it('only asks for a microphone after explicit start and releases a permission result that arrives after cancellation', async () => {
    let resolvePermission!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { resolvePermission = resolve; }));
    const createRecorder = vi.fn(() => new FakeRecorder() as unknown as MediaRecorder);
    const controller = new BetaAudioRecordingController({
      getUserMedia, createRecorder, isTypeSupported: () => true,
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    const starting = controller.start('profile-p');
    expect(controller.snapshot().phase).toBe('requesting_permission');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(controller.cancelStartup('profile-p')).toBe(true);
    expect(controller.snapshot().phase).toBe('idle');

    const track = new FakeTrack();
    resolvePermission(new FakeStream([track]) as unknown as MediaStream);
    await starting;
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(createRecorder).not.toHaveBeenCalled();
  });

  it('keeps the session profile-bound when the visible scope changes', async () => {
    const { controller, recorders } = createHarness();
    await controller.start('profile-p');
    recorders[0].emit(4);
    await controller.stop();
    await flushMicrotasks();

    const sink = vi.fn(async () => {});
    await expect(controller.accept('profile-q', sink)).rejects.toThrow('属于档案 profile-p');
    expect(sink).not.toHaveBeenCalled();
    await controller.accept('profile-p', sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe('profile-p');
    expect(controller.snapshot().phase).toBe('idle');
    controller.dispose();
  });

  it('retains the exact stopped File after sink rejection and retries it without losing bytes', async () => {
    const { controller, recorders } = createHarness();
    await controller.start('profile-p');
    recorders[0].emit(7);
    await controller.stop();
    await flushMicrotasks();
    expect(controller.snapshot().phase).toBe('awaiting_attachment');

    let firstFile: File | undefined;
    const sink = vi.fn()
      .mockImplementationOnce(async (_profileId: string, file: File) => { firstFile = file; throw new Error('本机附件暂存失败'); })
      .mockImplementationOnce(async (_profileId: string, file: File) => { expect(file).toBe(firstFile); });
    await expect(controller.accept('profile-p', sink)).rejects.toThrow('本机附件暂存失败');
    expect(controller.snapshot().phase).toBe('awaiting_attachment');
    expect(controller.snapshot().byteLength).toBe(7);
    expect(controller.snapshot().error).toContain('本机附件暂存失败');
    await controller.accept('profile-p', sink);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().phase).toBe('idle');
    controller.dispose();
  });

  it('uses the recording session ID to auto-save after explicit stop and keeps that identity for retry', async () => {
    const { controller, recorders } = createHarness();
    let firstFile: File | undefined;
    let sourceId: string | null = null;
    const sink = vi.fn()
      .mockImplementationOnce(async (profileId: string, file: File, id: string) => {
        expect(profileId).toBe('profile-p');
        firstFile = file; sourceId = id;
        throw new Error('草稿暂存失败');
      })
      .mockImplementationOnce(async (profileId: string, file: File, id: string) => {
        expect(profileId).toBe('profile-p');
        expect(file).toBe(firstFile);
        expect(id).toBe(sourceId);
      });
    controller.setAttachmentSink(sink);

    await controller.start('profile-p');
    const startedWith = controller.snapshot().sourceId;
    expect(startedWith).toBeTruthy();
    recorders[0].emit(6);
    expect(sink).not.toHaveBeenCalled();
    await controller.stop();
    await vi.waitFor(() => expect(controller.snapshot().phase).toBe('awaiting_attachment'));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][2]).toBe(startedWith);
    expect(controller.snapshot().sourceId).toBe(startedWith);

    await controller.accept('profile-p', sink);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1][1]).toBe(firstFile);
    expect(sink.mock.calls[1][2]).toBe(startedWith);
    expect(controller.snapshot().phase).toBe('idle');
    controller.dispose();
  });

  it('caps retained chunks at the configured byte limit and marks the clip partial', async () => {
    const { controller, recorders } = createHarness({ limits: { maxBytes: 5 } });
    await controller.start('profile-p');
    recorders[0].emit(3);
    recorders[0].emit(4);
    await flushMicrotasks();

    expect(controller.snapshot().phase).toBe('awaiting_attachment');
    expect(controller.snapshot().byteLength).toBe(5);
    expect(controller.snapshot().partial).toBe(true);
    expect(controller.snapshot().limitReached).toBe('bytes');
    let attached: File | undefined;
    await controller.accept('profile-p', async (_profileId, file) => { attached = file; });
    expect(attached?.size).toBe(5);
    expect(attached?.name).toContain('partial-');
    controller.dispose();
  });

  it('allows restarting after a microphone failure and stops only this session tracks', async () => {
    const stream = new FakeStream();
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('device busy'), { name: 'NotReadableError' }))
      .mockResolvedValueOnce(stream as unknown as MediaStream);
    const recorders: FakeRecorder[] = [];
    const controller = new BetaAudioRecordingController({
      getUserMedia,
      createRecorder: () => { const recorder = new FakeRecorder(); recorders.push(recorder); return recorder as unknown as MediaRecorder; },
      isTypeSupported: () => true,
    });

    await controller.start('profile-p');
    expect(controller.snapshot().phase).toBe('failed');
    expect(controller.snapshot().error).toContain('其他应用占用');
    await controller.start('profile-p');
    expect(controller.snapshot().phase).toBe('recording');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await controller.stop();
    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('preserves recorder-error chunks as a visibly partial attachment and supports explicit discard', async () => {
    const { controller, recorders, streams } = createHarness();
    await controller.start('profile-p');
    recorders[0].emit(6);
    recorders[0].onerror?.call(recorders[0] as unknown as MediaRecorder, new Event('error'));
    await flushMicrotasks();

    expect(controller.snapshot().phase).toBe('awaiting_attachment');
    expect(controller.snapshot().partial).toBe(true);
    expect(controller.snapshot().byteLength).toBe(6);
    expect(controller.snapshot().error).toContain('编码遇到问题');
    expect(controller.discard('profile-p')).toBe(true);
    expect(controller.snapshot().phase).toBe('idle');
    expect(streams[0].tracks[0].stop).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('releases the owned track and chunks when the device workspace closes', async () => {
    const { controller, recorders, streams } = createHarness();
    await controller.start('profile-p');
    recorders[0].emit(6);
    controller.dispose();
    expect(streams[0].tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(recorders[0].ondataavailable).toBeNull();
    expect(recorders[0].onstop).toBeNull();
  });

  it('finishes at the configured duration limit and reports the actual elapsed time', async () => {
    vi.useFakeTimers();
    let now = 0;
    const { controller, recorders } = createHarness({
      now: () => now,
      limits: { maxDurationMs: 1000 },
    });
    await controller.start('profile-p');
    recorders[0].emit(3);
    now = 1000;
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(controller.snapshot().phase).toBe('awaiting_attachment');
    expect(controller.snapshot().durationMs).toBe(1000);
    expect(controller.snapshot().limitReached).toBe('duration');
    expect(controller.snapshot().byteLength).toBe(3);
    controller.dispose();
  });
});
