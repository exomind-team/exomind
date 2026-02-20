import { CheckCircle2, Circle } from 'lucide-react';
import { ChatPage } from '@/components/Chat/ChatPage';

export function NewFocusPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="safe-area-pt-plus px-4 pb-2">
        <div className="rounded-[24px] border border-[#FFFFFF80] bg-gradient-to-br from-[#EFCFC8] via-[#E9B8AD] to-[#DF947F] p-5 shadow-[0_20px_40px_-24px_rgba(0,0,0,0.35)]">
          <h1 className="text-xl font-semibold text-stone-900">设计系统重构</h1>
          <p className="mt-1 text-xs text-stone-700">目标：成为卓越的产品设计师</p>
          <ul className="mt-4 space-y-2 text-xs text-stone-700">
            <li className="flex items-center gap-2">
              <Circle className="h-4 w-4 text-stone-400" />
              整理 token 并统一命名规范
            </li>
            <li className="flex items-center gap-2">
              <Circle className="h-4 w-4 text-stone-400" />
              替换旧组件并做透明层叠色
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#C75B3A]" />
              验证所有主要切换场景一致性
            </li>
          </ul>
        </div>
      </section>

      <section className="min-h-0 flex-1 px-4 pb-4">
        <ChatPage variant="new-mobile" hideHeader />
      </section>
    </div>
  );
}
