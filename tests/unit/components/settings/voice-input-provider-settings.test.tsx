import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-settings-mocks.tsx';
import {
  settingsPagePreferenceState,
  settingsPageVolcanoState,
} from './setup-settings-mocks.tsx';
import { VoiceInputProviderSettings } from '@/ui/app/components/settings/voice-input-provider-settings';

describe('VoiceInputProviderSettings（快捷语音输入 provider 设置）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.voiceShortcutAsrProvider = 'moss';
    settingsPagePreferenceState.voiceOmniProfileId = '';
    settingsPagePreferenceState.voiceOmniModelId = 'qwen3.5-omni-plus';
    settingsPagePreferenceState.voiceOmniOptimizeEnabled = false;
    settingsPageVolcanoState.appKey = '';
    settingsPageVolcanoState.accessKey = '';
    settingsPageVolcanoState.resourceId = 'volc.seedasr.sauc.duration';
    settingsPageVolcanoState.endpoint = 'bigmodel_async';
    settingsPageVolcanoState.language = 'zh-CN';
  });

  it('renders MOSS panel by default（默认渲染 MOSS 配置区）', () => {
    render(<VoiceInputProviderSettings />);

    expect(screen.getByText('快捷语音输入')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MOSS' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('MOSS 本地识别配置区')).toBeInTheDocument();
    expect(
      screen.getByText('本地默认链路，无需额外云端 Key，适合先验证快捷语音输入是否打通。'),
    ).toBeInTheDocument();
  });

  it('switches provider panels and updates diagnostics（切换 provider 后更新配置区与诊断文案）', async () => {
    const user = userEvent.setup();
    render(<VoiceInputProviderSettings />);

    await user.click(screen.getByRole('button', { name: '火山' }));
    expect(screen.getByRole('button', { name: '火山' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('火山 ASR 配置区')).toBeInTheDocument();
    expect(screen.getByText('App Key / 应用密钥')).toBeInTheDocument();
    expect(screen.getAllByText('未配置').length).toBeGreaterThan(0);
    expect(
      screen.getByText('诊断：缺少 AppKey / AccessKey，切到火山前需要先补齐火山引擎凭据。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('MOSS 本地识别配置区')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Qwen Omni' }));
    expect(screen.getByRole('button', { name: 'Qwen Omni' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Qwen Omni 配置区')).toBeInTheDocument();
    expect(screen.getByText('Provider Profile / 供应商档案')).toBeInTheDocument();
    expect(screen.getByText('未绑定')).toBeInTheDocument();
    expect(
      screen.getByText('诊断：还没绑定 provider profile，建议先在 AI Registry 配 DashScope 兼容档案。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('火山 ASR 配置区')).not.toBeInTheDocument();
  });
});
