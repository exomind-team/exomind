import { useEffect, useState } from 'react';
import { Users, LogOut, LogIn, UserPlus } from 'lucide-react';
import { useSyncStore } from '@/ui/stores/sync-store';
import {
  getThemePreference,
  resolveThemePreference,
  subscribeThemePreferenceChanges,
  subscribeSystemThemeChanges,
} from '@/config/theme';
import { SwitchAccountSheet } from './SwitchAccountSheet';

export function UserCard() {
  const { isLoggedIn, currentUser, logout } = useSyncStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'switch' | 'login' | 'register'>('login');

  const [isDark, setIsDark] = useState(() => {
    const pref = getThemePreference();
    return resolveThemePreference(pref) === 'dark';
  });

  useEffect(() => {
    function update() {
      const pref = getThemePreference();
      setIsDark(resolveThemePreference(pref) === 'dark');
    }
    const unsub1 = subscribeThemePreferenceChanges(update);
    const unsub2 = subscribeSystemThemeChanges(update);
    return () => { unsub1(); unsub2(); };
  }, []);

  function openSheet(mode: 'switch' | 'login' | 'register') {
    setSheetMode(mode);
    setSheetOpen(true);
  }

  async function handleLogout() {
    await logout();
  }

  return (
    <>
      <div
        className="relative overflow-hidden"
        style={{
          borderRadius: 20,
          padding: 20,
          border: isDark
            ? '1px solid rgba(255,255,255,0.15)'
            : '1px solid rgba(255,255,255,0.19)',
          background: isDark
            ? 'radial-gradient(circle at 15% 0%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 50%), linear-gradient(145deg, #8B3A25 0%, #6B2E1E 50%, #4A1F14 100%)'
            : 'radial-gradient(circle at 15% 0%, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 60%), linear-gradient(145deg, #E8866F 0%, #D4664A 50%, #C75B3A 100%)',
          boxShadow: isDark
            ? '0 8px 24px -4px rgba(199,91,58,0.12), 0 20px 40px -8px rgba(199,91,58,0.08)'
            : '0 8px 24px -4px rgba(199,91,58,0.19), 0 20px 40px -8px rgba(199,91,58,0.13), 0 3px 8px rgba(255,255,255,0.31)',
          backdropFilter: 'blur(20px)',
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
