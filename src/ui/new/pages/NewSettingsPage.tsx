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
  const versionBuildInfo = resolveVersionBuildInfo(envMap, '0.3.0');
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

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <div className="rounded-[28px] bg-[#FAF7F5] border border-[#EDE7E3] p-4 md:p-6 space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl md:text-2xl font-bold text-stone-900">设置</h1>
          <p className="text-xs md:text-sm text-stone-500">新 UI（New UI）配置页</p>
        </header>

        <section className="rounded-2xl border border-[#F0ECE8] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">界面模式（UI Mode）</h2>
              <p className="text-xs text-stone-500">过渡期支持新旧 UI 双向切换</p>
            </div>
            <Button type="button" variant="outline" onClick={handleBackToOldUi}>
              返回旧 UI
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-[#F0ECE8] bg-white p-4 space-y-3">
          <Label htmlFor="theme-preference-new">主题</Label>
          <select
            id="theme-preference-new"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={themePreference}
            disabled={loading}
            onChange={(event) => {
              const nextPreference = event.target.value as ThemePreference;
              setThemePreference(nextPreference);
              setThemePreferenceState(nextPreference);
            }}
          >
            <option value="system">system（跟随系统）</option>
            <option value="light">light（浅色）</option>
            <option value="dark">dark（暗色）</option>
          </select>
        </section>

        <section className="rounded-2xl border border-[#F0ECE8] bg-white p-4 space-y-3">
          <Label htmlFor="sync-server-url-new">同步服务器地址</Label>
          <Input
            id="sync-server-url-new"
            value={syncServerUrl}
            onChange={(event) => setSyncServerUrl(event.target.value)}
            placeholder={autoSyncServerUrl}
            disabled={loading}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleSaveSyncServerUrl} disabled={loading}>
              保存同步地址
            </Button>
            <Button type="button" variant="outline" onClick={handleResetSyncServerUrl} disabled={loading}>
              恢复自动地址
            </Button>
          </div>
          <p className="text-xs text-stone-500">
            {savedSyncServerUrl ? `当前已保存：${savedSyncServerUrl}` : `未保存自定义地址，自动使用：${autoSyncServerUrl}`}
          </p>
        </section>

        <section className="rounded-2xl border border-[#F0ECE8] bg-white p-4 space-y-3">
          <Label htmlFor="import-strategy-new">导入策略</Label>
          <select
            id="import-strategy-new"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={importStrategy}
            onChange={(event) => setImportStrategy(event.target.value as ImportStrategy)}
            disabled={loading}
          >
            <option value="merge">merge（按 ID 去重合并）</option>
            <option value="overwrite">overwrite（覆盖）</option>
          </select>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleExport} disabled={loading}>导出 JSON</Button>
            <Button type="button" variant="outline" onClick={handleImportClick} disabled={loading}>导入 JSON</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-[#F0ECE8] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">开发者模式</h3>
              <p className="text-xs text-stone-500">开启后显示 MOSS/ASR 测试入口</p>
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
          {developerMode && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => { window.location.pathname = '/moss-test'; }}>
                打开 MOSS测试
              </Button>
              <Button type="button" variant="outline" onClick={() => { window.location.pathname = '/asr-test'; }}>
                打开 ASR测试
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#F0ECE8] bg-white p-4">
          <p className="text-sm text-stone-700">
            <span className="font-medium">App Version（应用版本）:</span> {versionBuildInfo.appVersion}
          </p>
          <p className="text-xs text-stone-500">
            <span className="font-medium">Build Hash（构建哈希）:</span> {versionBuildInfo.buildHash}
          </p>
        </section>

        {statusMessage && <p role="status" className="text-sm text-green-700">{statusMessage}</p>}
        {errorMessage && <p role="alert" className="text-sm text-red-700">{errorMessage}</p>}
      </div>
    </div>
  );
}

