import { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { listLocalProfiles } from '@/lib/profile/profile-storage';
import { useSyncStore } from '@/ui/stores/sync-store';

interface UserInfo {
  profileId: string;
  loginName: string;
  displayName: string;
  createdAt: string;
  lastLogin?: string;
}

interface SwitchAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode: 'switch' | 'login' | 'register';
}

export function SwitchAccountSheet({ open, onOpenChange, initialMode }: SwitchAccountSheetProps) {
  const { login, register, logout, activeProfileId, isLoggedIn } = useSyncStore();

  const [mode, setMode] = useState<'switch' | 'login' | 'register'>(initialMode);
  const [previousMode, setPreviousMode] = useState<'switch' | 'login'>(initialMode === 'register' ? 'login' : initialMode as 'switch' | 'login');
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // When sheet opens, reset state and reload users
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setPreviousMode(initialMode === 'register' ? 'login' : initialMode as 'switch' | 'login');
      setSelectedUser(null);
      setPassword('');
      setUsername('');
      setRegPassword('');
      setConfirmPassword('');
      setError('');
      setLoading(false);
      loadUsers();
    }
  }, [open, initialMode]);

  function loadUsers() {
    const profiles = listLocalProfiles().map((profile) => ({
      profileId: profile.profileId,
      loginName: profile.slug,
      displayName: profile.displayName,
      createdAt: profile.createdAt,
    }));
    setUsers(profiles);
  }

  async function handleSwitchLogin() {
    if (!selectedUser || !password) return;
    setLoading(true);
    setError('');
    try {
      await login(selectedUser, password);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '打开档案失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    if (!username || !password) return;
    setLoading(true);
    setError('');
    try {
      await login(username, password);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '打开档案失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (!username || !regPassword || !confirmPassword) return;
    if (regPassword !== confirmPassword) {
      setError('两次密码不一致');
      return;
    }
    if (regPassword.length < 6) {
      setError('密码长度至少6位');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await register(username, regPassword);
      await login(username, regPassword);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建档案失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    if (!isLoggedIn || !activeProfileId) return;
    setLoading(true);
    setError('');
    try {
      await logout();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '退出档案失败');
    } finally {
      setLoading(false);
    }
  }

  function goToRegister() {
    setPreviousMode(mode as 'switch' | 'login');
    setMode('register');
    setError('');
    setUsername('');
    setRegPassword('');
    setConfirmPassword('');
  }

  function goToLogin() {
    setMode('login');
    setError('');
    setUsername('');
    setPassword('');
  }

  function goBack() {
    setMode(previousMode);
    setError('');
  }

  const selectedProfile = users.find((user) => user.loginName === selectedUser) || null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="px-5 pb-6 pt-2">
          {/* Switch mode */}
          {mode === 'switch' && (
            <div className="space-y-3">
              <DrawerTitle className="text-base font-semibold text-stone-800">
                切换本地档案
              </DrawerTitle>

              <div className="space-y-2">
                {users.map((user) => {
                  const isCurrent = user.profileId === activeProfileId;
                  const isSelected = user.loginName === selectedUser;
                  return (
                    <button
                      key={user.profileId}
                      className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                        isCurrent
                          ? 'border-[#C75B3A]/30 bg-[#C75B3A]/5'
                          : isSelected
                            ? 'border-[#C75B3A]/50 bg-[#FAF7F5]'
                            : 'border-[#F0ECE8] hover:bg-[#FAF7F5]'
                      }`}
                      onClick={() => {
                        if (!isCurrent) {
                          setSelectedUser(user.loginName);
                          setPassword('');
                          setError('');
                        }
                      }}
                    >
                      <div>
                        <div className="text-sm font-medium text-stone-800">
                          {user.displayName}
                        </div>
                        <div className="text-xs text-stone-400 space-y-0.5">
                          <div>档案标识：{user.loginName}</div>
                          注册于 {new Date(user.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      {isCurrent && (
                        <span className="rounded-full bg-[#C75B3A]/10 px-2 py-0.5 text-xs font-medium text-[#C75B3A]">
                          当前
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Password input for selected profile（已选档案的密码输入） */}
              {selectedUser && selectedProfile?.profileId !== activeProfileId && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-stone-500">密码</Label>
                    <Input
                      type="password"
                      placeholder="请输入密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSwitchLogin()}
                    />
                  </div>
                  <Button
                    className="w-full rounded-xl bg-[#C75B3A] hover:bg-[#B24D2F] text-white"
                    onClick={handleSwitchLogin}
                    disabled={loading || !password}
                  >
                    {loading ? '打开中...' : '打开档案'}
                  </Button>
                </div>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <Button
                variant="outline"
                className="w-full rounded-xl"
                onClick={goToRegister}
                disabled={loading}
              >
                创建档案
              </Button>
              {isLoggedIn && activeProfileId && (
                <Button
                  variant="ghost"
                  className="w-full rounded-xl text-[#B91C1C] hover:bg-[#FEF2F2] hover:text-[#991B1B]"
                  onClick={handleLogout}
                  disabled={loading}
                >
                  {loading ? '退出中...' : '退出当前档案'}
                </Button>
              )}
            </div>
          )}

          {/* Login mode */}
          {mode === 'login' && (
            <div className="space-y-3">
              <DrawerTitle className="text-base font-semibold text-stone-800">
                打开本地档案
              </DrawerTitle>

              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500">档案标识</Label>
                <Input
                  type="text"
                  placeholder="请输入档案标识"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500">密码</Label>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <Button
                className="w-full rounded-xl bg-[#C75B3A] hover:bg-[#B24D2F] text-white"
                onClick={handleLogin}
                disabled={loading || !username || !password}
              >
                {loading ? '打开中...' : '打开档案'}
              </Button>

              <button
                className="w-full text-center text-xs text-stone-400 hover:text-stone-600"
                onClick={goToRegister}
              >
                没有本地档案？去创建
              </button>
            </div>
          )}

          {/* Register mode */}
          {mode === 'register' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg p-1 hover:bg-stone-100"
                  onClick={goBack}
                >
                  <ChevronLeft className="h-5 w-5 text-stone-600" />
                </button>
                <DrawerTitle className="text-base font-semibold text-stone-800">
                  创建本地档案
                </DrawerTitle>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500">档案标识</Label>
                <Input
                  type="text"
                  placeholder="请输入档案标识"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500">密码（至少6位）</Label>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500">确认密码</Label>
                <Input
                  type="password"
                  placeholder="请再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                />
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <Button
                className="w-full rounded-xl bg-[#C75B3A] hover:bg-[#B24D2F] text-white"
                onClick={handleRegister}
                disabled={loading || !username || !regPassword || !confirmPassword}
              >
                {loading ? '创建中...' : '创建档案'}
              </Button>

              <button
                className="w-full text-center text-xs text-stone-400 hover:text-stone-600"
                onClick={goToLogin}
              >
                已有本地档案？去打开
              </button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
