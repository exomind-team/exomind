import { Button } from '@/components/ui/button';
import type { BetaNearbyCandidate } from './peers-client';

const SOURCE_LABEL: Record<BetaNearbyCandidate['alias_source'], string> = {
  custom: '自定义名称',
  os_default: '系统默认名称',
  stable_id: '稳定短标识',
};

function aliasState(candidate: BetaNearbyCandidate): string {
  if (candidate.alias_verification === 'confirmed') {
    return candidate.alias_confirmed_at_ms === null
      ? '名称已于上次完整同步确认'
      : `名称已于 ${new Date(candidate.alias_confirmed_at_ms).toLocaleString()} 完整同步确认`;
  }
  if (candidate.alias_verification === 'signed') return '名称签名有效，但尚未完整同步确认';
  return '未收到签名名称，仅显示稳定短标识';
}

export function BetaNearbyDevices({
  candidates,
  emptyMessage,
  disabled = false,
  onSelect,
}: {
  candidates: readonly BetaNearbyCandidate[];
  emptyMessage: string;
  disabled?: boolean;
  onSelect: (candidate: BetaNearbyCandidate, address: string) => void;
}) {
  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-xs leading-relaxed text-secondary">
        广播只表示附近存在设备。身份尚未验证；发现本身不会授予档案权限或读取资料。
      </p>
      {candidates.length === 0 ? (
        <p role="status" data-testid="beta-nearby-empty" className="text-sm text-secondary">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {candidates.map(candidate => {
            const expiry = new Date(candidate.expires_at_ms);
            const expiryLabel = Number.isNaN(expiry.getTime())
              ? '短期有效'
              : expiry.toLocaleTimeString();
            return (
              <li key={`${candidate.device_id}:${candidate.fingerprint_sha256}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-foreground">{candidate.effective_alias}</p>
                  <p className="mt-1 text-xs text-secondary">{SOURCE_LABEL[candidate.alias_source]} · {aliasState(candidate)}</p>
                  <p className="mt-1 text-xs text-secondary">广播地址仍未验证 · 发现不会授权此设备访问档案</p>
                  <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">身份与指纹</summary><dl className="mt-1 space-y-1"><div><dt>设备身份</dt><dd className="break-all font-mono">{candidate.device_id}</dd></div><div><dt>身份指纹</dt><dd className="break-all font-mono">{candidate.fingerprint_sha256}</dd></div></dl></details>
                  <p className="mt-1 text-xs text-muted">候选有效至 {expiryLabel}</p>
                </div>
                <ul className="space-y-2">
                  {candidate.addresses.map(address => (
                    <li key={address} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 break-all font-mono text-xs text-secondary">{address}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={'选择设备 ' + candidate.effective_alias + ' ' + address}
                        disabled={disabled}
                        onClick={() => onSelect(candidate, address)}
                      >
                        选择设备
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
