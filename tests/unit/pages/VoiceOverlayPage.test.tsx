import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { trimToLatestCharacters } from '@/lib/voice/overlay-text';

let overlayListener: ((event: { payload: Record<string, unknown> }) => void) | null = null;

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, listener: (event: { payload: Record<string, unknown> }) => void) => {
    if (eventName === 'voice-overlay-state') {
      overlayListener = listener;
    }
    return () => {
      overlayListener = null;
    };
  }),
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  getVoiceShortcutHotkey: vi.fn(() => 'Alt+Q'),
  subscribeVoiceShortcutHotkeyChanges: vi.fn(() => () => {}),
}));

import { VoiceOverlayPage } from '@/pages/VoiceOverlayPage';

describe('VoiceOverlayPage', () => {
  it('renders as a single left-aligned translucent card shell（单层左对齐半透明卡片）', async () => {
    const { container } = render(<VoiceOverlayPage />);

    await act(async () => {
      overlayListener?.({
        payload: {
          state: 'recording',
          duration: 1,
        },
      });
    });

    const styleTag = container.querySelector('style');
    expect(styleTag?.textContent).toContain('grid-template-columns: 28px minmax(0, 1fr);');
    expect(styleTag?.textContent).toContain('text-align: left;');
    expect(styleTag?.textContent).toContain('border: none;');
    expect(styleTag?.textContent).toContain('width: min(520px, calc(100vw - 24px));');
  });

  it('shows recognition elapsed time on done state', async () => {
    render(<VoiceOverlayPage />);

    await act(async () => {
      overlayListener?.({
        payload: {
          state: 'done',
          text: '你好世界',
          providerLabel: '火山',
          recognitionMs: 1234,
        },
      });
    });

    expect(screen.getByText('你好世界')).toBeInTheDocument();
    expect(screen.getByText('火山 · 识别 1.23s')).toBeInTheDocument();
  });

  it('shows live preview with fixed-width duration and provider meta（录音中显示实时预览、固定宽度时间与模型信息）', async () => {
    render(<VoiceOverlayPage />);
    const longText = Array.from({ length: 120 }, (_, index) => String(index % 10)).join('');

    await act(async () => {
      overlayListener?.({
        payload: {
          state: 'recording',
          duration: 3,
          text: longText,
          isLivePreview: true,
          providerLabel: '火山 2.0 小时版 · 双向流式优化版（推荐）',
        },
      });
    });

    expect(screen.getByText(trimToLatestCharacters(longText, 100))).toBeInTheDocument();
    expect(screen.getByText('火山 2.0 小时版 · 双向流式优化版（推荐）')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === '00:03实时预览 · 再按 Alt+Q 结束 · Esc 取消')
    ).toBeInTheDocument();
  });

  it('shows finish and cancel shortcut hints while recognizing（识别中显示快捷键提示）', async () => {
    render(<VoiceOverlayPage />);

    await act(async () => {
      overlayListener?.({
        payload: {
          state: 'recognizing',
          text: '火山收口阶段',
          isLivePreview: true,
          providerLabel: '火山 2.0 小时版 · 双向流式优化版（推荐）',
        },
      });
    });

    expect(screen.getByText('火山收口阶段')).toBeInTheDocument();
    expect(screen.getByText('识别中... · Alt+Q 开始新一轮 · Esc 取消')).toBeInTheDocument();
  });
});
