import { ChatPage } from '@/components/Chat/ChatPage';

export function NewFocusPage() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <div className="rounded-[28px] bg-[#FAF7F5] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.25)] border border-[#F0ECE8] overflow-hidden">
        <section className="p-4 md:p-6 border-b border-[#EDE7E3] bg-gradient-to-br from-[#FCE6E1] to-[#F7D8D0]">
          <h1 className="text-lg md:text-2xl font-semibold text-stone-900">设计系统重构</h1>
          <p className="mt-1 text-xs md:text-sm text-stone-600">确保新旧 UI 过渡稳定，功能完整可回退</p>
        </section>

        <section className="min-h-[70dvh] md:min-h-[72dvh]">
          <ChatPage />
        </section>
      </div>
    </div>
  );
}

