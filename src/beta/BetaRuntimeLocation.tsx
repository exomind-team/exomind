import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Copy, MapPin, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { errorMessage } from './drafts';
import { betaDisplayEndpoint, readBetaRuntimeLocation, type BetaRuntimeLocationInfo } from './runtime-location';

/** Alpha's shared dialog/settings presentation; no legacy Runtime is started. */
export function BetaRuntimeLocation({ endpoint }: { endpoint?: string }) {
  const [native] = useState(isTauri);
  const [location, setLocation] = useState<BetaRuntimeLocationInfo | null>(null);
  const [loading, setLoading] = useState(native);
  const [error, setError] = useState('');
  const [copyError, setCopyError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!native) return;
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
  }, [native, revision]);
  const address = native ? location?.http_address : betaDisplayEndpoint(endpoint);
  const label = error ? '地址暂未更新' : address ?? (location?.listener_state === 'unavailable' ? '本机记录可用 · 服务端口未启动'
    : location?.listener_state === 'stopped' ? '本机服务已停止' : loading ? '正在读取本机地址…' : '当前服务地址尚未确认');
  const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || 'Beta · 开发版';
  async function copy(value: string, name: string) {
    setNotice(''); setCopyError('');
    try {
      if (native) await writeText(value);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error('当前环境无法自动复制，请选择下方文本后复制');
      setNotice(`${name}已复制`);
    } catch (failure) { setCopyError(errorMessage(failure)); }
  }
  return <Dialog open={open} onOpenChange={next => { setOpen(next); setNotice(''); setCopyError(''); }}>
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
      <span className="shrink-0">{appVersion}</span>
      <DialogTrigger asChild><button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-md text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="查看当前运行地址与资料目录" title={label}>
        <MapPin size={12} className="shrink-0"/><span data-testid="beta-current-address" className="truncate">{label}</span>
      </button></DialogTrigger>
    </div>
    <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
      <DialogHeader><DialogTitle>当前运行位置</DialogTitle><DialogDescription>{native ? '服务地址与资料目录来自此应用当前使用的本机实例。' : '当前页面连接的服务地址。资料目录由服务所在设备管理。'}</DialogDescription></DialogHeader>
      <SettingsSection title={native ? '本机概览' : '当前连接'}>
        <SettingRow label="当前运行" right={<Button variant="ghost" size="icon" aria-label="复制当前服务地址" disabled={!address || !!error} onClick={() => { if (address) void copy(address, '服务地址'); }}><Copy size={14}/></Button>}/>
        <p className="select-text break-all px-4 pb-4 text-xs text-secondary" data-testid="runtime-current-address">{label}</p>
        {native && <><Divider/><SettingRow label="访问范围" right={<span className="text-xs text-secondary">仅本机</span>}/><p className="px-4 pb-4 text-xs text-muted">此 HTTP 地址用于本机连接。其他设备的同步地址在「同步」中查看。</p>
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
