import { useMemo, useRef, useState } from 'react';
import { Check, Circle, Clock3, Lock, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { redactDiagnostic, type RedactedDiagnostic } from './redacted-diagnostic';

export type ActionableStateKind =
  | 'pending'
  | 'success'
  | 'warning'
  | 'error'
  | 'unknown'
  | 'private';

export interface ActionableAction {
  id: string;
  label: string;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
}

export interface BetaActionableStateProps {
  state: ActionableStateKind;
  title: string;
  detail?: string;
  lastConfirmedAtMs?: number;
  actions?: readonly ActionableAction[];
  diagnostic?: RedactedDiagnostic | null;
  onAction?: (id: string) => void;
  onCopyDiagnostic?: () => Promise<'copied' | 'failed'>;
}

const STATE_LABELS: Record<ActionableStateKind, string> = {
  pending: '处理中',
  success: '已完成',
  warning: '需注意',
  error: '出错了',
  unknown: '状态未知',
  private: '私有',
};

const COPY_AVAILABLE_STATES: ReadonlySet<ActionableStateKind> = new Set([
  'pending',
  'error',
  'unknown',
  'private',
]);

function stateIcon(state: ActionableStateKind) {
  switch (state) {
    case 'pending':
      return Clock3;
    case 'success':
      return Check;
    case 'warning':
    case 'error':
      return TriangleAlert;
    case 'unknown':
      return Circle;
    case 'private':
      return Lock;
  }
}

function formatLastConfirmed(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(ms);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-all text-right text-foreground">{value}</dd>
    </div>
  );
}

/** Shared contract surface for consequential waits, errors, unknown results and
 * private-but-alive states. The state itself may never disappear; only body
 * content may be redacted. */
export function BetaActionableState({
  state,
  title,
  detail,
  lastConfirmedAtMs,
  actions,
  diagnostic,
  onAction,
  onCopyDiagnostic,
}: BetaActionableStateProps) {
  // Re-sanitize defensively so an untyped raw payload can never leak body text.
  const safeDiagnostic = useMemo(
    () => (diagnostic ? redactDiagnostic(diagnostic) : null),
    [diagnostic],
  );
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const copyFlight = useRef(0);

  const Icon = stateIcon(state);
  const showCopy = COPY_AVAILABLE_STATES.has(state);

  const handleCopy = async () => {
    if (!onCopyDiagnostic || copyBusy) return;
    const flight = ++copyFlight.current;
    setCopyBusy(true);
    setCopyNotice(null);
    try {
      const result = await onCopyDiagnostic();
      if (copyFlight.current !== flight) return;
      setCopyNotice(result === 'copied' ? '诊断已复制' : '复制失败，可重试');
    } catch {
      if (copyFlight.current !== flight) return;
      setCopyNotice('复制失败，可重试');
    } finally {
      if (copyFlight.current === flight) setCopyBusy(false);
    }
  };

  return (
    <div
      data-testid="beta-actionable-state"
      data-state={state}
      className="beta-ui min-w-0 rounded-2xl border border-border-card bg-card p-4 text-foreground shadow-sm sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            state === 'error'
              ? 'bg-destructive/10 text-destructive'
              : state === 'warning'
                ? 'bg-secondary/40 text-secondary-foreground'
                : 'bg-primary/10 text-primary'
          }`}
        >
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-base font-semibold text-strong">
              {title}
            </h2>
            <Badge variant={state === 'error' ? 'destructive' : 'secondary'}>
              {STATE_LABELS[state]}
            </Badge>
          </div>
          {detail ? (
            <p className="mt-1 text-sm text-secondary">{detail}</p>
          ) : null}
          {lastConfirmedAtMs !== undefined ? (
            <p className="mt-1 text-xs text-muted">
              最近确认：{formatLastConfirmed(lastConfirmedAtMs)}
            </p>
          ) : null}
        </div>
      </div>

      {actions?.length || (showCopy && onCopyDiagnostic) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions?.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant={action.variant ?? 'outline'}
              onClick={() => onAction?.(action.id)}
            >
              {action.label}
            </Button>
          ))}
          {showCopy && onCopyDiagnostic ? (
            <Button
              type="button"
              variant="ghost"
              aria-busy={copyBusy}
              onClick={handleCopy}
            >
              复制诊断
            </Button>
          ) : null}
        </div>
      ) : null}

      {copyNotice ? (
        <p role="status" className="mt-2 text-xs text-secondary">
          {copyNotice}
        </p>
      ) : null}

      {safeDiagnostic ? (
        <details className="mt-3 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer select-none font-medium text-secondary">
            诊断详情
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {safeDiagnostic.operation ? (
              <DiagnosticItem label="操作" value={safeDiagnostic.operation} />
            ) : null}
            {safeDiagnostic.code ? (
              <DiagnosticItem label="错误码" value={safeDiagnostic.code} />
            ) : null}
            {safeDiagnostic.deviceId ? (
              <DiagnosticItem label="设备" value={safeDiagnostic.deviceId} />
            ) : null}
            {safeDiagnostic.profileId ? (
              <DiagnosticItem label="档案" value={safeDiagnostic.profileId} />
            ) : null}
            {safeDiagnostic.candidate ? (
              <DiagnosticItem label="候选" value={safeDiagnostic.candidate} />
            ) : null}
            {safeDiagnostic.lastStage ? (
              <DiagnosticItem label="最后阶段" value={safeDiagnostic.lastStage} />
            ) : null}
            {safeDiagnostic.timestampMs !== null ? (
              <DiagnosticItem
                label="时间"
                value={new Date(safeDiagnostic.timestampMs).toISOString()}
              />
            ) : null}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
