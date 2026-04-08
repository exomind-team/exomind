import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

import {
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import {
  setVoiceRuntimeDoubaoAccessToken,
  setVoiceRuntimeDoubaoAppId,
} from '@/config/voice-runtime-doubao';
import {
  setVoiceRuntimeEnabled,
} from '@/config/voice-runtime-settings';
import {
  setVoiceRuntimeMode,
} from '@/config/voice-runtime-mode';
import { VoiceRuntimeLabPage } from '@/ui/app/pages/voice-runtime/VoiceRuntimeLabPage';

describe('VoiceRuntimeLabPage（语音运行时实验页）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('renders the desktop lab page skeleton（渲染桌面实验台骨架）', () => {
    render(<VoiceRuntimeLabPage />);

    expect(screen.getByText('语音运行时实验台')).toBeInTheDocument();
    expect(screen.getByText('开始测试')).toBeInTheDocument();
    expect(screen.getByText('实验页内完成测试')).toBeInTheDocument();
    expect(screen.getByText('准备情况')).toBeInTheDocument();
    expect(screen.getByText('桌面环境')).toBeInTheDocument();
    expect(screen.getByText('运行时')).toBeInTheDocument();
    expect(screen.getAllByText('运行模式').length).toBeGreaterThan(0);
    expect(screen.getByText('开始一次识别')).toBeInTheDocument();
    expect(screen.getByTestId('voice-runtime-status-card')).toBeInTheDocument();
    expect(screen.getByTestId('voice-runtime-controls-card')).toBeInTheDocument();
    expect(screen.getByTestId('voice-runtime-transcript-card')).toBeInTheDocument();
    expect(screen.getByTestId('voice-runtime-provider-events-card')).toBeInTheDocument();
    expect(screen.getByTestId('voice-runtime-speak-test-card')).toBeInTheDocument();
    expect(screen.getByLabelText('APP ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Access Token')).toBeInTheDocument();
    expect(screen.getByLabelText('Secret Key')).toBeInTheDocument();
    expect(screen.getByLabelText('模型版本')).toBeInTheDocument();
    expect(screen.getByLabelText('发音人')).toBeInTheDocument();
    expect(screen.getByText('启用语音运行时')).toBeInTheDocument();
    expect(screen.getByText('自动播报')).toBeInTheDocument();
    expect(screen.getAllByText('运行模式').length).toBeGreaterThan(0);
    expect(screen.getByText('云端会话')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始监听' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止并提交' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开设置' })).toBeInTheDocument();
    expect(screen.getByText('连接状态')).toBeInTheDocument();
    expect(screen.getByText('模型回复文本')).toBeInTheDocument();
    expect(screen.getByText('语音播报状态')).toBeInTheDocument();
  });

  it('refreshes readiness and credential inputs after external config writes（外部配置写入后页面会刷新）', async () => {
    render(<VoiceRuntimeLabPage />);

    await act(async () => {
      setVoiceRuntimeDoubaoAppId('4587429383');
      setVoiceRuntimeDoubaoAccessToken('external-access-token');
      setVoiceRuntimeEnabled(true);
      setVoiceRuntimeMode('push-to-talk');
    });

    await waitFor(() => {
      expect(screen.getByLabelText('APP ID')).toHaveValue('4587429383');
      expect(screen.getByLabelText('Access Token')).toHaveValue('external-access-token');
      expect(screen.getAllByText('APP ID + Token 已配置').length).toBeGreaterThan(0);
      expect(screen.getAllByText('已开启').length).toBeGreaterThan(0);
      expect(screen.getAllByText('按键说话').length).toBeGreaterThan(0);
    });
  });
});
