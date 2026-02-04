import { useState } from 'react';
import { ChatWindow } from '../Chat/ChatWindow';
import { SettingsPage } from '../Settings/SettingsPage';
import { MessageSquare, Settings } from 'lucide-react';

export type ViewType = 'chat' | 'settings';

export function MainLayout() {
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 左侧菜单栏 */}
      <nav className="w-16 bg-gray-900 flex flex-col items-center py-4 space-y-4">
        <button
          onClick={() => setCurrentView('chat')}
          className={`p-3 rounded-lg transition-colors ${
            currentView === 'chat'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
          title="消息"
        >
          <MessageSquare size={24} />
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={`p-3 rounded-lg transition-colors ${
            currentView === 'settings'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
          title="设置"
        >
          <Settings size={24} />
        </button>
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {currentView === 'chat' ? (
          <ChatWindow
            onConnectionChange={(status: 'connected' | 'connecting' | 'disconnected') => {
              setConnectionStatus(status);
            }}
          />
        ) : (
          <SettingsPage
            connectionStatus={connectionStatus}
            onConnect={() => setConnectionStatus('connected')}
            onDisconnect={() => setConnectionStatus('disconnected')}
          />
        )}
      </main>
    </div>
  );
}
