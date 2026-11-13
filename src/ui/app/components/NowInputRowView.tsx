import type { KeyboardEventHandler, ReactNode, Ref } from 'react';
import { Clipboard, Image, Mic, SendHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface NowInputRowViewProps {
  value: string;
  placeholder: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  textareaLabel?: string;
  onValueChange: (value: string, element: HTMLTextAreaElement) => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onSend: () => void | Promise<unknown>;
  sendDisabled: boolean;
  sendLabel?: string;
  beforeControls?: ReactNode;
  afterControls?: ReactNode;
  voiceControl?: ReactNode;
  onAttachmentClick?: () => void;
  attachmentFeedback?: 'idle' | 'pending';
  onPasteClick?: () => void | Promise<unknown>;
  pasteFeedback?: 'idle' | 'success' | 'error';
  pasteFailureLabel?: string;
}

export function resizeNowInputTextarea(element: HTMLTextAreaElement | null | undefined): void {
  if (!element) return;
  element.style.height = 'auto';
  const minHeight = 44;
  const maxHeight = 96;
  const nextHeight = Math.max(minHeight, Math.min(element.scrollHeight, maxHeight));
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

/** Alpha's input presentation. Controllers own drafts, voice and persistence;
 * this component has no runtime, profile or storage bootstrap side effects. */
export function NowInputRowView({
  value, placeholder, inputRef, textareaLabel, onValueChange, onKeyDown,
  onSend, sendDisabled, sendLabel, beforeControls, afterControls, voiceControl,
  onAttachmentClick, attachmentFeedback = 'idle', onPasteClick,
  pasteFeedback = 'idle', pasteFailureLabel = '',
}: NowInputRowViewProps) {
  return (
    <div className="shrink-0 border-t border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]" data-testid="new-now-input-row">
      <div className="px-4 py-2">
        {beforeControls}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAttachmentClick}
            disabled={!onAttachmentClick}
            className={`flex h-9 shrink-0 items-center justify-center rounded-full bg-[#EDECE9] px-2 text-stone-500 dark:bg-[#292524] dark:text-[#A8A29E] ${attachmentFeedback === 'pending' ? 'min-w-[56px]' : 'w-9'}`}
            aria-label={attachmentFeedback === 'pending' ? '待开发' : '附件'}
            data-testid="new-now-attachment-button"
          >
            {attachmentFeedback === 'pending'
              ? <span className="text-[10px] font-medium leading-none">待开发</span>
              : <Image size={16} />}
          </button>

          {voiceControl ?? <button type="button" disabled aria-label="语音暂不可用" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EDECE9] text-stone-500 dark:bg-[#292524] dark:text-[#A8A29E]"><Mic size={16} /></button>}

          <div className="relative flex-1">
            <Textarea
              ref={inputRef}
              value={value}
              onChange={event => onValueChange(event.target.value, event.target)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label={textareaLabel}
              rows={1}
              className="min-h-[44px] rounded-3xl border-[#E7E5E4] bg-white px-4 py-2 pr-16 text-sm text-stone-700 placeholder:text-stone-400 dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              data-testid="new-now-input-textarea"
            />
            <button
              type="button"
              onClick={onPasteClick}
              disabled={!onPasteClick}
              className={`absolute right-[7px] top-1/2 flex h-[30px] min-w-[30px] -translate-y-1/2 items-center justify-center rounded-[15px] px-2 ${pasteFeedback === 'error' ? 'text-red-500 dark:text-red-400' : pasteFeedback === 'success' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-stone-400 dark:text-[#78716C]'}`}
              aria-label="剪贴板"
              data-testid="new-now-input-inline-button"
            >
              {pasteFeedback === 'success'
                ? <span className="text-[10px] font-medium leading-none">已粘贴</span>
                : pasteFeedback === 'error'
                  ? <span className="inline-flex items-center gap-0.5 text-[10px] font-medium leading-none"><X size={10} className="h-2.5 w-2.5" />{pasteFailureLabel}</span>
                  : <Clipboard size={16} />}
            </button>
          </div>

          <Button
            type="button"
            size="icon"
            onClick={() => { void onSend(); }}
            disabled={sendDisabled}
            aria-label={sendLabel}
            className="h-9 w-9 shrink-0 rounded-full bg-[#C75B3A] text-white hover:bg-[#B24D2F] data-[disabled]:bg-[#D1D5DB] data-[disabled]:text-white"
            data-testid="new-now-send-button"
          >
            <SendHorizontal size={16} />
          </Button>
        </div>
        {afterControls}
      </div>
    </div>
  );
}
