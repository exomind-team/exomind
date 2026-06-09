import type { CSSProperties } from 'react';
import {
  Archive,
  CircleCheckBig,
  CircleX,
  Hand,
  Pause,
  Play,
  type LucideIcon,
} from 'lucide-react';
import {
  SESSION_STATUS_INDICATORS,
  type SessionStatus,
} from '@/lib/types/session';

const SESSION_STATUS_ICON_BY_STATUS: Record<SessionStatus, LucideIcon> = {
  running: Play,
  waiting_input: Hand,
  completed: CircleCheckBig,
  error: CircleX,
  paused: Pause,
  archived: Archive,
};

export interface SessionStatusMarkProps {
  status: SessionStatus;
  size?: number;
  className?: string;
}

function buildShellStyle(color: string): CSSProperties {
  return {
    color,
    backgroundColor: `${color}18`,
    borderColor: `${color}36`,
  };
}

export function SessionStatusMark({
  status,
  size = 12,
  className,
}: SessionStatusMarkProps) {
  const indicator = SESSION_STATUS_INDICATORS[status];
  const Icon = SESSION_STATUS_ICON_BY_STATUS[status];

  return (
    <span
      data-testid={`session-status-mark-${status}`}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full border',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={buildShellStyle(indicator.color)}
      title={indicator.label}
      aria-label={indicator.label}
    >
      <Icon size={size} strokeWidth={2.25} />
    </span>
  );
}
