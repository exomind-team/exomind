import { Tooltip } from '@/components/ui/tooltip';
import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Copy, MapPin, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { errorMessage } from './drafts';
import {
  betaDisplayEndpoint,
  readBetaRuntimeLocation,
  setBetaRuntimeAccessScope,
  type BetaRuntimeAccessScope,
  type BetaRuntimeLocationInfo,
} from './runtime-location';
import { betaAppVersion } from './app-identity';

/** Alpha's shared dialog/settings presentation; no legacy Runtime is started. */
export function BetaRuntimeLocation({ endpoint, compact = false }: { endpoint?: string; compact?: boolean }) {
  const [native] = useState(isTauri);
  const [location, setLocation] = useState<BetaRuntimeLocationInfo | null>(null);
  const [loading, setLoading] = useState(native);
  const [error, setError] = useState('');
  const [copyError, setCopyError] = useState('');
  const [notice, setNotice] = useState('');
  const [scopeBusy, setScopeBusy] = useState<BetaRuntimeAccessScope | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!native || compact && !open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true); setError('');
    async function read(attempt: number) {
      try {
        const next = await readBetaRuntimeLocation();
        if (!active) return;
        setLocation(next);
        // The HTTP listener starts after native IPC. Bound initial observation
        // to three seconds; an unavailable port never becomes a guessed URL.
        if (next.listener_state === 'starting' && attempt < 6) {
          timer = setTimeout(() => { void read(attempt + 1); }, 500);
        } else setLoading(false);
      } catch (failure) { if (active) { setLoading(false); setError(errorMessage(failure)); } }
    }
    void read(0);
    return () => { active = false; clearTimeout(timer); };
  }, [native, revision, compact, open]);
  const address = native ? location?.http_address : betaDisplayEndpoint(endpoint);
  const label = error ? '地址暂未更新' : address ?? (location?.listener_state === 'unavailable' ? '本机记录可用 · 服务端口未启动'
    : location?.listener_state === 'stopped' ? '本机服务已停止' : loading ? '正在读取本机地址…' : '当前服务地址尚未确认');
  const appVersion = betaAppVersion;
  async function copy(value: string, name: string) {
    setNotice(''); setCopyError('');
    try {
      if (native) await invoke('plugin:clipboard-manager|write_text', { text: value });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error('当前环境无法自动复制，请选择下方文本后复制');
      setNotice(`${name}已复制`);
    } catch (failure) { setCopyError(errorMessage(failure)); }
  }
  async function changeScope(accessScope: BetaRuntimeAccessScope) {
    if (scopeBusy || location?.configured_access_scope === accessScope) return;
    setScopeBusy(accessScope); setScopeError(''); setNotice('');
    try {
      const next = await setBetaRuntimeAccessScope(accessScope);
      setLocation(next);
      setNotice(next.active_access_scope === next.configured_access_scope
        ? `访问范围已保存；当前服务按“${next.active_access_scope === 'lan' ? '局域网' : '仅本机'}”运行。`
        : `已保存。重启外心后，服务将按“${next.configured_access_scope === 'lan' ? '局域网' : '仅本机'}”访问范围启动；当前仍为“${next.active_access_scope === 'lan' ? '局域网' : '仅本机'}”。`);
    } catch (failure) {
      setScopeError(`${errorMessage(failure)}。访问范围未改变，可重试`);
    } finally {
      setScopeBusy(null);
    }
  }
  const activeScopeLabel = !location ? '正在读取' : location.active_access_scope === 'lan' ? '局域网' : '仅本机';
  const configuredScope = location?.configured_access_scope;
  return <Dialog open={open} onOpenChange={next => { setOpen(next); setNotice(''); setCopyError(''); }}>
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
      {!compact && <span className="shrink-0">{appVersion}</span>}
      <DialogTrigger asChild><Tooltip content={compact ? '当前运行位置' : label}><button type="button" className={`inline-flex min-w-0 items-center justify-center gap-1 rounded-md text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${compact ? 'h-9 w-9' : ''}`} aria-label="查看当前运行地址与资料目录" >
        <MapPin size={compact ? 16 : 12} className="shrink-0"/>{!compact && <span data-testid="beta-current-address" className="truncate">{label}</span>}
      </button></Tooltip></DialogTrigger>
    </div>
    <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
      <DialogHeader><DialogTitle>当前运行位置</DialogTitle><DialogDescription>{native ? '服务地址与资料目录来自此应用当前使用的本机实例。' : '当前页面连接的服务地址。资料目录由服务所在设备管理。'}</DialogDescription></DialogHeader>
      <SettingsSection title={native ? '本机概览' : '当前连接'}>
        <SettingRow label="当前运行" right={<Button variant="ghost" size="icon" aria-label="复制当前服务地址" disabled={!address || !!error} onClick={() => { if (address) void copy(address, '服务地址'); }}><Copy size={14}/></Button>}/>
        <p className="select-text break-all px-4 pb-4 text-xs text-secondary" data-testid="runtime-current-address">{label}</p>
        {native && <><Divider/><SettingRow label="当前运行的访问范围" right={<span className="text-xs text-secondary">{activeScopeLabel}</span>}/>
          <div className="space-y-2 px-4 pb-4">
            <p className="text-xs leading-relaxed text-muted">选择下次启动服务时的监听范围。仅本机只接受本机回环连接；局域网接受本机网络接口的 HTTP 连接，适合受信网络，仍要求现有会话凭据与档案授权。</p>
            <div role="group" aria-label="下次启动的访问范围" className="flex flex-wrap gap-2">
              {(['local', 'lan'] as const).map(accessScope => {
                const selected = configuredScope === accessScope;
                const label = accessScope === 'lan' ? '局域网' : '仅本机';
                return <Button key={accessScope} type="button" size="sm" variant={selected ? 'default' : 'outline'}
                  aria-label={`${label}访问范围`} aria-pressed={selected}
                  disabled={loading || scopeBusy !== null}
                  onClick={() => { void changeScope(accessScope); }}>
                  {scopeBusy === accessScope ? `正在保存${label}…` : label}
                </Button>;
              })}
            </div>
            <p className="text-xs text-muted">重启后生效；端口和当前地址不会在运行中静默切换。</p>
          </div>
          {scopeError && <p role="alert" className="px-4 pb-4 text-xs text-destructive">{scopeError}</p>}
          <Divider/><SettingRow label="资料目录" right={<Button variant="ghost" size="icon" aria-label="复制资料目录" disabled={!location || !!error} onClick={() => { if (location) void copy(location.data_directory, '资料目录'); }}><Copy size={14}/></Button>}/>
          <p className="select-text break-all px-4 pb-4 text-xs text-secondary">{location?.data_directory ?? '尚未读取'}</p>
        </>}
      </SettingsSection>
      {location && <details className="text-xs text-muted"><summary className="cursor-pointer">实例信息</summary><dl className="mt-2 space-y-2 select-text"><div><dt>设备标识</dt><dd className="break-all">{location.device_id}</dd></div><div><dt>本次运行</dt><dd className="break-all">{location.runtime_id}</dd></div><div><dt>版本</dt><dd>{appVersion}</dd></div></dl></details>}
      {(error || copyError) && <p role="alert" className="text-xs text-destructive">{error || copyError}</p>}{notice && <p role="status" className="text-xs text-secondary">{notice}</p>}
      {native && <Button variant="outline" disabled={loading} onClick={() => { setNotice(''); setRevision(value => value + 1); }}><RefreshCw size={14}/>{loading ? '正在读取…' : '重新读取位置'}</Button>}
    </DialogContent>
  </Dialog>;
}
