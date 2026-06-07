import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from './setup-settings-mocks.tsx';
import {
  VoiceAssistantProviderSettings,
  type VoiceAssistantProviderSettingsValue,
} from '@/ui/app/components/settings/voice-assistant-provider-settings';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

function ControlledStory({
  ctx,
  initialValue,
  onChange,
}: {
  ctx?: SettingsContext;
  initialValue?: Partial<VoiceAssistantProviderSettingsValue>;
  onChange?: (value: VoiceAssistantProviderSettingsValue) => void;
}) {
  return (
    <VoiceAssistantProviderSettings
      ctx={ctx}
      defaultValue={initialValue}
      onChange={onChange}
    />
  );
}

describe('VoiceAssistantProviderSettings（常驻语音助手 Provider 设置）', () => {
  beforeEach(() => {
    settingsPagePreferenceState.voiceRuntimeEnabled = false;
    settingsPagePreferenceState.voiceRuntimeMode = 'push-to-talk';
    settingsPagePreferenceState.voiceRuntimeProvider = 'doubao-o2-realtime';
    settingsPagePreferenceState.voiceRuntimeLabNavEnabled = false;
  });

  it('toggles assistant enabled switch（切换常驻语音助手开关）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ControlledStory onChange={onChange} />);

    const enabledSwitch = screen.getByRole('switch', { name: '启用常驻语音助手' });
    expect(enabledSwitch).toHaveAttribute('aria-checked', 'false');

    await user.click(enabledSwitch);

    expect(enabledSwitch).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true,
      mode: 'push-to-talk',
      provider: 'doubao-o2-realtime',
    });
  });

  it('switches runtime mode between push-to-talk and ambient（支持按键说话与环境监听单选）', async () => {
    const user = userEvent.setup();

    render(<ControlledStory initialValue={{ enabled: true }} />);

    const pushToTalkRadio = screen.getByRole('radio', { name: '按键说话' });
    const ambientRadio = screen.getByRole('radio', { name: '环境监听' });

    expect(pushToTalkRadio).toHaveAttribute('aria-checked', 'true');
    expect(ambientRadio).toHaveAttribute('aria-checked', 'false');

    await user.click(ambientRadio);

    expect(pushToTalkRadio).toHaveAttribute('aria-checked', 'false');
    expect(ambientRadio).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByTestId('voice-assistant-provider-settings-mode-summary'),
    ).toHaveTextContent('环境持续监听麦克风，适合免按键对话。');
  });

  it('switches provider between Doubao, Omni Compatible and Omni Realtime（支持三种 Provider 切换）', async () => {
    const user = userEvent.setup();

    render(
      <ControlledStory
        ctx={{ isDesktop: true, developerMode: true }}
        initialValue={{ enabled: true }}
      />,
    );

    const doubaoRadio = screen.getByRole('radio', { name: 'Doubao' });
    const omniCompatibleRadio = screen.getByRole('radio', { name: 'Omni Compatible' });
    const omniRealtimeRadio = screen.getByRole('radio', { name: 'Omni Realtime' });

    expect(doubaoRadio).toHaveAttribute('aria-checked', 'true');

    await user.click(omniCompatibleRadio);
    expect(omniCompatibleRadio).toHaveAttribute('aria-checked', 'true');

    await user.click(omniRealtimeRadio);
    expect(omniRealtimeRadio).toHaveAttribute('aria-checked', 'true');
    expect(doubaoRadio).toHaveAttribute('aria-checked', 'false');
  });

  it('shows unsupported hint for Omni Compatible plus ambient mode（Omni Compatible + 环境监听显示不支持提示）', async () => {
    const user = userEvent.setup();

    render(
      <ControlledStory
        ctx={{ isDesktop: true, developerMode: true }}
        initialValue={{ enabled: true }}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Omni Compatible' }));
    await user.click(screen.getByRole('radio', { name: '环境监听' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Omni Compatible 当前只支持按键说话，不支持环境监听。',
    );

    await user.click(screen.getByRole('radio', { name: '按键说话' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides Omni providers outside developer mode（非开发者模式隐藏 Omni Provider）', () => {
    render(<ControlledStory initialValue={{ enabled: true }} />);

    expect(screen.getByRole('radio', { name: 'Doubao' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Omni Compatible' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Omni Realtime' })).not.toBeInTheDocument();
  });

  it('shows diagnostics only in developer mode and anchors them to active provider（诊断入口仅在开发者模式出现并跟随当前 provider）', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <VoiceAssistantProviderSettings ctx={{ isDesktop: true, developerMode: false }} />,
    );

    expect(screen.queryByText('显示语音诊断入口')).not.toBeInTheDocument();
    expect(screen.queryByText('打开语音诊断页')).not.toBeInTheDocument();

    rerender(
      <VoiceAssistantProviderSettings ctx={{ isDesktop: true, developerMode: true }} />,
    );

    const doubaoPanel = screen.getByTestId('voice-assistant-provider-settings-advanced-doubao-o2-realtime');
    expect(within(doubaoPanel).getByText('Doubao 高级与诊断')).toBeInTheDocument();
    expect(screen.getByText('显示语音诊断入口')).toBeInTheDocument();
    expect(screen.getByText('打开语音诊断页')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Omni Compatible' }));

    const omniCompatiblePanel = screen.getByTestId('voice-assistant-provider-settings-advanced-qwen-omni-compatible');
    expect(within(omniCompatiblePanel).getByText('Omni Compatible 高级与诊断')).toBeInTheDocument();
  });
});
