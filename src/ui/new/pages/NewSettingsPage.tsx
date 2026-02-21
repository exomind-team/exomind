import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { setUIMode } from '@/config/ui-mode';
import { UserManagePage } from '@/ui/pages/UserManagePage';
import { Braces, Download, Import, MoonStar, TimerReset, Users, Wifi } from 'lucide-react';

type ImportStrategy = 'merge' | 'overwrite';
type PickedJsonFile = {
  path: string;
  content: string;
};

function buildBackupFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `exomind-eventlog-${date}.json`;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>('merge');
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`保存失败：${message}`);
    }
  };

  const handleResetSyncServerUrl = () => {
    clearNotice();
    setSyncServerUrlOverride(null);
    setSavedSyncServerUrl(null);
    setSyncServerUrl(autoSyncServerUrl);
    setStatusMessage(`已恢复自动地址：${autoSyncServerUrl}`);
  };

  const handleExport = async () => {
    clearNotice();
    setLoading(true);

    try {
      const service = getEventLogService();
      const json = await service.exportEventsAsJson();
      const payload = JSON.parse(json) as { events?: unknown[] };
      const count = Array.isArray(payload.events) ? payload.events.length : 0;
      const defaultName = buildBackupFileName();

      const isRunningInTauri = await isTauri();
      if (isRunningInTauri) {
        const savedPath = await invoke<string | null>('save_json_file', {
          content: json,
          defaultName,
        });

        if (!savedPath) {
          setStatusMessage('已取消保存。');
          return;
        }

        setStatusMessage(`导出成功，共 ${count} 条事件。保存路径：${savedPath}`);
        return;
      }

      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = defaultName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setStatusMessage(`导出成功，共 ${count} 条事件。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导出失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportClick = async () => {
    clearNotice();

    const isRunningInTauri = await isTauri();
    if (!isRunningInTauri) {
      fileInputRef.current?.click();
      return;
    }

    setLoading(true);

    try {
      const picked = await invoke<PickedJsonFile | null>('pick_json_file');
      if (!picked) {
        setStatusMessage('已取消导入。');
        return;
      }

      const service = getEventLogService();
      const result = await service.importEventsFromJson(picked.content, importStrategy);
      setStatusMessage(
        `导入成功：新增 ${result.imported} 条，跳过 ${result.skipped} 条，当前共 ${result.total} 条。来源：${picked.path}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导入失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    clearNotice();

    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);

    try {
      const content = await file.text();
      const service = getEventLogService();
      const result = await service.importEventsFromJson(content, importStrategy);
      setStatusMessage(
        `导入成功：新增 ${result.imported} 条，跳过 ${result.skipped} 条，当前共 ${result.total} 条。`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(`导入失败：${message}`);
    } finally {
      event.target.value = '';
      setLoading(false);
    }
  };

  const handleBackToOldUi = () => {
    setUIMode('old');
  };

  const syncHost = (() => {
    try {
      return new URL(savedSyncServerUrl || autoSyncServerUrl).hostname;
    } catch {
      return '127.0.0.1';
    }
  })();

  return (
    <div className="safe-area-pt-plus min-h-full px-4">
      <header className="py-2 text-center">
        <h1 className="text-base font-semibold text-primary">设置</h1>
      </header>

      <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom,0px)+108px)]">
        <section className="rounded-2xl border border-white/50 bg-[linear-gradient(to_bottom_right,var(--brand-gradient))] p-4 text-white shadow-[0_16px_30px_-18px_rgba(199,91,58,0.7)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Hailay</p>
              <p className="mt-1 text-[11px] text-white/80">持续小步迭代</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="h-8 rounded-xl bg-white/20 text-xs text-white hover:bg-white/30">
                个人资料
              </Button>
              <Button type="button" variant="secondary" className="h-8 rounded-xl bg-white/20 text-xs text-white hover:bg-white/30">
                退出
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-secondary">外观</p>
          <div className="rounded-2xl border border-card bg-card">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2 text-sm text-strong">
                <MoonStar className="h-4 w-4 text-muted" />
                <span>主题</span>
              </div>
              <select
                id="theme-preference-new"
                className="rounded-lg border border-subtle bg-surface px-2 py-1 text-xs text-strong"
                value={themePreference}
                disabled={loading}
                onChange={(event) => {
                  const nextPreference = event.target.value as ThemePreference;
                  setThemePreference(nextPreference);
                  setThemePreferenceState(nextPreference);
                }}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-secondary">计时器</p>
          <div className="rounded-2xl border border-card bg-card">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2 text-sm text-strong">
                <TimerReset className="h-4 w-4 text-muted" />
                <span>结束样式</span>
              </div>
              <span className="text-xs text-secondary">保留现有逻辑</span>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-secondary">网络与同步</p>
          <div className="space-y-3 rounded-2xl border border-card bg-card p-4">
            <Label htmlFor="sync-server-url-new" className="text-xs text-secondary">
              同步服务器地址
            </Label>
            <Input
              id="sync-server-url-new"
              value={syncServerUrl}
              onChange={(event) => setSyncServerUrl(event.target.value)}
              placeholder={autoSyncServerUrl}
              disabled={loading}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-8 rounded-xl bg-brand-accent text-xs hover:bg-brand-accent/90" onClick={handleSaveSyncServerUrl} disabled={loading}>
                保存地址
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-xl text-xs" onClick={handleResetSyncServerUrl} disabled={loading}>
                设为默认
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-xs text-secondary">
              <div className="flex items-center gap-2">
                <Wifi className="h-3.5 w-3.5" />
                <span>本机IP</span>
              </div>
              <span>{syncHost}</span>
            </div>
            <p className="text-[11px] text-secondary">
              {savedSyncServerUrl ? `当前已保存：${savedSyncServerUrl}` : `未保存自定义地址，自动使用：${autoSyncServerUrl}`}
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-secondary">导入导出</p>
          <div className="space-y-3 rounded-2xl border border-card bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-strong">导入策略</span>
              <select
                id="import-strategy-new"
                className="rounded-lg border border-subtle bg-surface px-2 py-1 text-xs text-strong"
                value={importStrategy}
                onChange={(event) => setImportStrategy(event.target.value as ImportStrategy)}
                disabled={loading}
              >
                <option value="merge">合并（merge）</option>
                <option value="overwrite">覆盖（overwrite）</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-9 justify-start rounded-xl text-xs" onClick={handleExport} disabled={loading}>
                <Download className="mr-2 h-4 w-4" /> 导出 JSON
              </Button>
              <Button type="button" variant="outline" className="h-9 justify-start rounded-xl text-xs" onClick={handleImportClick} disabled={loading}>
                <Import className="mr-2 h-4 w-4" /> 导入 JSON
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-secondary">账号与用户</p>
          <div className="space-y-3 rounded-2xl border border-card bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-strong">
              <Users className="h-4 w-4 text-muted" />
              <span>多用户管理</span>
            </div>
            <p className="text-[11px] text-secondary">支持注册、登录和多设备同账号同步。</p>
            <UserManagePage embedded />
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-secondary">开发者</p>
          <div className="space-y-3 rounded-2xl border border-card bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-strong">
                <Braces className="h-4 w-4 text-muted" />
                <span>开发者模式</span>
              </div>
              <Switch
                checked={developerMode}
                onCheckedChange={(checked) => {
                  setDeveloperMode(checked);
                  setDeveloperModeEnabled(checked);
                }}
                aria-label="开发者模式"
              />
            </div>
            <p className="text-[11px] text-secondary">开启后显示 MOSS / ASR 测试入口</p>
            {developerMode && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => { window.location.pathname = '/moss-test'; }}>
                  打开 MOSS测试
                </Button>
                <Button type="button" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => { window.location.pathname = '/asr-test'; }}>
                  打开 ASR测试
                </Button>
              </div>
            )}
            <div className="border-t border-subtle pt-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-strong">界面模式（UI Mode）</p>
                  <p className="text-[11px] text-secondary">过渡期支持新旧 UI 双向切换</p>
                </div>
                <Button type="button" variant="outline" className="h-8 rounded-xl text-xs" onClick={handleBackToOldUi}>
                  返回旧 UI
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-1 text-center">
          <p className="text-[11px] text-muted">ExoMind v{versionBuildInfo.appVersion}</p>
          <p className="text-[10px] text-muted">Build: {versionBuildInfo.buildHash}</p>
        </section>

        {statusMessage && <p role="status" className="text-center text-xs text-green-700">{statusMessage}</p>}
        {errorMessage && <p role="alert" className="text-center text-xs text-red-700">{errorMessage}</p>}
      </div>
    </div>
  );
}
