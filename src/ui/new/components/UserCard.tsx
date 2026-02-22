import { useState } from 'react';
import { Users, LogOut, LogIn, UserPlus } from 'lucide-react';
import { useSyncStore } from '@/ui/stores/sync-store';
import { SwitchAccountSheet } from './SwitchAccountSheet';

export function UserCard() {
  const { isLoggedIn, currentUser, logout } = useSyncStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'switch' | 'login' | 'register'>('login');

  function openSheet(mode: 'switch' | 'login' | 'register') {
    setSheetMode(mode);
    setSheetOpen(true);
  }

  async function handleLogout() {
    await logout();
  }

  return (
    <>
      {/*
        UserCard 使用 CSS 自定义属性实现暗色模式，而非 JS 条件判断。
        复杂渐变和阴影无法用 Tailwind dark: 前缀表达，因此通过 CSS 变量在 index.css 中定义。
      */}
      <div
        className="user-card relative overflow-hidden rounded-[20px] p-5 border border-white/[0.19] dark:border-white/[0.15] backdrop-blur-[20px]"
        style={{
          background: 'var(--user-card-bg)',
          boxShadow: 'var(--user-card-shadow)',
        }}
      >
        {/* Profile Top */}
        <div className="flex items-center gap-[14px]">
          {/* Avatar */}
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/20"
            style={{ border: '2px solid rgba(255,255,255,0.38)' }}
          >
            <span className="text-2xl font-bold text-white">
              {isLoggedIn && currentUser ? currentUser.charAt(0).toUpperCase() : '?'}
            </span>
          </div>

          {/* User Info */}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-bold text-white">
              {isLoggedIn && currentUser ? currentUser : '未登录'}
            </div>
            <div className="text-[13px] text-white/60">
              {isLoggedIn ? '轻触头像更换' : '登录以启用多设备同步'}
            </div>
          </div>
        </div>

        {/* Action Row */}
        <div className="mt-4 flex items-center gap-2">
          {isLoggedIn ? (
            <>
              <button
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2"
                onClick={() => openSheet('switch')}
              >
                <Users className="h-[15px] w-[15px] text-white/75" />
                <span className="text-[13px] font-medium text-white/80">切换账户</span>
              </button>
              <div className="flex-1" />
              <button
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2"
                onClick={handleLogout}
              >
                <LogOut className="h-[15px] w-[15px] text-[#FFD0C8]" />
                <span className="text-[13px] font-medium text-[#FFD0C8]">登出</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2"
                onClick={() => openSheet('login')}
              >
                <LogIn className="h-[15px] w-[15px] text-white/75" />
                <span className="text-[13px] font-medium text-white/80">登录</span>
              </button>
              <button
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2"
                onClick={() => openSheet('register')}
              >
                <UserPlus className="h-[15px] w-[15px] text-white/75" />
                <span className="text-[13px] font-medium text-white/80">注册</span>
              </button>
            </>
          )}
        </div>
      </div>

      <SwitchAccountSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialMode={sheetMode}
      />
    </>
  );
}
