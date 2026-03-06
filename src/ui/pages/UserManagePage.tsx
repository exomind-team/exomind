/**
 * 本地档案管理页面
 *
 * 用于本地档案创建、打开和管理
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

  // 处理本地档案创建
  const handleRegister = async () => {
    if (!newUsername || !newPassword) {
      setMessage({ type: 'error', text: '档案标识和密码不能为空' });
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

      setMessage({ type: 'success', text: `本地档案 ${newUsername} 创建成功` });
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage({ type: 'error', text: `创建档案失败: ${(error as Error).message}` });
    } finally {
      setIsLoading(false);
    }
  };

  // 快速打开本地档案
  const handleQuickLogin = async (username: string, password: string) => {
    if (!password) {
      setMessage({ type: 'error', text: '请输入密码' });
      return;
    }

    setIsLoading(true);
    try {
      await login(username, password);
      setMessage({ type: 'success', text: `本地档案 ${username} 已打开` });
      setLoginUsername('');
      setLoginPassword('');
      setShowLoginForm(false);
    } catch (error) {
      setMessage({ type: 'error', text: `打开档案失败: ${(error as Error).message}` });
    } finally {
      setIsLoading(false);
    }
  };

  // 处理登出
  const handleLogout = () => {
    logout();
    setMessage({ type: 'success', text: '已退出当前档案' });
  };

  return (
    <div className={embedded ? 'space-y-4' : 'container mx-auto p-6 space-y-6'}>
      {!embedded && (
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">档案与同步身份</h1>
          <p className="text-sm text-muted-foreground">
            远端同步身份请前往同步设置绑定；本页只管理本地档案。
          </p>
        </div>
      )}

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

      {/* 当前本地档案状态 */}
      <Card>
        <CardHeader>
          <CardTitle>当前本地档案</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoggedIn ? (
            <div className="flex items-center gap-4">
              <Badge variant="default" className="text-lg px-4 py-2">
                {currentUser}
              </Badge>
              <Button variant="outline" onClick={handleLogout}>
                退出当前档案
              </Button>
            </div>
          ) : (
            <div className="text-muted-foreground">未打开档案</div>
          )}
        </CardContent>
      </Card>

      {/* 本地档案创建 */}
      <Card>
        <CardHeader>
          <CardTitle>创建本地档案</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="newUsername">档案标识</Label>
            <Input
              id="newUsername"
              placeholder="请输入档案标识"
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
            {isLoading ? '创建中...' : '创建档案'}
          </Button>
        </CardContent>
      </Card>

      {/* 本地档案列表 */}
      <Card>
        <CardHeader>
          <CardTitle>本地档案列表</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="text-muted-foreground">暂无本地档案</div>
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
                      {user.lastLogin && ` | 最后打开: ${new Date(user.lastLogin).toLocaleString()}`}
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
                          打开档案
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
          <p>1. 先创建一个本地档案（档案标识和密码）</p>
          <p>2. 使用档案标识和密码打开本地档案</p>
          <p>3. 不绑定服务器也能本地运行和记录</p>
          <p>4. 只有绑定远端同步身份后，才会启用多人联邦或云同步</p>
        </CardContent>
      </Card>
    </div>
  );
}
