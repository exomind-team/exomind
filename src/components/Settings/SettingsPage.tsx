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
// PickedJsonFile（已选 JSON 文件）: tauri native picker return payload（原生文件选择返回体）
type PickedJsonFile = {
  path: string;
  content: string;
};

function buildBackupFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `exomind-eventlog-${date}.json`;
}

export function SettingsPage() {
  const envMap = import.meta.env as Record<string, string | undefined>;
  const versionBuildInfo = resolveVersionBuildInfo(envMap, '0.3.3');
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
    if (!file) {
      return;
    }

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

  const handleSwitchToNewUi = () => {
    // setUIMode（界面模式切换）: old -> new
    setUIMode('new');
  };

  return (
    <div className="settings-page p-6 space-y-4">
      <h1 className="text-2xl font-bold">设置</h1>
      <p className="text-muted-foreground">
        配置局域网同步地址与事件日志导入导出
      </p>
      <div className="space-y-1 max-w-sm text-sm">
        <p>
          <span className="font-medium">App Version（应用版本）:</span> {versionBuildInfo.appVersion}
        </p>
        <p>
          <span className="font-medium">Build Hash（构建哈希）:</span> {versionBuildInfo.buildHash}
        </p>
      </div>

      <div className="space-y-2 max-w-sm">
        <Label>界面模式（UI Mode）</Label>
        <Button type="button" variant="outline" onClick={handleSwitchToNewUi} disabled={loading}>
          切换到新 UI
        </Button>
        <p className="text-xs text-muted-foreground">
          过渡期支持双 UI：可在新 UI 设置页中返回旧 UI。
        </p>
      </div>

      <div className="space-y-2 max-w-sm">
        <Label htmlFor="theme-preference">主题</Label>
        <select
          id="theme-preference"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <p className="text-xs text-muted-foreground">
          暗色模式对 Chrome 手机版等无法使用扩展的环境更友好。
        </p>
      </div>

      <div className="space-y-2 max-w-xl">
        <Label htmlFor="sync-server-url">同步服务器地址</Label>
        <Input
          id="sync-server-url"
          value={syncServerUrl}
          onChange={(event) => setSyncServerUrl(event.target.value)}
          placeholder={autoSyncServerUrl}
          disabled={loading}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleSaveSyncServerUrl}
            disabled={loading}
          >
            保存同步地址
          </Button>
          <Button
            variant="outline"
            onClick={handleResetSyncServerUrl}
            disabled={loading}
          >
            恢复自动地址
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {savedSyncServerUrl
            ? `当前已保存：${savedSyncServerUrl}`
            : `未保存自定义地址，自动使用：${autoSyncServerUrl}`}
        </p>
      </div>

      <div className="space-y-2 max-w-sm">
        <Label htmlFor="import-strategy">导入策略</Label>
        <select
          id="import-strategy"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={importStrategy}
          onChange={(e) => setImportStrategy(e.target.value as ImportStrategy)}
          disabled={loading}
        >
          <option value="merge">merge（按 ID 去重合并）</option>
          <option value="overwrite">overwrite（覆盖）</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleExport} disabled={loading}>
          导出 JSON
        </Button>
        <Button variant="outline" onClick={handleImportClick} disabled={loading}>
          导入 JSON
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>

      <div className="space-y-2 max-w-xl rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">开发者模式</p>
            <p className="text-xs text-muted-foreground">开启后显示 MOSS 语音测试入口</p>
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
          </div>
        )}
      </div>

      {statusMessage && (
        <p role="status" className="text-sm text-green-600">
          {statusMessage}
        </p>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
