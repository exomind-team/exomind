/**
 * 用户管理页面
 *
 * 用于用户注册、登录和用户管理
 * 使用 PBKDF2 哈希密码存储
 *
 * TODO: 当前使用明文密码哈希，后续需要迁移到真正的 PBKDF2 加密模块
 *       参考 SPEC-302 密码哈希模块设计，使用 crypto-adapter.ts
 *
 * @see docs/specs/SPEC-301-多设备数据同步.md
 * @see docs/specs/SPEC-302-密码哈希模块.md
 */

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { listLocalProfiles } from '@/lib/profile/profile-storage';
import { useSyncStore } from '@/ui/stores/sync-store';

interface UserInfo {
  profileId: string;
  loginName: string;
  displayName: string;
  createdAt: string;
  lastLogin?: string;
}

interface UserManagePageProps {
  embedded?: boolean;
}

export function UserManagePage({ embedded = false }: UserManagePageProps) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(false);

  const {
    isLoggedIn,
    currentUser,
    login,
    logout,
    register,
  } = useSyncStore();

  const reloadUsers = () => {
    setUsers(
      listLocalProfiles().map((profile) => ({
        profileId: profile.profileId,
        loginName: profile.slug,
        displayName: profile.displayName,
        createdAt: profile.createdAt,
      }))
    );
  };

  // 从本地档案索引加载列表（local-first，本地优先）
  useEffect(() => {
    reloadUsers();
  }, []);

  // 显示消息并自动清除
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // 处理用户注册
  const handleRegister = async () => {
    if (!newUsername || !newPassword) {
      setMessage({ type: 'error', text: '用户名和密码不能为空' });
      return;
    }

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: '密码长度至少6位' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的密码不一致' });
      return;
    }

    setIsLoading(true);
    try {
      await register(newUsername, newPassword);

      reloadUsers();

      setMessage({ type: 'success', text: `用户 ${newUsername} 注册成功` });
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage({ type: 'error', text: `注册失败: ${(error as Error).message}` });
    } finally {
      setIsLoading(false);
    }
  };

  // 快速登录
  const handleQuickLogin = async (username: string, password: string) => {
    if (!password) {
      setMessage({ type: 'error', text: '请输入密码' });
      return;
    }

    setIsLoading(true);
    try {
      await login(username, password);
      setMessage({ type: 'success', text: `用户 ${username} 登录成功` });
      setLoginUsername('');
      setLoginPassword('');
      setShowLoginForm(false);
    } catch (error) {
      setMessage({ type: 'error', text: `登录失败: ${(error as Error).message}` });
    } finally {
      setIsLoading(false);
    }
  };

  // 处理登出
  const handleLogout = () => {
    logout();
    setMessage({ type: 'success', text: '已退出登录' });
  };

  return (
    <div className={embedded ? 'space-y-4' : 'container mx-auto p-6 space-y-6'}>
      {!embedded && <h1 className="text-2xl font-bold">用户管理</h1>}

      {/* 消息提示 */}
      {message && (
        <div
          className={`p-4 rounded-md ${
            message.type === 'success'
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 当前用户状态 */}
      <Card>
        <CardHeader>
          <CardTitle>当前用户</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoggedIn ? (
            <div className="flex items-center gap-4">
              <Badge variant="default" className="text-lg px-4 py-2">
                {currentUser}
              </Badge>
              <Button variant="outline" onClick={handleLogout}>
                退出登录
              </Button>
            </div>
          ) : (
            <div className="text-muted-foreground">未登录</div>
          )}
        </CardContent>
      </Card>

      {/* 用户注册 */}
      <Card>
        <CardHeader>
          <CardTitle>注册新用户</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="newUsername">用户名</Label>
            <Input
              id="newUsername"
              placeholder="请输入用户名"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="newPassword">密码</Label>
            <Input
              id="newPassword"
              type="password"
              placeholder="请输入密码（至少6位）"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">确认密码</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="请再次输入密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <Button onClick={handleRegister} disabled={isLoading}>
            {isLoading ? '注册中...' : '注册'}
          </Button>
        </CardContent>
      </Card>

      {/* 用户列表 */}
      <Card>
        <CardHeader>
          <CardTitle>已注册用户</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="text-muted-foreground">暂无已注册用户</div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.profileId}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div>
                    <div className="font-medium">{user.displayName}</div>
                    <div className="text-sm text-muted-foreground">
                      档案标识: {user.loginName}
                      {' | '}注册时间: {new Date(user.createdAt).toLocaleString()}
                      {user.lastLogin && ` | 最后登录: ${new Date(user.lastLogin).toLocaleString()}`}
                    </div>
                  </div>
                  {showLoginForm && loginUsername === user.loginName && (
                    <div className="flex items-center gap-2 ml-4" style={{ width: '140px' }}>
                      <Input
                        type="password"
                        placeholder="输入密码"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                  )}
                  {!isLoggedIn && (
                    <div className="flex gap-2">
                      {!showLoginForm ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setLoginUsername(user.loginName);
                            setShowLoginForm(true);
                          }}
                        >
                          登录
                        </Button>
                      ) : loginUsername === user.loginName ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowLoginForm(false);
                              setLoginUsername('');
                              setLoginPassword('');
                            }}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleQuickLogin(user.loginName, loginPassword)}
                            disabled={isLoading || !loginPassword}
                          >
                            确定
                          </Button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 帮助信息 */}
      <Card>
        <CardHeader>
          <CardTitle>使用说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. 先注册一个新用户（用户名和密码）</p>
          <p>2. 使用注册的用户名和密码登录</p>
          <p>3. 在设置页配置同步服务器地址（局域网可用）</p>
          <p>4. 同一用户名可以在多个设备上登录，数据会自动同步</p>
        </CardContent>
      </Card>
    </div>
  );
}
