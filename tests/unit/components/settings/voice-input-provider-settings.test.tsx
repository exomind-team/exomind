import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import {
  settingsPagePreferenceState,
  settingsPageVolcanoState,
} from './setup-settings-mocks.tsx';
import { VoiceInputProviderSettings } from '@/ui/app/components/settings/voice-input-provider-settings';

describe('VoiceInputProviderSettings（快捷语音输入 provider 设置，火山-only）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.voiceShortcutAsrProvider = 'volcano';
    settingsPageVolcanoState.appKey = '';
    settingsPageVolcanoState.accessKey = '';
    settingsPageVolcanoState.resourceId = 'volc.seedasr.sauc.duration';
    settingsPageVolcanoState.endpoint = 'bigmodel_async';
    settingsPageVolcanoState.language = 'zh-CN';
  });

  it('renders the volcano panel as the only provider（火山是唯一 provider，直接渲染火山配置区）', () => {
    render(<VoiceInputProviderSettings />);

    expect(screen.getByText('快捷语音输入')).toBeInTheDocument();
    expect(screen.getByText('Provider / 服务提供方：火山')).toBeInTheDocument();
    expect(screen.getByText('火山 ASR 配置区')).toBeInTheDocument();
    expect(screen.getByText('App Key / 应用密钥')).toBeInTheDocument();
    expect(screen.getByText('Access Key / 访问密钥')).toBeInTheDocument();
    // 未配置凭据时给出补齐诊断
    expect(
      screen.getByText('诊断：缺少 AppKey / AccessKey，需要先补齐火山引擎凭据。'),
    ).toBeInTheDocument();
  });

  it('shows ready diagnostic once volcano credentials are present（凭据补齐后给出就绪诊断）', () => {
    settingsPageVolcanoState.appKey = 'app-key-xxx';
    settingsPageVolcanoState.accessKey = 'access-key-xxx';

    render(<VoiceInputProviderSettings />);

    expect(
      screen.getByText('诊断：火山凭据已就绪，下一步重点验证 Resource ID 与语言参数是否匹配当前识别场景。'),
    ).toBeInTheDocument();
  });
});
