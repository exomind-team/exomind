import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyThemePreference } from '@/config/theme';

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

vi.mock('@/config/theme', () => ({
  getThemePreference: vi.fn(() => 'system'),
  applyThemePreference: vi.fn(() => 'light'),
  subscribeThemePreferenceChanges: vi.fn(() => () => {}),
  subscribeSystemThemeChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/voice-overlay-preferences', () => ({
  getVoiceOverlayOpacity: vi.fn(() => 74),
  subscribeVoiceOverlayOpacityChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: vi.fn(() => false),
}));

import { VoiceOverlayPage } from '@/pages/VoiceOverlayPage';

describe('VoiceOverlayPage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders as a larger single translucent shell（更大的单层半透明壳）', async () => {
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
    expect(applyThemePreference).toHaveBeenCalledWith('system');
    expect(styleTag?.textContent).toContain('html, body, #root {');
    expect(styleTag?.textContent).toContain('background: transparent !important;');
    expect(styleTag?.textContent).toContain('grid-template-columns: 28px minmax(0, 1fr);');
    expect(styleTag?.textContent).toContain('text-align: left;');
    expect(styleTag?.textContent).toContain('overflow-y: auto;');
    expect(styleTag?.textContent).toContain('border: none;');
    expect(styleTag?.textContent).toContain('width: min(560px, calc(100vw - 16px));');
    expect(styleTag?.textContent).toContain('min-height: 112px;');
    expect(styleTag?.textContent).toContain('hsl(var(--bg-card) / 0.74)');
  });

  it('shows startup hint while arming microphone and stream（启动中先显示准备提示）', async () => {
    render(<VoiceOverlayPage />);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1120);

    await act(async () => {
      overlayListener?.({
        payload: {
          state: 'arming',
          traceStartedAtMs: 1000,
          debugTraceId: 'trace-1',
        },
      });
    });

    expect(screen.getByText('准备启动语音输入…')).toBeInTheDocument();
    expect(screen.getByText('正在等待麦克风权限并连接识别链路')).toBeInTheDocument();
    expect(
      screen.getByText('调试 · 首帧 120ms')
    ).toBeInTheDocument();
    nowSpy.mockRestore();
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
    const longText = Array.from({ length: 160 }, (_, index) => String(index % 10)).join('');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);

    await act(async () => {
      overlayListener?.({
        payload: {
          state: 'recording',
          duration: 3,
          text: longText,
          traceStartedAtMs: 880,
          debugTraceId: 'trace-2',
          activationMs: 420,
          inputReadyMs: 260,
          sessionReadyMs: 310,
          inputWarmHit: true,
          sessionWarmHit: false,
          sessionWarmReason: 'stale',
          firstTextMs: 830,
          isLivePreview: true,
          providerLabel: '火山 2.0 小时版 · 双向流式优化版（推荐）',
        },
      });
    });

    expect(screen.getByText(longText)).toBeInTheDocument();
    expect(screen.getByText('火山 2.0 小时版 · 双向流式优化版（推荐）')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === '00:03唤起 420ms实时预览 · 再按 Alt+Q 结束 · Esc 取消')
    ).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) =>
        element?.textContent?.includes('首帧 120ms') &&
        element?.textContent?.includes('麦克风 260ms·预热') &&
        element?.textContent?.includes('会话 310ms·失热重建') &&
        element?.textContent?.includes('录音 420ms') &&
        element?.textContent?.includes('首字 830ms')
      ).length
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('voice-overlay-transcript')).toBeInTheDocument();
    const styleTag = document.querySelector('style');
    expect(styleTag?.textContent).toContain('.voice-overlay--recording .overlay-transcript .overlay-text');
    expect(styleTag?.textContent).toContain('color: hsl(var(--brand-accent));');
    nowSpy.mockRestore();
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
