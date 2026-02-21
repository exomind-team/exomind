/**
 * VoiceInputButton 单元测试
 *
 * 注意：这些测试需要完整的浏览器 API（AudioContext、MediaRecorder 等），
 * 而 happy-dom 环境不支持这些 API。
 * 建议使用 Playwright E2E 测试来覆盖这些场景。
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { IASRPort } from '@/lib/ports/asr-port';
import { VoiceInputButton } from '@/components/VoiceInputButton';

// Mock adapter helper
function createMockAdapter(): IASRPort {
  return {
    configure: vi.fn(),
    getSupportedLanguages: vi.fn(() => ['zh-CN', 'en-US']),
    transcribe: vi.fn().mockResolvedValue({
      text: '测试结果',
      confidence: 0.9,
      lang: 'zh-CN',
    }),
    streamTranscribe: vi.fn(),
    isAvailable: vi.fn(() => true),
  };
}

// VoiceInputButton 组件测试需要完整的浏览器 API，跳过这些测试
// TODO: 使用 Playwright E2E 测试覆盖这些场景
describe.skip('VoiceInputButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
      configurable: true,
    });

    // Mock navigator.permissions
    Object.defineProperty(navigator, 'permissions', {
      value: {
        query: vi.fn().mockResolvedValue({ state: 'granted' }),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染默认状态', () => {
    const mockAdapter = createMockAdapter();

    render(
      <VoiceInputButton
        adapter={mockAdapter}
        onResult={vi.fn()}
        onError={vi.fn()}
        onStateChange={vi.fn()}
      />
    );

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('显示快捷键提示', () => {
    const mockAdapter = createMockAdapter();

    render(
      <VoiceInputButton
        adapter={mockAdapter}
        onResult={vi.fn()}
        enableShortcut={true}
      />
    );

    expect(screen.getByText('按 [空格] 开始/停止')).toBeInTheDocument();
  });

  it('隐藏快捷键提示', () => {
    const mockAdapter = createMockAdapter();

    render(
      <VoiceInputButton
        adapter={mockAdapter}
        onResult={vi.fn()}
        enableShortcut={false}
      />
    );

    expect(screen.queryByText('按 [空格] 开始/停止')).not.toBeInTheDocument();
  });

  it('自定义按钮大小', () => {
    const mockAdapter = createMockAdapter();
    const customSize = 100;

    render(
      <VoiceInputButton
        adapter={mockAdapter}
        onResult={vi.fn()}
        size={customSize}
      />
    );

    const button = screen.getByRole('button');
    expect(button.style.width).toBe(`${customSize}px`);
    expect(button.style.height).toBe(`${customSize}px`);
  });

  it('自定义类名', () => {
    const mockAdapter = createMockAdapter();
    const customClass = 'my-custom-button';

    render(
      <VoiceInputButton
        adapter={mockAdapter}
        onResult={vi.fn()}
        className={customClass}
      />
    );

    const container = screen.getByRole('button').parentElement;
    expect(container).toHaveClass(customClass);
  });
});
