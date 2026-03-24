import { Check, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EventMarkdown } from '@/components/Chat/EventMarkdown';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getReminderService } from '@/lib/services/reminder.service';
import type { Reminder } from '@/lib/types/reminder';
import { useReminderUiStore } from '@/ui/stores/reminder-ui-store';

type ReminderTab = 'pending' | 'triggered' | 'completed';

const TAB_LABEL: Record<ReminderTab, string> = {
  pending: '未到期',
  triggered: '已触发',
  completed: '已完成',
};

const TAB_EMPTY_TEXT: Record<ReminderTab, string> = {
  pending: '暂无未到期提醒，创建一个新的提醒吧。',
  triggered: '暂无待处理的已触发提醒。',
  completed: '暂无已完成提醒。',
};

function toDatetimeLocalValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDatetimeLocalValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  if (!Number.isFinite(timestamp)) return null;
  return timestamp;
}

function resolveInitialDueAt(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() + 5);
  return toDatetimeLocalValue(now.getTime());
}

function formatDueAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeDue(dueAt: number, nowMs: number): string {
  const diffMinutes = Math.round((dueAt - nowMs) / 60_000);
  if (Math.abs(diffMinutes) <= 1) return '即将触发';

  if (diffMinutes > 0) {
    if (diffMinutes < 60) return `${diffMinutes} 分钟后`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} 小时后`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} 天后`;
  }

  const overdueMinutes = Math.abs(diffMinutes);
  if (overdueMinutes < 60) return `已过期 ${overdueMinutes} 分钟`;
  const overdueHours = Math.round(overdueMinutes / 60);
  if (overdueHours < 24) return `已过期 ${overdueHours} 小时`;
  const overdueDays = Math.round(overdueHours / 24);
  return `已过期 ${overdueDays} 天`;
}

function sortRemindersByTab(tab: ReminderTab, reminders: Reminder[]): Reminder[] {
  const cloned = [...reminders];

  if (tab === 'pending') {
    return cloned.sort((left, right) => left.dueAt - right.dueAt);
  }

  if (tab === 'triggered') {
    return cloned.sort((left, right) => right.dueAt - left.dueAt);
  }

  return cloned.sort((left, right) => (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt));
}

export function RemindersPage() {
  const reminderServiceRef = useRef(getReminderService());
  const [activeTab, setActiveTab] = useState<ReminderTab>('pending');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [highlightedReminderId, setHighlightedReminderId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formDueAt, setFormDueAt] = useState(() => resolveInitialDueAt());
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const composeRequestToken = useReminderUiStore((state) => state.composeRequestToken);
  const focusReminderId = useReminderUiStore((state) => state.focusReminderId);
  const clearFocus = useReminderUiStore((state) => state.clearFocus);
  const seenComposeRequestTokenRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    const service = reminderServiceRef.current;

    const loadReminders = async () => {
      const list = await service.listReminders();
      if (disposed) return;
      setReminders(list);
      setLoading(false);
    };

    void loadReminders();
    const unsubscribe = service.onReminderChange(() => {
      void loadReminders();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (composeRequestToken === 0 || composeRequestToken === seenComposeRequestTokenRef.current) {
      return;
    }

    seenComposeRequestTokenRef.current = composeRequestToken;
    setEditingReminderId(null);
    setFormTitle('');
    setFormContent('');
    setFormDueAt(resolveInitialDueAt());
    setFormError('');
    setDialogOpen(true);
  }, [composeRequestToken]);

  useEffect(() => {
    if (!focusReminderId) return;

    setActiveTab('triggered');
    setHighlightedReminderId(focusReminderId);
    clearFocus();

    const timeout = setTimeout(() => {
      const target = document.getElementById(`reminder-card-${focusReminderId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);

    const clearHighlightTimeout = setTimeout(() => {
      setHighlightedReminderId((current) => (
        current === focusReminderId ? null : current
      ));
    }, 2_000);

    return () => {
      clearTimeout(timeout);
      clearTimeout(clearHighlightTimeout);
    };
  }, [clearFocus, focusReminderId]);

  const tabCounts = useMemo(() => ({
    pending: reminders.filter((reminder) => reminder.status === 'pending').length,
    triggered: reminders.filter((reminder) => reminder.status === 'triggered').length,
    completed: reminders.filter((reminder) => reminder.status === 'completed').length,
  }), [reminders]);

  const visibleReminders = useMemo(() => {
    const tabItems = reminders.filter((reminder) => reminder.status === activeTab);
    return sortRemindersByTab(activeTab, tabItems);
  }, [activeTab, reminders]);

  const openCreateDialog = () => {
    setEditingReminderId(null);
    setFormTitle('');
    setFormContent('');
    setFormDueAt(resolveInitialDueAt());
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (reminder: Reminder) => {
    if (reminder.status !== 'pending') return;

    setEditingReminderId(reminder.id);
    setFormTitle(reminder.title);
    setFormContent(reminder.content);
    setFormDueAt(toDatetimeLocalValue(reminder.dueAt));
    setFormError('');
    setDialogOpen(true);
  };

  const handleCompleteReminder = async (reminderId: string) => {
    await reminderServiceRef.current.completeReminder(reminderId);
  };

  const handleSubmit = async () => {
    const title = formTitle.trim();
    if (!title) {
      setFormError('提醒标题不能为空');
      return;
    }

    const dueAt = parseDatetimeLocalValue(formDueAt);
    if (!dueAt) {
      setFormError('请选择有效的提醒时间');
      return;
    }

    setSubmitting(true);
    setFormError('');

    try {
      const normalizedDueAt = dueAt < Date.now() ? Date.now() : dueAt;
      if (editingReminderId) {
        await reminderServiceRef.current.updateReminder(editingReminderId, {
          title,
          content: formContent,
          dueAt: normalizedDueAt,
        });
      } else {
        await reminderServiceRef.current.createReminder({
          title,
          content: formContent,
          dueAt: normalizedDueAt,
        });
      }

      setDialogOpen(false);
      setEditingReminderId(null);
      setFormTitle('');
      setFormContent('');
      setFormDueAt(resolveInitialDueAt());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存提醒失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="reminders-page">
      <header className="flex items-center justify-between border-b border-[#F0ECE8] px-6 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <div>
          <h1 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">提醒</h1>
          <p className="text-xs text-[#A8A29E] dark:text-[#78716C]">替代微信提醒的应用内定时提醒</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={openCreateDialog}
          className="h-9 gap-1 rounded-full bg-[#C75B3A] px-3 text-white hover:bg-[#B24D2F]"
        >
          <Plus size={16} />
          新建
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+88px)] pt-3 md:px-8 md:pb-24 lg:px-10">
        <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
          {(Object.keys(TAB_LABEL) as ReminderTab[]).map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 rounded-2xl px-4 py-1.5 text-[13px] ${
                  active
                    ? 'bg-[#C75B3A] font-semibold text-white'
                    : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
                }`}
              >
                {TAB_LABEL[tab]} ({tabCounts[tab]})
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="text-sm text-[#A8A29E]">提醒加载中...</p>
        ) : visibleReminders.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-4 py-5 text-center text-sm text-[#A8A29E] dark:border-[#3A3432] dark:bg-[#1C1917] dark:text-[#B8B1AC]">
            {TAB_EMPTY_TEXT[activeTab]}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleReminders.map((reminder) => (
              <article
                id={`reminder-card-${reminder.id}`}
                key={reminder.id}
                className={`rounded-2xl border bg-white p-4 transition-colors dark:bg-[#1C1917] ${
                  highlightedReminderId === reminder.id
                    ? 'border-[#C75B3A] shadow-[0_0_0_2px_rgba(199,91,58,0.15)]'
                    : 'border-[#E7E5E4] dark:border-[#292524]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                      {reminder.title}
                    </h2>
                    <p className="mt-1 text-xs text-[#A8A29E]">
                      {formatDueAt(reminder.dueAt)} · {formatRelativeDue(reminder.dueAt, nowMs)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {reminder.status === 'pending' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditDialog(reminder)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] transition-colors hover:bg-[#EDE6E0] dark:bg-[#292524] dark:text-[#A8A29E]"
                          aria-label="编辑提醒"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleCompleteReminder(reminder.id);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#E8F5E9] text-[#15803D] transition-colors hover:bg-[#DCF0DE]"
                          aria-label="标记已处理"
                        >
                          <Check size={14} />
                        </button>
                      </>
                    ) : reminder.status === 'triggered' ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleCompleteReminder(reminder.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-3 py-1.5 text-xs font-medium text-[#15803D] transition-colors hover:bg-[#DCF0DE]"
                      >
                        <Check size={14} />
                        已处理
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#0F0D0C]">
                  <EventMarkdown content={reminder.content || '*（无正文）*'} />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingReminderId ? '编辑提醒' : '新建提醒'}</DialogTitle>
            <DialogDescription>
              填写提醒标题、Markdown 正文和触发时间（精确到分钟）。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-[#78716C]">标题</label>
              <Input
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder="例如：提交周报"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-[#78716C]">内容（Markdown）</label>
              <Textarea
                value={formContent}
                onChange={(event) => setFormContent(event.target.value)}
                placeholder="写下提醒详情，例如待办清单、链接、备注..."
                rows={6}
                className="resize-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-[#78716C]">触发时间</label>
              <Input
                type="datetime-local"
                value={formDueAt}
                onChange={(event) => setFormDueAt(event.target.value)}
                min={toDatetimeLocalValue(Date.now())}
              />
            </div>

            {formError ? (
              <p className="text-xs text-[#DC2626]">{formError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={submitting}
              className="bg-[#C75B3A] text-white hover:bg-[#B24D2F]"
            >
              {submitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
