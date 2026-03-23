import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOSSASRTestPage } from '@/pages/MOSSASRTestPage';

let latestVoiceButtonProps: any = null;

vi.mock('@/components/VoiceInputButton', () => ({
  VoiceInputButton: (props: any) => {
    latestVoiceButtonProps = props;
    return <div data-testid="mock-voice-input-button" />;
  },
}));

// MOSSASRTestPage 测试需要 DOM 环境
const isDomAvailable = typeof document !== 'undefined';

(isDomAvailable ? describe : describe.skip)('MOSSASRTestPage', () => {
  beforeEach(() => {
    latestVoiceButtonProps = null;
    if (typeof window.localStorage?.clear === 'function') {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not pass adapterConfig when apiKey is empty', () => {
    render(<MOSSASRTestPage />);
    expect(screen.getByTestId('mock-voice-input-button')).toBeInTheDocument();
    expect(latestVoiceButtonProps?.adapterConfig).toBeUndefined();
  });

  it('passes adapterConfig with apiKey from settings storage', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'moss_api_key' ? 'sk-test-key' : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    } as unknown as Storage);

    render(<MOSSASRTestPage />);

    await waitFor(() => {
      expect(latestVoiceButtonProps?.adapterConfig).toEqual({ apiKey: 'sk-test-key' });
    });
  });

  it('shortcut hints match implemented shortcuts', () => {
    render(<MOSSASRTestPage />);
    expect(screen.queryByText(/Ctrl \+ 空格/)).not.toBeInTheDocument();
  });
});
