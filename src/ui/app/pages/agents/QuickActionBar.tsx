import { useState, useCallback } from 'react';
import { Send, Check, X, MessageSquare, Hand } from 'lucide-react';
import type { QuickAction, QuickActionResponse } from '@/lib/types/session';

// ── Types ──────────────────────────────────────────────────────

export interface QuickActionBarProps {
  /** Available quick actions for this session */
  actions: QuickAction[];
  /** Optional prompt message from the agent */
  prompt?: string;
  /** Callback when user submits a quick action response */
  onSubmit: (response: QuickActionResponse) => void;
  /** Whether the submit is in progress */
  isSubmitting?: boolean;
  /** For PTY terminal mode: manual mark button */
  showMarkWaiting?: boolean;
  /** Callback when user clicks "mark as waiting" for PTY sessions */
  onMarkWaiting?: () => void;
}

// ── Component ──────────────────────────────────────────────────

export function QuickActionBar({
  actions,
  prompt,
  onSubmit,
  isSubmitting = false,
  showMarkWaiting = false,
  onMarkWaiting,
}: QuickActionBarProps) {
  const [textValue, setTextValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleButtonClick = useCallback(
    (action: QuickAction) => {
      if (isSubmitting) return;
      onSubmit({ action_id: action.id, value: action.payload ?? undefined });
    },
    [onSubmit, isSubmitting],
  );

  const handleTextSubmit = useCallback(
    (action: QuickAction) => {
      if (isSubmitting || !textValue.trim()) return;
      onSubmit({ action_id: action.id, value: textValue.trim() });
      setTextValue('');
    },
    [onSubmit, isSubmitting, textValue],
  );

  const handleConfirm = useCallback(
    (action: QuickAction, confirmed: boolean) => {
      if (isSubmitting) return;
      onSubmit({ action_id: action.id, value: confirmed ? 'true' : 'false' });
      setConfirmingId(null);
    },
    [onSubmit, isSubmitting],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, action: QuickAction) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleTextSubmit(action);
      }
    },
    [handleTextSubmit],
  );

  // If no actions defined and no mark-waiting, show nothing
  if (actions.length === 0 && !showMarkWaiting) return null;

  return (
    <div
      data-testid="quick-action-bar"
      className="flex flex-col gap-1.5 border-t border-yellow-400/30 bg-yellow-50/50 px-2 py-1.5 dark:border-yellow-500/20 dark:bg-yellow-950/20"
    >
      {/* Prompt message */}
      {prompt && (
        <div className="flex items-start gap-1.5">
          <MessageSquare size={10} className="mt-0.5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
          <p className="text-[10px] leading-tight text-yellow-700 dark:text-yellow-300">
            {prompt}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-1">
        {actions.map((action) => {
          if (action.action_type === 'button') {
            return (
              <button
                key={action.id}
                type="button"
                disabled={isSubmitting}
                onClick={() => handleButtonClick(action)}
                className="rounded bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 transition-colors hover:bg-yellow-200 disabled:opacity-50 dark:bg-yellow-900/50 dark:text-yellow-200 dark:hover:bg-yellow-800/50"
                title={action.description}
              >
                {action.label}
              </button>
            );
          }

          if (action.action_type === 'text_input') {
            return (
              <div key={action.id} className="flex flex-1 items-center gap-1 min-w-[120px]">
                <input
                  type="text"
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, action)}
                  placeholder={action.description || action.label}
                  disabled={isSubmitting}
                  className="min-w-0 flex-1 rounded border border-yellow-300 bg-white px-1.5 py-0.5 text-[10px] text-[#1C1917] placeholder-yellow-400 outline-none focus:border-yellow-500 disabled:opacity-50 dark:border-yellow-700 dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder-yellow-600"
                />
                <button
                  type="button"
                  disabled={isSubmitting || !textValue.trim()}
                  onClick={() => handleTextSubmit(action)}
                  className="flex h-5 w-5 items-center justify-center rounded bg-yellow-500 text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
                  title="发送"
                >
                  <Send size={8} />
                </button>
              </div>
            );
          }

          if (action.action_type === 'confirm') {
            if (confirmingId === action.id) {
              return (
                <div key={action.id} className="flex items-center gap-1">
                  <span className="text-[10px] text-yellow-700 dark:text-yellow-300">
                    {action.label}?
                  </span>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleConfirm(action, true)}
                    className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
                    title="确认"
                  >
                    <Check size={8} />
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleConfirm(action, false)}
                    className="flex h-5 w-5 items-center justify-center rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                    title="取消"
                  >
                    <X size={8} />
                  </button>
                </div>
              );
            }
            return (
              <button
                key={action.id}
                type="button"
                disabled={isSubmitting}
                onClick={() => setConfirmingId(action.id)}
                className="rounded bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 transition-colors hover:bg-yellow-200 disabled:opacity-50 dark:bg-yellow-900/50 dark:text-yellow-200 dark:hover:bg-yellow-800/50"
                title={action.description}
              >
                {action.label}
              </button>
            );
          }

          return null;
        })}

        {/* Manual mark-waiting button (for PTY terminal mode) */}
        {showMarkWaiting && (
          <button
            type="button"
            onClick={onMarkWaiting}
            disabled={isSubmitting}
            className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-800/50"
            title="手动标记此会话为等待决策状态"
          >
            <Hand size={8} />
            等待决策
          </button>
        )}
      </div>
    </div>
  );
}
