import { useState, useEffect } from 'react';
import { ChatWindow } from '../Chat/ChatWindow';
import { SettingsPage } from '../Settings/SettingsPage';
import { MessageSquare, Settings, Home, Brain, User, ChevronLeft, ChevronRight } from 'lucide-react';
import './MainLayout.css';

export type ViewType = 'home' | 'chat' | 'growth' | 'profile' | 'settings';

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
      aria-label={label}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </button>
  );
}

export function MainLayout() {
  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 检测是否为移动端
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarCollapsed(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const navItems = [
    { id: 'home' as ViewType, icon: <Home size={22} />, label: '首页' },
    { id: 'chat' as ViewType, icon: <MessageSquare size={22} />, label: '消息' },
    { id: 'growth' as ViewType, icon: <Brain size={22} />, label: '成长' },
    { id: 'profile' as ViewType, icon: <User size={22} />, label: '个人' },
  ];

  const bottomNavItems = [
    { id: 'settings' as ViewType, icon: <Settings size={22} />, label: '设置' },
  ];

  return (
    <div className="main-layout">
      {/* 桌面端：左侧侧边栏 */}
      {!isMobile && (
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          {/* 品牌区 */}
          <div className="sidebar-header">
            <div className="brand-icon">E</div>
            <span className="brand-text">ExoMind</span>
            <button
              className="sidebar-toggle"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          {/* 主导航 */}
          <nav className="sidebar-nav">
            <div className="nav-group">
              <div className="nav-group-title">助手</div>
              {navItems.map((item) => (
                <NavButton
                  key={item.id}
                  active={currentView === item.id}
                  onClick={() => setCurrentView(item.id)}
                  icon={item.icon}
                  label={item.label}
                />
              ))}
            </div>
          </nav>

          {/* 底部导航 */}
          <div className="sidebar-footer">
            <NavButton
              active={currentView === 'settings'}
              onClick={() => setCurrentView('settings')}
              icon={<Settings size={22} />}
              label="设置"
            />
          </div>
        </aside>
      )}

      {/* 主内容区 */}
      <main className="main-content">
        {currentView === 'chat' ? (
          <ChatWindow />
        ) : currentView === 'settings' ? (
          <SettingsPage
            connectionStatus={connectionStatus}
            onConnect={() => setConnectionStatus('connected')}
            onDisconnect={() => setConnectionStatus('disconnected')}
          />
        ) : (
          <div className="chat-empty-state">
            <div className="empty-icon">{currentView === 'home' ? '🏠' : currentView === 'growth' ? '🌱' : '👤'}</div>
            <h3>{currentView === 'home' ? '欢迎使用 ExoMind' : currentView === 'growth' ? '个人成长' : '个人中心'}</h3>
            <p>功能开发中</p>
          </div>
        )}
      </main>

      {/* 移动端：底部导航栏 */}
      {isMobile && (
        <nav className="mobile-nav">
          {navItems.slice(0, 2).map((item) => (
            <NavButton
              key={item.id}
              active={currentView === item.id}
              onClick={() => setCurrentView(item.id)}
              icon={item.icon}
              label={item.label}
            />
          ))}
          {bottomNavItems.map((item) => (
            <NavButton
              key={item.id}
              active={currentView === item.id}
              onClick={() => setCurrentView(item.id)}
              icon={item.icon}
              label={item.label}
            />
          ))}
        </nav>
      )}
    </div>
  );
}
