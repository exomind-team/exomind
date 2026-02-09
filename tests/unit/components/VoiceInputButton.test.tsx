/**
 * VoiceInputButton 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { IASRPort } from '@/lib/ports/asr-port';
import { VoiceInputButton } from '@/components/VoiceInputButton';

// Mock adapter
const createMockAdapter = (): IASRPort => ({
  configure: vi.fn(),
  getSupportedLanguages: vi.fn(() => ['zh-CN', 'en-US']),
  transcribe: vi.fn().mockResolvedValue({
    text: '测试结果',
    confidence: 0.9,
    lang: 'zh-CN',
  }),
  streamTranscribe: vi.fn(),
  isAvailable: vi.fn(() => true),
});

describe('VoiceInputButton', () => {
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

    // 应该有麦克风按钮
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

    // 快捷键提示应该显示
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

    // 快捷键提示应该不显示
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
    expect(button).toHaveStyle({ width: `${customSize}px`, height: `${customSize}px` });
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
