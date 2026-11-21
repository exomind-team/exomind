import { Button } from '@/components/ui/button';
import type { BetaNearbyCandidate } from './peers-client';

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
              <li key={candidate.device_id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs text-foreground">{candidate.device_id}</p>
                  <p className="mt-1 text-xs text-secondary">未验证 · 发现不会授权此设备访问档案</p>
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
                        aria-label={'选择设备 ' + candidate.device_id + ' ' + address}
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
