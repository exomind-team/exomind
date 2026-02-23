import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { getEventLogService } from '@/lib/services';
import {
  getSyncServerUrlOverride,
  resolveSyncServerUrl,
  setSyncServerUrlOverride,
} from '@/config/port-env';
import { resolveVersionBuildInfo } from '@/config/version-build-info';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/config/theme';
import {
  getDeveloperModeEnabled,
  setDeveloperModeEnabled,
} from '@/config/developer-mode';
import {
  getAgentPageEnabled,
  setAgentPageEnabled,
} from '@/config/agent-page-enabled';
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
  updateTimerPreferences,
  type CountdownEndMode,
} from '@/config/timer-preferences';
import {
  getUseMockDataEnabled,
  setUseMockDataEnabled,
  subscribeUseMockDataChanges,
} from '@/config/mock-data';
import { setUIMode } from '@/config/ui-mode';
import {
  TIMER_END_SOUND_PRESETS,
  getTimerEndSoundPresetById,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';
import { UserCard } from '@/ui/new/components/UserCard';
import { useNavigate } from '@tanstack/react-router';
import {
  Bell,
  Bot,
  Check,
  ChevronRight,
  Code,
  Download,
  Heart,
  House,
  Mic,
  Monitor,
  Moon,
  MoonStar,
  Package,
  Speech,
  Sun,
  Timer,
  Undo2,
  Upload,
  Users,
  Wifi,
} from 'lucide-react';

type ImportStrategy = 'merge' | 'overwrite';
type PickedJsonFile = {
  path: string;
  content: string;
};

function buildBackupFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `exomind-eventlog-${date}.json`;
}

/* ── Shared row / divider components ── */

function SettingRow({
  icon,
  label,
  right,
  onClick,
  className = '',
}: {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex w-full items-center justify-between px-4 py-[14px] ${onClick ? 'active:bg-stone-50 dark:active:bg-stone-800' : ''} ${className}`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{label}</span>
      </div>
      {right}
    </Wrapper>
  );
}

function Divider() {
  return (
    <div className="px-4">
      <div className="h-px bg-[#F0ECE8] dark:bg-[#292524]" />
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-medium leading-[1.4] text-[#78716C]">{children}</p>
  );
}

export function NewSettingsPage() {
  const envMap = import.meta.env as Record<string, string | undefined>;
  const versionBuildInfo = resolveVersionBuildInfo(envMap, '0.3.0-beta1');
  const autoSyncServerUrl = resolveSyncServerUrl(envMap, {
    syncServerOverride: null,
  });
  const [syncServerUrl, setSyncServerUrl] = useState(() => getSyncServerUrlOverride() || autoSyncServerUrl);
  const [savedSyncServerUrl, setSavedSyncServerUrl] = useState<string | null>(() => getSyncServerUrlOverride());
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());
  const [developerMode, setDeveloperMode] = useState<boolean>(() => getDeveloperModeEnabled());
  const [agentPageEnabled, setAgentPageEnabledState] = useState<boolean>(
    () => getAgentPageEnabled()
  );
  const [useMockData, setUseMockData] = useState<boolean>(() => getUseMockDataEnabled());
  const [timerPreferences, setTimerPreferencesState] = useState(() => getTimerPreferences());
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [countdownModeDialogOpen, setCountdownModeDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importStrategy] = useState<ImportStrategy>('merge');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const clearNotice = () => {
    setStatusMessage('');
    setErrorMessage('');
  };

  const normalizeSyncServerUrl = (value: string): string => {
    const normalized = value.trim().replace(/\/+$/, '');
    if (!normalized) {
      throw new Error('同步服务器地址不能为空');
    }

    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new Error('同步服务器地址格式无效');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('同步服务器地址必须以 http:// 或 https:// 开头');
    }

    return normalized;
  };

  const handleSaveSyncServerUrl = () => {
    clearNotice();

    try {
      const normalized = normalizeSyncServerUrl(syncServerUrl);
      setSyncServerUrlOverride(normalized);
      const saved = getSyncServerUrlOverride() || normalized;
      setSavedSyncServerUrl(saved);
      setSyncServerUrl(saved);
      setStatusMessage(`同步服务器地址已保存：${saved}`);
      setSyncDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`保存失败：${message}`);
    }
  };

  const handleExportBackup = async () => {
    clearNotice();
    setLoading(true);
    try {
      const service = getEventLogService();
      const json = await service.exportEventsAsJson();

      downloadJsonFallback(json, buildBackupFileName());
      setStatusMessage('已导出事件备份');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导出失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadJsonFallback = (json: string, filename: string) => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async () => {
    clearNotice();
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    await processImport({ path: file.name, content });
    e.target.value = '';
  };

  const processImport = async (picked: PickedJsonFile) => {
    setLoading(true);
    try {
      const service = getEventLogService();
      const result = await service.importEventsFromJson(picked.content, importStrategy);
      setStatusMessage(`已导入 ${result.imported} 条事件，跳过 ${result.skipped} 条`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导入失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeveloperModeToggle = (checked: boolean) => {
    setDeveloperModeEnabled(checked);
    setDeveloperMode(checked);
  };

  const handleAgentPageEnabledToggle = (checked: boolean) => {
    setAgentPageEnabled(checked);
    setAgentPageEnabledState(checked);
  };

  const handleUseMockDataToggle = (checked: boolean) => {
    setUseMockDataEnabled(checked);
    setUseMockData(checked);
    // Reload page（刷新页面）to re-bootstrap runtime adapters（重建运行时适配器注入）.
    window.location.reload();
  };

  const navigate = useNavigate();

  const handleSwitchToOldUI = () => {
    setUIMode('old');
  };

  useEffect(() => {
    const unsubscribe = subscribeTimerPreferencesChanges((nextPreferences) => {
      setTimerPreferencesState(nextPreferences);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return subscribeUseMockDataChanges((enabled) => {
      setUseMockData(enabled);
    });
  }, []);

  const handleCountdownEndModeChange = (mode: CountdownEndMode) => {
    setTimerPreferencesState(updateTimerPreferences({ countdownEndMode: mode }));
    setCountdownModeDialogOpen(false);
  };

  const handleThemePreferenceChange = (nextPreference: ThemePreference) => {
    setThemePreference(nextPreference);
    setThemePreferenceState(nextPreference);
  };

  const handleSoundPresetChange = (presetId: TimerEndSoundPresetId | 'off') => {
    if (presetId === 'off') {
      setTimerPreferencesState(updateTimerPreferences({ countdownEndSoundEnabled: false }));
      setSoundPickerOpen(false);
      return;
    }
    setTimerPreferencesState(updateTimerPreferences({
      countdownEndSoundEnabled: true,
      countdownEndSoundPresetId: presetId,
    }));
    setSoundPickerOpen(false);
  };

  const currentSoundLabel = timerPreferences.countdownEndSoundEnabled
    ? getTimerEndSoundPresetById(timerPreferences.countdownEndSoundPresetId).label
    : '已关闭';

  const countdownEndModeLabel = timerPreferences.countdownEndMode === 'hard' ? '硬停止' : '柔和提醒';

  const syncHost = (() => {
    try {
      return new URL(savedSyncServerUrl || autoSyncServerUrl).hostname;
    } catch {
      return '127.0.0.1';
    }
  })();

  return (
    <div className="min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]">
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Header */}
      <header className="flex items-center justify-center px-6 py-3">
        <h1 className="text-lg font-semibold leading-[1.5] text-[#1C1917] dark:text-[#FAFAF9]">设置</h1>
      </header>

      {/* Settings Content */}
      <div className="space-y-5 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">

        {/* ── User Card ── */}
        <UserCard />

        {/* ── Theme Section (外观) ── */}
        <section className="space-y-2">
          <SectionTitle>外观</SectionTitle>
          <SectionCard>
            <div className="flex items-center justify-between px-4 py-[14px]">
              <div className="flex items-center gap-3">
                <MoonStar className="h-[18px] w-[18px] text-[#78716C]" />
                <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">主题</span>
              </div>
              <div
                id="theme-preference-new"
                role="group"
                aria-label="主题"
                className="flex items-center rounded-[10px] bg-[#F5F0ED] p-[3px] dark:bg-[#292524]"
              >
                <button
                  type="button"
                  data-testid="new-settings-theme-system"
                  aria-pressed={themePreference === 'system'}
                  onClick={() => handleThemePreferenceChange('system')}
                  disabled={loading}
                  className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                    themePreference === 'system'
                      ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                      : 'text-[#A8A29E]'
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  自动
                </button>
                <button
                  type="button"
                  data-testid="new-settings-theme-light"
                  aria-pressed={themePreference === 'light'}
                  onClick={() => handleThemePreferenceChange('light')}
                  disabled={loading}
                  className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                    themePreference === 'light'
                      ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                      : 'text-[#A8A29E]'
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" />
                  浅色
                </button>
                <button
                  type="button"
                  data-testid="new-settings-theme-dark"
                  aria-pressed={themePreference === 'dark'}
                  onClick={() => handleThemePreferenceChange('dark')}
                  disabled={loading}
                  className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                    themePreference === 'dark'
                      ? 'bg-white font-medium text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                      : 'text-[#A8A29E]'
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" />
                  深色
                </button>
              </div>
            </div>
          </SectionCard>
        </section>

        {/* ── Timer Section (计时器) ── */}
        <section className="space-y-2">
          <SectionTitle>计时器</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Timer className="h-[18px] w-[18px] text-[#78716C]" />}
              label="倒计时结束"
              onClick={() => setCountdownModeDialogOpen(true)}
              right={
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#A8A29E]">{countdownEndModeLabel}</span>
                  <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                </div>
              }
            />
            <Divider />
            <SettingRow
              icon={<Bell className="h-[18px] w-[18px] text-[#78716C]" />}
              label="提示音"
              onClick={() => setSoundPickerOpen(true)}
              right={
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#A8A29E]">{currentSoundLabel}</span>
                  <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                </div>
              }
            />
          </SectionCard>
        </section>

        {/* ── Sync Section (同步) ── */}
        <section className="space-y-2">
          <SectionTitle>同步</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Wifi className="h-[18px] w-[18px] text-[#78716C]" />}
              label="同步服务器"
              onClick={() => setSyncDialogOpen(true)}
              right={
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#A8A29E]">{syncHost}</span>
                  <ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />
                </div>
              }
            />
          </SectionCard>
        </section>

        {/* ── Import/Export Section (数据) ── */}
        <section className="space-y-2">
          <SectionTitle>数据</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Download className="h-[18px] w-[18px] text-[#78716C]" />}
              label="导出备份"
              onClick={handleExportBackup}
              right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
            />
            <Divider />
            <SettingRow
              icon={<Upload className="h-[18px] w-[18px] text-[#78716C]" />}
              label="导入数据"
              onClick={handleImportBackup}
              right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
            />
          </SectionCard>
        </section>

        {/* ── Developer Section (开发者) ── */}
        <section className="space-y-2">
          <SectionTitle>开发者</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
              label="开发者模式"
              right={
                <Switch
                  checked={developerMode}
                  onCheckedChange={handleDeveloperModeToggle}
                />
              }
            />
            {developerMode && (
              <>
                <div className="pb-[14px] pl-[46px] pr-4">
                  <span className="text-xs text-[#A8A29E]">开启后可使用语音测试等实验功能</span>
                </div>
                <SettingRow
                  icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="启用 Agent 页面"
                  right={
                    <Switch
                      checked={agentPageEnabled}
                      onCheckedChange={handleAgentPageEnabledToggle}
                    />
                  }
                />
                <Divider />
                <SettingRow
                  icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="使用测试数据"
                  right={
                    <Switch
                      data-testid="new-settings-use-mock-data-switch"
                      checked={useMockData}
                      onCheckedChange={handleUseMockDataToggle}
                    />
                  }
                />
                <Divider />
                <SettingRow
                  icon={<Undo2 className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="返回旧 UI"
                  onClick={handleSwitchToOldUI}
                  right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                />
                <Divider />
                <SettingRow
                  icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="语音测试页面"
                  onClick={() => navigate({ to: '/asr-test' })}
                  right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                />
                <Divider />
                <SettingRow
                  icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="MOSS 调试"
                  onClick={() => navigate({ to: '/moss-test' })}
                  right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                />
                <Divider />
                <SettingRow
                  icon={<Speech className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="ASR 语音识别"
                  onClick={() => navigate({ to: '/asr-test' })}
                  right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                />
                <Divider />
                <SettingRow
                  icon={<Users className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="多用户管理"
                  onClick={() => navigate({ to: '/user-manage' })}
                  right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                />
                <Divider />
                <SettingRow
                  icon={<House className="h-[18px] w-[18px] text-[#78716C]" />}
                  label="旧首页"
                  onClick={() => { setUIMode('old'); window.location.pathname = '/'; }}
                  right={<ChevronRight className="h-4 w-4 text-[#D6D3D1] dark:text-[#57534E]" />}
                />
              </>
            )}
          </SectionCard>
        </section>

        {/* ── Version Info (关于) ── */}
        <section className="space-y-2">
          <SectionTitle>关于</SectionTitle>
          <SectionCard>
            <SettingRow
              icon={<Package className="h-[18px] w-[18px] text-[#78716C]" />}
              label="版本"
              right={<span className="text-sm text-[#A8A29E]">{versionBuildInfo.appVersion}</span>}
            />
            <Divider />
            <SettingRow
              icon={<Package className="h-[18px] w-[18px] text-[#78716C]" />}
              label="构建"
              right={<span className="text-sm text-[#A8A29E]">{versionBuildInfo.buildHash}</span>}
            />
            <Divider />
            <div className="px-4 pb-[14px] pt-[14px]">
              <div className="flex items-center gap-3">
                <Heart className="h-[18px] w-[18px] text-[#78716C]" />
                <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">开发者</span>
              </div>
              <p className="mt-1 pl-[30px] text-xs leading-[1.4] text-[#A8A29E]">
                ExoMind — 个人生命成长助手，探索生命与认知的本质。
              </p>
            </div>
          </SectionCard>
        </section>

        {/* Status / Error messages */}
        {statusMessage && (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}
      </div>

      {/* ── Countdown End Mode Dialog ── */}
      <Dialog open={countdownModeDialogOpen} onOpenChange={setCountdownModeDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>倒计时结束模式</DialogTitle>
            <DialogDescription>选择倒计时结束后的行为</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleCountdownEndModeChange('hard')}
              className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <div>
                <div className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">硬停止</div>
                <div className="mt-0.5 text-xs text-[#A8A29E]">倒计时结束后立即停止</div>
              </div>
              {timerPreferences.countdownEndMode === 'hard' && <Check className="h-4 w-4 text-[#C75B3A]" />}
            </button>
            <button
              type="button"
              onClick={() => handleCountdownEndModeChange('soft')}
              className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <div>
                <div className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">柔和提醒</div>
                <div className="mt-0.5 text-xs text-[#A8A29E]">倒计时结束后继续计时并提醒</div>
              </div>
              {timerPreferences.countdownEndMode === 'soft' && <Check className="h-4 w-4 text-[#C75B3A]" />}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Sound Picker Dialog ── */}
      <Dialog open={soundPickerOpen} onOpenChange={setSoundPickerOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>选择提示音</DialogTitle>
            <DialogDescription>倒计时结束时播放的提示音</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleSoundPresetChange('off')}
              className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <span className="text-[#1C1917] dark:text-[#FAFAF9]">关闭提示音</span>
              {!timerPreferences.countdownEndSoundEnabled && <Check className="h-4 w-4 text-[#C75B3A]" />}
            </button>

            {TIMER_END_SOUND_PRESETS.map((preset) => {
              const selected = timerPreferences.countdownEndSoundEnabled
                && timerPreferences.countdownEndSoundPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSoundPresetChange(preset.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
                >
                  <span className="text-[#1C1917] dark:text-[#FAFAF9]">{preset.label}</span>
                  {selected && <Check className="h-4 w-4 text-[#C75B3A]" />}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Sync Server Dialog ── */}
      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>同步服务器</DialogTitle>
            <DialogDescription>设置事件日志同步的服务器地址</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              type="url"
              value={syncServerUrl}
              onChange={(e) => setSyncServerUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
            />
            {errorMessage && (
              <p className="text-xs text-red-500">{errorMessage}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSyncDialogOpen(false)}
                className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveSyncServerUrl}
                className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
