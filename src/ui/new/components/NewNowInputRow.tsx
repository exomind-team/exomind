import {
  KeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Clipboard, Image, SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { VoiceMessageInputHandle } from '@/components/VoiceMessageInput';

interface NewNowInputRowProps {
  onSend: (content: string) => void;
  placeholder?: string;
}

export const NewNowInputRow = forwardRef<VoiceMessageInputHandle, NewNowInputRowProps>(function NewNowInputRow({
  onSend,
  placeholder = '记录当下的事实...',
}, ref) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = useCallback((target?: HTMLTextAreaElement | null) => {
    const el = target ?? textareaRef.current;
    if (!el) return;

    el.style.height = 'auto';
    const minHeight = 44;
    const maxHeight = 96;
    const nextHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [value, resizeTextarea]);

  const submitInput = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  }, [onSend, value]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      textareaRef.current?.blur();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitInput();
    }
  }, [submitInput]);

  useImperativeHandle(ref, () => ({
    focusText: () => {
      textareaRef.current?.focus();
    },
    startVoiceRecording: () => {
      // voice recording（语音录制）入口由后续专用按钮接入
    },
  }), []);

  return (
    <div className="mb-2 shrink-0 border-t border-subtle bg-surface" data-testid="new-now-input-row">
      <div className="px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EDECE9] text-stone-500"
            aria-label="附件"
            data-testid="new-now-attachment-button"
          >
            <Image size={16} />
          </button>

          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                resizeTextarea(event.target);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              className="min-h-[44px] rounded-3xl border-[#E7E5E4] bg-card px-4 py-2 pr-10 text-sm text-strong placeholder:text-muted"
              data-testid="new-now-input-textarea"
            />
            <button
              type="button"
              onClick={() => textareaRef.current?.focus()}
              className="absolute right-[7px] top-1/2 flex h-[30px] w-[30px] -translate-y-1/2 items-center justify-center rounded-[15px] text-stone-400"
              aria-label="剪贴板"
              data-testid="new-now-input-inline-button"
            >
              <Clipboard size={16} />
            </button>
          </div>

          <Button
            type="button"
            size="icon"
            onClick={submitInput}
            disabled={!value.trim()}
            className="h-9 w-9 shrink-0 rounded-full bg-[#C75B3A] text-white hover:bg-[#B24D2F] data-[disabled]:bg-[#D1D5DB] data-[disabled]:text-white"
            data-testid="new-now-send-button"
          >
            <SendHorizontal size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
});
