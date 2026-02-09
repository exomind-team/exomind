import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { MOSSASRAdapter } from '@/lib/adapters/asr/moss-asr';
import type { IASRPort } from '@/lib/ports/asr-port';

function createMockAdapter(overrides?: Partial<IASRPort>): IASRPort {
  return {
    configure: vi.fn(),
    getSupportedLanguages: vi.fn(() => ['zh-CN']),
    transcribe: vi.fn().mockResolvedValue({
      text: '识别成功',
      confidence: 0.9,
      lang: 'zh-CN',
    }),
    streamTranscribe: vi.fn(async function* streamTranscribe() {
      yield { text: '', isFinal: true };
    }),
    isAvailable: vi.fn(() => true),
    ...overrides,
  };
}

function installMediaMocks(stopDelayMs: number) {
  const trackStop = vi.fn();
  const stream = {
    getTracks: () => [{ stop: trackStop }],
  } as unknown as MediaStream;

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
    },
  });

  class MockAudioContext {
    state: AudioContextState = 'running';
    sampleRate = 48000;

    createAnalyser() {
      return {
        fftSize: 256,
        frequencyBinCount: 32,
        getByteFrequencyData: (_arr: Uint8Array) => {},
      } as unknown as AnalyserNode;
    }

    createMediaStreamSource(_stream: MediaStream) {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as MediaStreamAudioSourceNode;
    }

    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
  }

  type StopListener = (event: Event) => void;

  class MockMediaRecorder {
    static isTypeSupported = vi.fn(() => true);
    state: RecordingState = 'inactive';
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: ((event: Event) => void) | null = null;
    private stopListeners: StopListener[] = [];

    constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

    start(_timeslice?: number) {
      this.state = 'recording';
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      setTimeout(() => {
        const blob = new Blob(['audio'], { type: 'audio/webm' });
        this.ondataavailable?.({ data: blob } as BlobEvent);
        const event = new Event('stop');
        this.onstop?.(event);
        this.stopListeners.forEach((listener) => listener(event));
      }, stopDelayMs);
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type !== 'stop') return;
      const fn =
        typeof listener === 'function'
          ? (listener as StopListener)
          : ((event: Event) => listener.handleEvent(event));
      this.stopListeners.push(fn);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type !== 'stop') return;
      const fn =
        typeof listener === 'function'
          ? (listener as StopListener)
          : ((event: Event) => listener.handleEvent(event));
      this.stopListeners = this.stopListeners.filter((item) => item !== fn);
    }
  }

  (globalThis as any).AudioContext = MockAudioContext;
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  return { trackStop };
}

describe('VoiceInputButton behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(MOSSASRAdapter, 'webmToWav').mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for recorder stop event before reading chunks', async () => {
    installMediaMocks(250);
    const onResult = vi.fn();
    const onError = vi.fn();
    const mockAdapter = createMockAdapter();

    render(
      <VoiceInputButton
        adapter={mockAdapter}
        onResult={onResult}
        onError={onError}
        showWaveform={false}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button); // start

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(button); // stop

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onResult).toHaveBeenCalledWith('识别成功');
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not emit result after user cancels during recognizing', async () => {
    installMediaMocks(0);
    const onResult = vi.fn();
    const onError = vi.fn();

    let resolveTranscribe: ((value: { text: string; confidence: number; lang: string }) => void) | null = null;
    const transcribe = vi.fn().mockImplementation(
      () =>
        new Promise<{ text: string; confidence: number; lang: string }>((resolve) => {
          resolveTranscribe = resolve;
        })
    );

    const mockAdapter = createMockAdapter({ transcribe });

    render(
      <VoiceInputButton
        adapter={mockAdapter}
        onResult={onResult}
        onError={onError}
        showWaveform={false}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button); // start

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(button); // stop -> recognizing

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    await act(async () => {
      resolveTranscribe?.({ text: 'late result', confidence: 0.9, lang: 'zh-CN' });
      await Promise.resolve();
    });

    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
