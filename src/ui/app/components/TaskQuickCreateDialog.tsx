import { type FormEvent, type KeyboardEvent, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface TaskQuickCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, description: string) => void | Promise<void>;
}

export function TaskQuickCreateDialog({
  open,
  onOpenChange,
  onSubmit,
}: TaskQuickCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setError('任务名称不能为空');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmedTitle, description.trim());
      onOpenChange(false);
    } catch {
      setSubmitting(false);
    }
  }

  function handleSubmitShortcut(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      const form = event.currentTarget.closest('form');
      form?.requestSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="task-quick-create-dialog"
        className="w-[calc(100vw-2rem)] max-w-md rounded-2xl"
      >
        <DialogHeader>
          <DialogTitle>快速创建任务</DialogTitle>
          <DialogDescription>在编辑模式下直接补建一个新任务节点。</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">
              任务名称 <span className="text-[#EF4444]">*</span>
            </span>
            <input
              data-testid="task-quick-create-title"
              autoFocus
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
              onKeyDown={handleSubmitShortcut}
              placeholder="输入任务标题..."
              className="mt-1 block w-full rounded-xl border border-[#E7E5E4] bg-transparent px-3 py-2 text-sm text-[#1C1917] outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:text-[#FAFAF9]"
            />
          </label>

          {error ? (
            <p data-testid="task-quick-create-error" className="text-xs text-[#EF4444]">{error}</p>
          ) : null}

          <label className="block">
            <span className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">
              描述
            </span>
            <textarea
              data-testid="task-quick-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={handleSubmitShortcut}
              placeholder="输入任务描述..."
              rows={4}
              className="mt-1 block w-full resize-y rounded-xl border border-[#E7E5E4] bg-transparent px-3 py-2 text-sm text-[#1C1917] outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:text-[#FAFAF9]"
            />
          </label>

          <DialogFooter>
            <button
              type="button"
              data-testid="task-quick-create-cancel"
              onClick={() => onOpenChange(false)}
              className="rounded-full px-4 py-2 text-sm font-medium text-[#78716C] transition-colors hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="task-quick-create-submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              创建
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
