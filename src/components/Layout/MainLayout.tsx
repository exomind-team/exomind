import { useState, useEffect } from 'react';
import { ChatWindow } from '../Chat/ChatWindow';
import { SettingsPage } from '../Settings/SettingsPage';
import { MessageSquare, Settings } from 'lucide-react';
import './MainLayout.css';

export type ViewType = 'chat' | 'settings';

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function NavButton({ active, onClick, icon, label }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`nav-button ${active ? 'active' : ''}`}
      title={label}
    >
      {icon}
      <span className="nav-label">{label}</span>
    </button>
  );
}

export function MainLayout() {
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [isMobile, setIsMobile] = useState(false);

  // 检测是否为移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="main-layout">
      {/* 桌面端：左侧侧边栏 */}
      {!isMobile && (
        <aside className="sidebar">
          <nav className="sidebar-nav">
            <NavButton
              active={currentView === 'chat'}
              onClick={() => setCurrentView('chat')}
              icon={<MessageSquare size={24} />}
              label="消息"
            />
            <NavButton
              active={currentView === 'settings'}
              onClick={() => setCurrentView('settings')}
              icon={<Settings size={24} />}
              label="设置"
            />
          </nav>
        </aside>
      )}

      {/* 主内容区 */}
      <main className="main-content">
        {currentView === 'chat' ? (
          <ChatWindow />
        ) : (
          <SettingsPage
            connectionStatus={connectionStatus}
            onConnect={() => setConnectionStatus('connected')}
            onDisconnect={() => setConnectionStatus('disconnected')}
          />
        )}
      </main>

      {/* 移动端：底部导航栏 */}
      {isMobile && (
        <nav className="mobile-nav">
          <NavButton
            active={currentView === 'chat'}
            onClick={() => setCurrentView('chat')}
            icon={<MessageSquare size={24} />}
            label="消息"
          />
          <NavButton
            active={currentView === 'settings'}
            onClick={() => setCurrentView('settings')}
            icon={<Settings size={24} />}
            label="设置"
          />
        </nav>
      )}
    </div>
  );
}
