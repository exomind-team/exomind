import { CheckCircle2, Circle } from 'lucide-react';
import { ChatPage } from '@/components/Chat/ChatPage';

export function NewFocusPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="safe-area-pt-plus px-4 pb-1">
        <div className="relative h-[188px]">
          <div
            data-testid="new-now-task-card-glow"
            className="absolute left-1/2 top-4 h-[148px] w-[92%] -translate-x-1/2 rounded-[22px] bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] blur-[8px]"
          />
          <div
            data-testid="new-now-task-card"
            className="relative mx-auto rounded-[24px] border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-6px_rgba(0,0,0,0.15),0_20px_40px_-8px_rgba(0,0,0,0.10)] backdrop-blur-[24px]"
          >
            <h1 className="text-center text-xl font-semibold leading-[1.25] text-stone-900">设计系统重构</h1>
            <p className="mt-1 text-center text-xs text-stone-700">目标：成为卓越的产品设计师</p>
            <ul className="mt-4 space-y-2 text-xs text-stone-700">
              <li className="flex items-center gap-2">
                <Circle className="h-4 w-4 text-stone-300" />
                整理 token 并统一命名规范
              </li>
              <li className="flex items-center gap-2">
                <Circle className="h-4 w-4 text-stone-300" />
                替换旧组件并做透明层叠色
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#C75B3A]" />
                验证所有主要切换场景一致性
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="min-h-0 flex-1" data-testid="new-now-chat-section">
        <ChatPage variant="new-mobile" hideHeader />
      </section>
    </div>
  );
}
