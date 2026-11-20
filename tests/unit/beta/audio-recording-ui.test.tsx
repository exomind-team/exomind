import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaAudioRecorder } from '@/beta/BetaAudioRecorder';
import { BetaAudioRecordingController } from '@/beta/beta-audio-recording';

class FakeTrack {
  stop = vi.fn();
}

class FakeStream {
  readonly track = new FakeTrack();
  getTracks() { return [this.track] as unknown as MediaStreamTrack[]; }
}

class FakeRecorder {
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: MediaRecorder['ondataavailable'] = null;
  onerror: MediaRecorder['onerror'] = null;
  onstop: MediaRecorder['onstop'] = null;
  start = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.call(this as unknown as MediaRecorder, new Event('stop')));
  });
  emit(bytes: number) {
    this.ondataavailable?.call(this as unknown as MediaRecorder, {
      data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }),
    } as BlobEvent);
  }
}

afterEach(() => { vi.useRealTimers(); });

describe('BetaAudioRecorder view lifecycle', () => {
  it('does not request the microphone on mount and does not stop or duplicate a session when the view unmounts', async () => {
    const stream = new FakeStream();
    const recorder = new FakeRecorder();
    const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
    const createRecorder = vi.fn(() => recorder as unknown as MediaRecorder);
    const controller = new BetaAudioRecordingController({ getUserMedia, createRecorder, isTypeSupported: () => true });
    const onAddFile = vi.fn(async () => {});

    const firstView = render(<BetaAudioRecorder controller={controller} profileId="profile-p" onAddFile={onAddFile} />);
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始原声录音' }));
    await waitFor(() => expect(controller.snapshot().phase).toBe('recording'));
    recorder.emit(8);
    firstView.unmount();

    expect(controller.snapshot().phase).toBe('recording');
    expect(stream.track.stop).not.toHaveBeenCalled();
    const secondView = render(<BetaAudioRecorder controller={controller} profileId="profile-p" onAddFile={onAddFile} />);
    expect(screen.getByTestId('beta-audio-recording-status')).toBeVisible();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(createRecorder).toHaveBeenCalledTimes(1);

    await act(async () => { await controller.stop(); });
    expect(controller.snapshot().phase).toBe('awaiting_attachment');
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    secondView.unmount();
    controller.dispose();
  });

  it('leaves the current text flow untouched and offers no recognition action', async () => {
    const controller = new BetaAudioRecordingController({
      getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream),
      createRecorder: () => new FakeRecorder() as unknown as MediaRecorder,
      isTypeSupported: () => true,
    });
    const onAddFile = vi.fn(async () => {});
    render(<>
      <textarea aria-label="记录当下" defaultValue="仍保留的文字" />
      <BetaAudioRecorder controller={controller} profileId="profile-p" onAddFile={onAddFile} />
    </>);

    expect(screen.getByRole('textbox', { name: '记录当下' })).toHaveValue('仍保留的文字');
    expect(screen.queryByRole('button', { name: /识别|转写|转录/ })).not.toBeInTheDocument();
    expect(onAddFile).not.toHaveBeenCalled();
    controller.dispose();
  });
});
