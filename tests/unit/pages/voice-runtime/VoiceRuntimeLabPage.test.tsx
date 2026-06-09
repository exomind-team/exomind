import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
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
  getVoiceRuntimeOmniFunctionCallingEnabled,
  getVoiceRuntimeOmniSearchEnabled,
  getVoiceRuntimeOmniToolChoice,
  getVoiceRuntimeOmniToolsJson,
} from '@/config/voice-runtime-omni';
import {
  setVoiceRuntimeMode,
} from '@/config/voice-runtime-mode';
import { __resetVoiceAssistantRuntimeServiceForTests } from '@/services/voice-assistant-runtime.service';
import { VoiceRuntimeLabPage } from '@/ui/app/pages/voice-runtime/VoiceRuntimeLabPage';

describe('VoiceRuntimeLabPage（语音运行时实验页）', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
    await __resetVoiceAssistantRuntimeServiceForTests();
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

  it('keeps controls interactive under StrictMode（严格模式下控件仍可交互）', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <VoiceRuntimeLabPage />
      </StrictMode>,
    );

    const runtimeSwitch = screen.getByRole('switch', { name: '启用语音运行时' });
    await user.click(runtimeSwitch);

    await waitFor(() => {
      expect(screen.getAllByText('已开启').length).toBeGreaterThan(0);
    });
  });

  it('switches provider-specific form fields without mixing credentials（切换 Provider 时字段不混用）', async () => {
    const user = userEvent.setup();
    render(<VoiceRuntimeLabPage />);

    await user.click(screen.getByRole('button', { name: 'Omni Realtime' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Omni API Key')).toBeInTheDocument();
      expect(screen.queryByLabelText('APP ID')).not.toBeInTheDocument();
    });
  });

  it('renders Omni search and function calling controls and persists edits（渲染 Omni 搜索与函数调用配置并持久化）', async () => {
    const user = userEvent.setup();
    render(<VoiceRuntimeLabPage />);

    await user.click(screen.getByRole('button', { name: 'Omni Realtime' }));

    const searchSwitch = screen.getByRole('switch', { name: '启用 Web Search' });
    const functionCallingSwitch = screen.getByRole('switch', { name: '启用 Function Calling' });
    const toolChoiceInput = screen.getByLabelText('Tool Choice');
    const toolsJsonInput = screen.getByLabelText('Tools JSON');

    expect(searchSwitch).toBeChecked();
    expect(functionCallingSwitch).not.toBeChecked();

    await user.click(searchSwitch);
    await user.click(functionCallingSwitch);
    fireEvent.change(toolChoiceInput, {
      target: { value: 'required' },
    });
    fireEvent.change(toolsJsonInput, {
      target: { value: '[{"type":"function","name":"search_web"}]' },
    });

    expect(getVoiceRuntimeOmniSearchEnabled()).toBe(false);
    expect(getVoiceRuntimeOmniFunctionCallingEnabled()).toBe(true);
    expect(getVoiceRuntimeOmniToolChoice()).toBe('required');
    expect(getVoiceRuntimeOmniToolsJson()).toBe('[{"type":"function","name":"search_web"}]');
  });

  it('renders a dedicated Omni Compatible form with non-realtime hints（Omni Compatible 独立表单与提示）', async () => {
    const user = userEvent.setup();
    render(<VoiceRuntimeLabPage />);

    await user.click(screen.getByRole('button', { name: 'Omni Compatible' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Omni API Key')).toBeInTheDocument();
      expect(screen.getByLabelText('Compatible 模型')).toBeInTheDocument();
      expect(screen.getByLabelText('Compatible Base URL')).toBeInTheDocument();
      expect(screen.getByText('输出音频格式')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'wav' })).toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: '启用 Web Search' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Omni WebSocket 地址')).not.toBeInTheDocument();
      expect(screen.getByText(/Compatible 是流式返回，不是实时逐帧上行/)).toBeInTheDocument();
    });
  });

  it('renders hold-to-talk controls for Omni Compatible（Omni Compatible 显示按住说话控件）', async () => {
    const user = userEvent.setup();
    render(<VoiceRuntimeLabPage />);

    await user.click(screen.getByRole('button', { name: 'Omni Compatible' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '按住说话，松开提交' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '开始监听' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '停止并提交' })).not.toBeInTheDocument();
      expect(screen.getAllByText(/不会改掉全局 Doubao 持续监听 Provider/).length).toBeGreaterThan(0);
    });
  });
});
