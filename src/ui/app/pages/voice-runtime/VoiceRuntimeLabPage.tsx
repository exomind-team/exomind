import {
  AudioLines,
  Bot,
  CheckCircle2,
  ExternalLink,
  Mic,
  Radio,
  Settings2,
  Sparkles,
  TriangleAlert,
  Waves,
} from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import type { VoiceRuntimeMode } from '@/config/voice-runtime-mode';
import type { VoiceRuntimeCloudSessionPolicy } from '@/config/voice-runtime-settings';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SlidingSegmentedControl } from '@/ui/app/components/SlidingSegmentedControl';
import { PageShell } from '@/ui/app/components/PageShell';
import {
  VoiceRuntimeLabController,
  type VoiceRuntimeLabState,
} from '@/ui/app/pages/voice-runtime/voice-runtime-lab-controller';

function SurfaceCard({
  children,
  className,
  ...props
}: ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(
        'rounded-2xl border-border-card bg-card shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </Card>
  );
}

function StatusRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-card bg-background px-4 py-3">
      <span className="text-xs font-medium text-secondary">{label}</span>
      <span className="text-sm font-medium text-strong">{value}</span>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-border-card bg-background px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-strong">{label}</div>
          <p className="text-xs leading-5 text-secondary">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
    </div>
  );
}

function StepItem({
  index,
  title,
  detail,
}: {
  index: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border-card bg-background px-4 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-accent/25 bg-brand-accent/10 text-xs font-semibold text-brand-accent">
        {index}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-strong">{title}</div>
        <p className="mt-1 text-xs leading-5 text-secondary">{detail}</p>
      </div>
    </div>
  );
}

type ReadinessTone = 'good' | 'warn' | 'neutral';

function ReadinessBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: ReadinessTone;
}) {
  const toneClassName = tone === 'good'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : tone === 'warn'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-border-card bg-card text-secondary';

  const Icon = tone === 'good' ? CheckCircle2 : tone === 'warn' ? TriangleAlert : AudioLines;

  return (
    <div className={cn('inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-2', toneClassName)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold">{label}</span>
        <span aria-hidden="true" className="text-[10px] opacity-60">·</span>
        <span className="text-[11px]">{value}</span>
      </div>
    </div>
  );
}

function formatRuntimeModeLabel(mode: VoiceRuntimeMode): string {
  switch (mode) {
    case 'push-to-talk':
      return '按键说话';
    case 'ambient':
      return '环境监听';
    default:
      return '已关闭';
  }
}

function formatCloudSessionPolicyLabel(policy: VoiceRuntimeCloudSessionPolicy): string {
  switch (policy) {
    case 'foreground-persistent':
      return '前台长连';
    default:
      return '按需上云';
  }
}

function ActionButton({
  label,
  meta,
  status,
  icon: Icon,
  disabled,
  onClick,
  variant = 'primary',
}: {
  label: string;
  meta: string;
  status: string;
  icon: typeof AudioLines;
  disabled?: boolean;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const className = variant === 'primary'
    ? 'min-h-[76px] rounded-2xl border border-brand-accent/25 bg-card px-4 py-4 text-left text-strong shadow-sm hover:bg-background'
    : variant === 'secondary'
      ? 'min-h-[76px] rounded-2xl border border-border-card bg-card px-4 py-4 text-left text-strong shadow-sm hover:bg-background'
      : 'min-h-[76px] rounded-2xl border border-dashed border-border-card bg-background px-4 py-4 text-left text-secondary hover:bg-card';

  const iconClassName = variant === 'ghost'
    ? 'border-border-card bg-card text-secondary'
    : 'border-brand-accent/20 bg-brand-accent/10 text-brand-accent';

  const statusClassName = variant === 'primary'
    ? 'border-brand-accent/20 bg-brand-accent/10 text-brand-accent'
    : 'border-border-card bg-background text-secondary';

  return (
    <Button
      type="button"
      aria-label={label}
      disabled={disabled}
      variant="ghost"
      className={cn('h-auto w-full items-start justify-start', className)}
      onClick={onClick}
    >
      <div className="flex w-full items-start gap-3">
        <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border', iconClassName)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-semibold">{label}</span>
            <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', statusClassName)}>
              {status}
            </span>
          </div>
          <span aria-hidden="true" className="mt-1 block text-xs leading-5 text-secondary">
            {meta}
          </span>
        </div>
      </div>
    </Button>
  );
}

function EventList({ events }: { events: VoiceRuntimeLabState['rawEvents'] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-card bg-background px-4 py-5 text-sm leading-6 text-secondary">
        暂无原始事件。开始监听后，这里会按时间顺序展示服务端返回的事件流，方便你核对连接、ASR、Chat 与 TTS 收尾是否正常。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.slice(-8).reverse().map((event, index) => (
        <div
          key={`${event.capturedAt}-${event.eventType}-${index}`}
          className="rounded-2xl border border-border-card bg-background px-4 py-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-strong">{event.eventType}</div>
            <div className="text-[11px] text-secondary">
              {new Date(event.capturedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </div>
          </div>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl border border-border-card bg-card px-3 py-3 text-xs leading-6 text-secondary">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function TranscriptBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-border-card bg-background p-4">
      <div className="text-xs font-medium text-secondary">{label}</div>
      <div className="min-h-16 whitespace-pre-wrap text-sm leading-6 text-strong">
        {value || '暂无内容'}
      </div>
    </div>
  );
}

function formatStartHint(state: VoiceRuntimeLabState): string {
  if (!state.isTauri) {
    return '当前是 Web 预览环境，开始监听仅在 Tauri 桌面端可用。';
  }
  if (!state.credentialConfigured) {
    return '先在下方填入 APP ID 和 Access Token，再点“开始监听”。';
  }
  if (!state.runtimeEnabled) {
    return '建议先打开“启用语音运行时”，这样页面状态与设置保持一致。';
  }
  if (state.currentMode === 'off') {
    return '建议把运行模式切到“按键说话”或“环境监听”，再开始联调。';
  }
  return '配置完成后，点击“开始监听”即可建立豆包 S2S 会话，随后会看到 ASR、Chat 和 TTS 事件流。';
}

function buildReadinessItems(state: VoiceRuntimeLabState): Array<{
  label: string;
  value: string;
  tone: ReadinessTone;
}> {
  return [
    {
      label: '桌面环境',
      value: state.isTauri ? 'Tauri 桌面' : 'Web 预览',
      tone: state.isTauri ? 'good' : 'warn',
    },
    {
      label: '连接凭据',
      value: state.credentialConfigured ? 'APP ID + Token 已配置' : '缺少必填',
      tone: state.credentialConfigured ? 'good' : 'warn',
    },
    {
      label: '运行时',
      value: state.runtimeEnabled ? '已开启' : '未开启',
      tone: state.runtimeEnabled ? 'good' : 'warn',
    },
    {
      label: '运行模式',
      value: formatRuntimeModeLabel(state.currentMode),
      tone: state.currentMode === 'off' ? 'warn' : 'good',
    },
    {
      label: '云端策略',
      value: formatCloudSessionPolicyLabel(state.currentCloudSessionPolicy),
      tone: 'neutral',
    },
  ];
}

export function VoiceRuntimeLabPage() {
  const navigate = useNavigate();
  const [controller] = useState(() => new VoiceRuntimeLabController());
  const [state, setState] = useState(() => controller.getState());

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => () => {
    void controller.dispose();
  }, [controller]);

  const canStart = (state.status === 'idle' || state.status === 'error') && state.isTauri;
  const canStop = state.status === 'listening';
  const canCancel = state.status === 'connecting' || state.status === 'listening' || state.status === 'responding';
  const startHint = useMemo(
    () => formatStartHint(state),
    [state.isTauri, state.credentialConfigured, state.runtimeEnabled, state.currentMode],
  );
  const readinessItems = useMemo(
    () => buildReadinessItems(state),
    [
      state.isTauri,
      state.credentialConfigured,
      state.runtimeEnabled,
      state.currentMode,
      state.currentCloudSessionPolicy,
    ],
  );

  return (
    <PageShell
      title="语音运行时实验台"
      eyebrow="Voice Runtime Lab / 语音运行时实验"
      subtitle="这页现在对齐火山官方端到端实时语音 S2S。你可以直接在这里配置 APP ID / Access Token / Secret Key，开始一次完整的 ASR → Chat → TTS 联调。"
      headerAction={(
        <Badge
          variant="outline"
          className="border-brand-accent/20 bg-brand-accent/10 text-brand-accent"
        >
          {state.isTauri ? 'Tauri 桌面环境' : 'Web 预览环境'}
        </Badge>
      )}
      contentClassName="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="min-h-full bg-page px-5 py-5 dark:bg-page-dark md:px-8 lg:px-10">
        <div className="mx-auto grid w-full max-w-7xl gap-5 xl:grid-cols-[1.08fr_0.92fr]">
          <SurfaceCard className="xl:col-span-2">
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                      开始测试
                    </Badge>
                    <Badge variant="outline" className="border-border-card bg-background text-secondary">
                      实验页内完成测试
                    </Badge>
                  </div>
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl text-strong">
                      <AudioLines className="h-5 w-5 text-brand-accent" />
                      端到端实时语音从这页直接开始
                    </CardTitle>
                    <CardDescription className="mt-2 max-w-3xl text-sm leading-6 text-secondary">
                      不需要先猜流程，也不需要先跳到设置页。先在本页打开运行时、选择模式、填 APP ID / Access Token / Secret Key，再点“开始监听”，说完后点“停止并提交”，下方会同时看到用户识别文本、模型回复文本和语音播报状态。
                    </CardDescription>
                  </div>
                </div>
                <div className="rounded-2xl border border-border-card bg-background px-4 py-3 text-xs leading-6 text-secondary">
                  <div className="font-semibold text-strong">当前建议</div>
                  <div className="mt-1">{startHint}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="grid gap-3 md:grid-cols-2">
                <StepItem index="1" title="打开运行时" detail="先把“启用语音运行时”打开，运行模式建议切到“环境监听”或“按键说话”。" />
                <StepItem index="2" title="填连接参数" detail="在下方填入 APP ID、Access Token 和 Secret Key；模型版本默认对齐官方 O2.0：1.2.1.1。" />
                <StepItem index="3" title="开始一次识别" detail="点击“开始监听”，对着麦克风说话；说完后点击“停止并提交”，服务端会继续返回 Chat 与 TTS 结果。" />
                <StepItem index="4" title="核对结果" detail="看实时字幕、最终文本、模型回复文本、语音播报状态和原始事件时间线是否一致。" />
              </div>
              <div className="grid gap-3">
                <ActionButton
                  label="开始监听"
                  meta="建立实时会话并开始推送麦克风音频"
                  status={canStart ? '可开始' : '待就绪'}
                  icon={Mic}
                  disabled={!canStart}
                  onClick={() => void controller.startListening()}
                />
                <ActionButton
                  label="停止并提交"
                  meta="结束本轮采集，等待服务端返回 Chat / TTS 结果"
                  status={canStop ? '可提交' : '监听后可用'}
                  icon={Radio}
                  disabled={!canStop}
                  onClick={() => void controller.stopListening()}
                  variant="secondary"
                />
                <ActionButton
                  label="取消监听"
                  meta="立即释放麦克风、本地采集和云端会话"
                  status={canCancel ? '可取消' : '空闲中'}
                  icon={Waves}
                  disabled={!canCancel}
                  onClick={() => void controller.cancelListening()}
                  variant="ghost"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto justify-start rounded-2xl border border-border-card bg-background px-4 py-3 text-secondary hover:bg-card hover:text-strong"
                  onClick={() => {
                    void navigate({ to: '/settings' });
                  }}
                >
                  <Settings2 className="h-4 w-4" />
                  打开设置
                  <ExternalLink className="ml-auto h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 xl:col-span-2 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-2xl border border-border-card bg-background px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-secondary">
                    <AudioLines className="h-4 w-4 text-brand-accent" />
                    准备情况
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {readinessItems.map((item) => (
                      <ReadinessBadge
                        key={item.label}
                        label={item.label}
                        value={item.value}
                        tone={item.tone}
                      />
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-border-card bg-background px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-secondary">
                    <Sparkles className="h-4 w-4 text-brand-accent" />
                    测试路径
                  </div>
                  <p className="mt-2 text-sm leading-6 text-secondary">
                    先看上面的准备情况，把阻塞项消掉；然后点击“开始监听”，说完后点击“停止并提交”；最后对照下方的用户识别文本、模型回复文本、播报状态与原始事件，确认一次完整链路收尾正常。
                  </p>
                </div>
              </div>
            </CardContent>
          </SurfaceCard>

          <div className="grid gap-5">
            <SurfaceCard data-testid="voice-runtime-controls-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-strong">
                  <Mic className="h-5 w-5 text-brand-accent" />
                  运行控制
                </CardTitle>
                <CardDescription className="text-secondary">
                  把实时语音识别的关键设置都收回到这页，避免你来回跳设置页才能开始联调。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <SettingToggle
                    label="启用语音运行时"
                    description="保持实验页和设置页的一致状态。"
                    checked={state.runtimeEnabled}
                    onCheckedChange={(checked) => controller.updateRuntimeEnabled(checked)}
                  />
                  <SettingToggle
                    label="自动播报"
                    description="只决定是否允许信号驱动播报，不代表模型会自己找话说。"
                    checked={state.autoSpeakEnabled}
                    onCheckedChange={(checked) => controller.updateAutoSpeakEnabled(checked)}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-secondary">
                      <Radio className="h-4 w-4 text-brand-accent" />
                      运行模式
                    </div>
                    <SlidingSegmentedControl
                      value={state.currentMode}
                      onChange={(value) => controller.updateRuntimeMode(value)}
                      options={[
                        { key: 'off', label: '关闭' },
                        { key: 'push-to-talk', label: '按键' },
                        { key: 'ambient', label: '环境' },
                      ]}
                      buttonClassName="py-2 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-secondary">
                      <Waves className="h-4 w-4 text-brand-accent" />
                      云端会话
                    </div>
                    <SlidingSegmentedControl
                      value={state.currentCloudSessionPolicy}
                      onChange={(value) => controller.updateCloudSessionPolicy(value)}
                      options={[
                        { key: 'on-demand', label: '按需上云' },
                        { key: 'foreground-persistent', label: '前台长连' },
                      ]}
                      minButtonWidthClassName="min-w-[92px]"
                      buttonClassName="py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="voice-runtime-app-id" className="text-sm text-strong">APP ID</Label>
                    <Input
                      id="voice-runtime-app-id"
                      aria-label="APP ID"
                      value={state.appId}
                      onChange={(event) => controller.updateAppId(event.target.value)}
                      placeholder="输入火山控制台的 APP ID"
                      className="settings-dialog-input h-11 rounded-2xl border-border-card bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="voice-runtime-access-token" className="text-sm text-strong">Access Token</Label>
                    <Input
                      id="voice-runtime-access-token"
                      aria-label="Access Token"
                      type="password"
                      value={state.accessToken}
                      onChange={(event) => controller.updateAccessToken(event.target.value)}
                      placeholder="输入火山控制台的 Access Token"
                      className="settings-dialog-input h-11 rounded-2xl border-border-card bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="voice-runtime-secret-key" className="text-sm text-strong">Secret Key</Label>
                    <Input
                      id="voice-runtime-secret-key"
                      aria-label="Secret Key"
                      type="password"
                      value={state.secretKey}
                      onChange={(event) => controller.updateSecretKey(event.target.value)}
                      placeholder="本字段当前保留给后续 REST / 签名链路"
                      className="settings-dialog-input h-11 rounded-2xl border-border-card bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="voice-runtime-model-version" className="text-sm text-strong">模型版本</Label>
                    <Input
                      id="voice-runtime-model-version"
                      aria-label="模型版本"
                      value={state.modelVersion}
                      onChange={(event) => controller.updateModelVersion(event.target.value)}
                      placeholder="1.2.1.1"
                      className="settings-dialog-input h-11 rounded-2xl border-border-card bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="voice-runtime-speaker" className="text-sm text-strong">发音人</Label>
                    <Input
                      id="voice-runtime-speaker"
                      aria-label="发音人"
                      value={state.speaker}
                      onChange={(event) => controller.updateSpeaker(event.target.value)}
                      placeholder="zh_female_vv_jupiter_bigtts"
                      className="settings-dialog-input h-11 rounded-2xl border-border-card bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="voice-runtime-connect-id" className="text-sm text-strong">Connect ID</Label>
                    <Input
                      id="voice-runtime-connect-id"
                      value={state.connectId}
                      onChange={(event) => controller.updateConnectId(event.target.value)}
                      placeholder="可选，便于服务端追踪连接"
                      className="settings-dialog-input h-11 rounded-2xl border-border-card bg-background"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="voice-runtime-websocket-url" className="text-sm text-strong">WebSocket 地址</Label>
                    <Input
                      id="voice-runtime-websocket-url"
                      value={state.websocketUrl}
                      onChange={(event) => controller.updateWebsocketUrl(event.target.value)}
                      placeholder="wss://openspeech.bytedance.com/api/v3/realtime/dialogue"
                      className="settings-dialog-input h-11 rounded-2xl border-border-card bg-background"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-border-card bg-background px-4 py-3 text-xs leading-6 text-secondary">
                  Provider 固定为 <span className="font-semibold text-strong">Doubao O2.0 S2S</span>；
                  当前协议对齐火山官方端到端实时语音：`StartConnection` → `StartSession` → `TaskRequest / EndASR` → `ASRResponse / ChatResponse / TTSResponse`。
                </div>
              </CardContent>
            </SurfaceCard>

            <SurfaceCard data-testid="voice-runtime-transcript-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-strong">
                  <Sparkles className="h-5 w-5 text-brand-accent" />
                  实时转写与感知
                </CardTitle>
                <CardDescription className="text-secondary">
                  上面开始一次识别后，这里会同时显示用户 ASR、模型回复文本和标准化感知结果。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <TranscriptBlock label="实时字幕" value={state.liveTranscript} />
                <TranscriptBlock label="最终文本" value={state.finalTranscript} />
                <TranscriptBlock label="模型回复文本" value={state.assistantReplyText} />
                <TranscriptBlock label="语音播报状态" value={`${state.ttsPlaybackStatus} / ${state.ttsAudioBytes} bytes`} />
                <div className="space-y-2 rounded-2xl border border-border-card bg-background p-4">
                  <div className="text-xs font-medium text-secondary">标准化感知</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-2xl border border-border-card bg-card px-3 py-3 text-xs leading-6 text-secondary">
                    {state.lastNormalizedPerception
                      ? JSON.stringify(state.lastNormalizedPerception, null, 2)
                      : '暂无标准化感知结果'}
                  </pre>
                </div>
              </CardContent>
            </SurfaceCard>
          </div>

          <div className="grid gap-5">
            <SurfaceCard data-testid="voice-runtime-status-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-strong">
                  <Bot className="h-5 w-5 text-brand-accent" />
                  运行状态
                </CardTitle>
                <CardDescription className="text-secondary">
                  先看这里，再决定是缺参数、没建连，还是已经进入 listening / finishing。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <StatusRow label="运行状态" value={state.status} />
                <StatusRow label="连接状态" value={state.connectionStatus} />
                <StatusRow label="麦克风状态" value={state.microphoneStatus} />
                <StatusRow label="当前模式" value={state.currentMode} />
                <StatusRow label="会话策略" value={state.currentCloudSessionPolicy} />
                <StatusRow label="当前会话" value={state.sessionId ?? '未建立'} />
                <StatusRow label="Provider" value={state.providerId} />
                <StatusRow label="连接凭据" value={state.credentialConfigured ? 'APP ID + Token 已配置' : '未配置'} />
                <StatusRow label="首包播报延迟" value={state.firstAudioLatencyMs == null ? '暂无' : `${state.firstAudioLatencyMs} ms`} />
                {state.errorMessage ? (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">
                    {state.errorMessage}
                  </div>
                ) : null}
              </CardContent>
            </SurfaceCard>

            <SurfaceCard data-testid="voice-runtime-provider-events-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-strong">
                  <Radio className="h-5 w-5 text-brand-accent" />
                  供应商原始事件
                </CardTitle>
                <CardDescription className="text-secondary">
                  用来确认 `SessionStarted / ASRResponse / ChatResponse / TTSResponse / TTSEnded` 是否按预期返回，以及 payload 结构是否对齐文档。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EventList events={state.rawEvents} />
              </CardContent>
            </SurfaceCard>

            <SurfaceCard data-testid="voice-runtime-speak-test-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-strong">
                  <AudioLines className="h-5 w-5 text-brand-accent" />
                  播报与信号测试
                </CardTitle>
                <CardDescription className="text-secondary">
                  这里仍然是白盒信号链路。只有你发 `speak.request`，它才应该开口。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="voice-runtime-speak-text" className="text-sm text-strong">播报文本</Label>
                  <Textarea
                    id="voice-runtime-speak-text"
                    value={state.speakText}
                    onChange={(event) => controller.updateSpeakText(event.target.value)}
                    placeholder="输入要发给 voice.runtime.speak.request 的文本"
                    rows={4}
                    className="settings-dialog-input min-h-[116px] rounded-2xl border-border-card bg-background"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <ActionButton
                    label="发送播报请求"
                    meta="把当前文本发到 voice.runtime.speak.request"
                    status="发送信号"
                    icon={Sparkles}
                    onClick={() => void controller.sendSpeakRequest()}
                    variant="secondary"
                  />
                  <ActionButton
                    label="发送取消播报"
                    meta="发送 voice.runtime.speak.cancel，测试打断链路"
                    status="打断信号"
                    icon={Waves}
                    onClick={() => void controller.sendSpeakCancel()}
                    variant="ghost"
                  />
                </div>
                <div className="rounded-2xl border border-dashed border-border-card bg-background px-4 py-3 text-xs leading-6 text-secondary">
                  最近事件：<span className="font-medium text-strong">{state.lastEventType ?? '暂无'}</span>
                </div>
              </CardContent>
            </SurfaceCard>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
