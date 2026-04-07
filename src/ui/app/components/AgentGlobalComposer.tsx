import { useEffect, useRef } from 'react';
import {
  VoiceMessageInput,
  type VoiceMessageInputHandle,
} from '@/components/VoiceMessageInput';
import {
  subscribeLocalVoiceTranscript,
  type LocalVoiceTranscriptDetail,
} from '@/lib/services/voice-signal.service';
import { normalizeRecognitionText } from '@/lib/voice/recognition-text';

export interface AgentGlobalComposerTarget {
  kind: 'pty' | 'agent-chat';
  label: string;
  placeholder: string;
  send: (content: string) => Promise<void>;
  description?: string;
}

export interface AgentGlobalComposerProps {
  target: AgentGlobalComposerTarget | null;
  variant?: 'page' | 'terminal';
  className?: string;
}

function shouldInjectShortcutTranscript(
  detail: LocalVoiceTranscriptDetail,
  target: AgentGlobalComposerTarget | null,
): boolean {
  if (!target) {
    return false;
  }

  if (detail.captureSource !== 'global-shortcut') {
    return false;
  }

  if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) {
    return false;
  }

  if (detail.targetScope === 'agent-chat') {
    return target.kind === 'agent-chat';
  }

  return true;
}

export function AgentGlobalComposer({
  target,
  variant = 'page',
  className,
}: AgentGlobalComposerProps) {
  const inputRef = useRef<VoiceMessageInputHandle | null>(null);
  const isTerminalVariant = variant === 'terminal';
  const wrapperClassName = isTerminalVariant
    ? 'shrink-0 border-t border-[#292524] bg-[#120F0E]'
    : 'shrink-0 border-t border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]';
  const badgeClassName = isTerminalVariant
    ? 'rounded-full border border-[#3F3A37] bg-[#1C1917] px-2 py-0.5 text-[11px] font-medium text-[#E7E5E4]'
    : 'rounded-full border border-[#E7E5E4] bg-white px-2 py-0.5 text-[11px] font-medium text-[#57534E] dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#D6D3D1]';
  const hintClassName = isTerminalVariant
    ? 'text-[11px] text-[#78716C]'
    : 'text-[11px] text-[#A8A29E] dark:text-[#57534E]';
  const inputClassName = isTerminalVariant
    ? 'border-[#3F3A37] bg-[#1C1917] text-[#FAFAF9] placeholder:text-[#78716C]'
    : 'border-border-card bg-card text-foreground placeholder:text-muted-foreground';

  useEffect(() => subscribeLocalVoiceTranscript((detail) => {
    if (!shouldInjectShortcutTranscript(detail, target)) {
      return;
    }

    const normalized = normalizeRecognitionText(detail.text);
    if (!normalized) {
      return;
    }

    inputRef.current?.appendText(normalized);
    inputRef.current?.focusText();
  }), [target]);

  return (
    <div
      data-testid="agent-global-composer"
      className={[wrapperClassName, className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p className={hintClassName}>
            当前输入目标
          </p>
          <p
            data-testid="agent-global-composer-target"
            className={badgeClassName}
          >
            {target?.label ?? '请先选中会话或终端'}
          </p>
        </div>
        <p className={`${hintClassName} text-right`}>
          {target?.description ?? 'Ctrl+Space 转写会写入这里'}
        </p>
      </div>

      {target ? (
        <VoiceMessageInput
          ref={inputRef}
          onSend={target.send}
          placeholder={target.placeholder}
          inputClassName={inputClassName}
          buttonSize={36}
          minRows={1}
          maxRows={5}
          showTimer={false}
          inputSendModeOverride="enter-send"
        />
      ) : (
        <div className="px-4 py-3">
          <div
            className={[
              'rounded-2xl border border-dashed px-3 py-3 text-sm',
              isTerminalVariant
                ? 'border-[#3F3A37] bg-[#1C1917] text-[#78716C]'
                : 'border-[#D6D3D1] bg-white/80 text-[#A8A29E] dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#57534E]',
            ].join(' ')}
          >
            选中一个终端或 Agent 对话后，这里会出现统一草稿输入框。
          </div>
        </div>
      )}
    </div>
  );
}
