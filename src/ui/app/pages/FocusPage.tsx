import { ChatPage } from '@/components/Chat/ChatPage';

export function FocusPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="min-h-0 flex-1" data-testid="new-now-chat-section">
        <ChatPage variant="new-mobile" hideHeader />
      </section>
    </div>
  );
}
