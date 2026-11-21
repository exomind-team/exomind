import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Pencil, RefreshCw, RotateCcw, Waypoints } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { SettingRow } from '@/ui/app/components/settings-shared';
import { BetaApiError } from './api-error';
import { writeBetaMessageClipboard } from './beta-message-clipboard';
import type { BetaEnvironmentAlias, BetaPeersClient } from './peers-client';

type AliasAction = 'load' | 'save' | 'reset' | 'copy';

const SOURCE_LABEL: Record<BetaEnvironmentAlias['source'], string> = {
  custom: '自定义名称',
  os_default: '系统默认名称',
  stable_id: '稳定短标识',
};

function failureText(failure: unknown): string {
  if (failure instanceof BetaApiError) return failure.message;
  return failure instanceof Error && failure.message ? failure.message : '名称操作未完成';
}

function diagnostic(deviceId: string, action: AliasAction, code: string): string {
  return [
    '外心实例名诊断',
    'operation: environment_alias',
    `stage: ${action}`,
    `device: ${deviceId.slice(0, 8)}`,
    `code: ${code.slice(0, 64)}`,
    `timestamp_ms: ${Date.now()}`,
  ].join('\n');
}

export function BetaEnvironmentAliasSetting({
  peers,
  deviceId,
  copyText = writeBetaMessageClipboard,
}: {
  peers: BetaPeersClient;
  deviceId: string;
  copyText?: (value: string) => Promise<void>;
}) {
  const [alias, setAlias] = useState<BetaEnvironmentAlias | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<AliasAction | null>(null);
  const [error, setError] = useState('');
  const [failureCode, setFailureCode] = useState('operation_failed');
  const [failedAction, setFailedAction] = useState<AliasAction | null>(null);
  const [notice, setNotice] = useState('');
  const scopeToken = useRef(0);

  useEffect(() => {
    const token = ++scopeToken.current;
    setAlias(null);
    setDraft('');
    setEditing(false);
    setBusy(null);
    setError('');
    setFailureCode('operation_failed');
    setFailedAction(null);
    setNotice('');
    void load(token);
    return () => {
      if (scopeToken.current === token) scopeToken.current++;
    };
  }, [peers, deviceId]);

  async function load(token = scopeToken.current) {
    setBusy('load');
    setError('');
    setFailureCode('operation_failed');
    setFailedAction(null);
    try {
      const value = await peers.environmentAlias();
      if (token !== scopeToken.current) return;
      if (value.device_id !== deviceId) throw new Error('本机服务已切换，请重新读取实例名');
      setAlias(value);
      setDraft(value.effective_alias);
    } catch (failure) {
      if (token !== scopeToken.current) return;
      setError(failureText(failure));
      setFailureCode(failure instanceof BetaApiError ? failure.code : 'operation_failed');
      setFailedAction('load');
    } finally {
      if (token === scopeToken.current) setBusy(null);
    }
  }

  async function save(next: string | null) {
    const token = scopeToken.current;
    const action: AliasAction = next === null ? 'reset' : 'save';
    setBusy(action);
    setError('');
    setFailureCode('operation_failed');
    setFailedAction(null);
    setNotice('');
    try {
      const value = await peers.setEnvironmentAlias(next === null ? null : next.trim());
      if (token !== scopeToken.current) return;
      if (value.device_id !== deviceId) throw new Error('本机服务已切换，保存结果未应用');
      setAlias(value);
      setDraft(value.effective_alias);
      setEditing(false);
      setNotice(action === 'reset' ? '已恢复系统默认名称。' : '本机外心实例名已保存。');
    } catch (failure) {
      if (token !== scopeToken.current) return;
      setError(failureText(failure));
      setFailureCode(failure instanceof BetaApiError ? failure.code : 'operation_failed');
      setFailedAction(action);
    } finally {
      if (token === scopeToken.current) setBusy(null);
    }
  }

  async function copyDiagnostic() {
    const token = scopeToken.current;
    setBusy('copy');
    setNotice('');
    try {
      await copyText(diagnostic(deviceId, failedAction ?? 'load', failureCode));
      if (token === scopeToken.current) setNotice('脱敏名称诊断已复制。');
    } catch (failure) {
      if (token === scopeToken.current) setNotice(`诊断复制失败：${failureText(failure)}`);
    } finally {
      if (token === scopeToken.current) setBusy(null);
    }
  }

  function retry() {
    if (failedAction === 'save') void save(draft);
    else if (failedAction === 'reset') void save(null);
    else void load();
  }

  const saveDisabled = busy !== null || draft.trim().length === 0;
  return <SettingsSection title="本机外心实例名">
    <SettingRow
      icon={<Waypoints className="size-4 text-muted" />}
      label="其他设备看到的名称"
      right={!editing && alias ? <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { setEditing(true); setNotice(''); }}>
        <Pencil size={14} />编辑名称
      </Button> : undefined}
    />
    <div className="space-y-3 px-4 pb-4">
      {busy === 'load' && !alias && <p role="status" className="text-sm text-secondary">正在读取本机外心实例名…</p>}
      {alias && !editing && <div className="space-y-2">
        <p data-testid="beta-environment-alias" className="break-words text-lg font-medium text-foreground">{alias.effective_alias}</p>
        <p className="text-xs text-secondary">来源：{SOURCE_LABEL[alias.source]} · 这是类似蓝牙名称的展示门面，不替代设备身份、TLS pin 或档案授权。</p>
        {alias.source === 'custom' && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void save(null)}>
          <RotateCcw size={14} />{busy === 'reset' ? '正在恢复…' : '恢复系统默认名称'}
        </Button>}
      </div>}
      {alias && editing && <div className="space-y-2">
        <label htmlFor="beta-environment-alias-input" className="text-xs font-medium text-foreground">本机外心实例名</label>
        <Input
          id="beta-environment-alias-input"
          aria-label="本机外心实例名"
          value={draft}
          maxLength={alias.max_chars}
          autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !saveDisabled) {
              event.preventDefault();
              void save(draft);
            } else if (event.key === 'Escape' && busy === null) {
              setEditing(false);
              setDraft(alias.effective_alias);
              setError('');
              setFailedAction(null);
            }
          }}
        />
        <p className="text-xs text-secondary">最多 {alias.max_chars} 个字符。空白会合并；名称变化会在下一次完整同步后重新确认。</p>
        {draft.trim().length === 0 && <p role="status" className="text-xs text-destructive">实例名不能为空；可以取消或恢复系统默认名称。</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={saveDisabled} onClick={() => void save(draft)}>
            <Check size={14} />{busy === 'save' ? '正在保存…' : '保存名称'}
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { setEditing(false); setDraft(alias.effective_alias); setError(''); setFailedAction(null); }}>取消</Button>
          {alias.source === 'custom' && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void save(null)}>
            <RotateCcw size={14} />恢复默认
          </Button>}
        </div>
      </div>}
      {error && <div className="space-y-2 rounded-lg border border-border-card p-3">
        <p role="alert" className="text-sm text-destructive">实例名操作失败：{error}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={retry}>
            <RefreshCw size={14} />{failedAction === 'save' ? '重试保存' : failedAction === 'reset' ? '重试恢复默认' : '重新读取名称'}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void copyDiagnostic()}>
            <Copy size={14} />{busy === 'copy' ? '正在复制…' : '复制名称诊断'}
          </Button>
        </div>
      </div>}
      {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
    </div>
  </SettingsSection>;
}
