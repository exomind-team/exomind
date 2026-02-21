import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
    localStorage.clear();
  });

  it('does not pass adapterConfig when apiKey is empty', () => {
    render(<MOSSASRTestPage />);
    expect(screen.getByTestId('mock-voice-input-button')).toBeInTheDocument();
    expect(latestVoiceButtonProps?.adapterConfig).toBeUndefined();
  });

  it('passes adapterConfig with apiKey after input', () => {
    render(<MOSSASRTestPage />);

    const input = screen.getByPlaceholderText('sk-xxxxxxxxxxxxxxxxxxxxxxxx');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });

    expect(latestVoiceButtonProps?.adapterConfig).toEqual({ apiKey: 'sk-test-key' });
  });

  it('shortcut hints match implemented shortcuts', () => {
    render(<MOSSASRTestPage />);
    expect(screen.queryByText(/Ctrl \+ 空格/)).not.toBeInTheDocument();
  });
});
