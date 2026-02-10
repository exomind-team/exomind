/**
 * 同步测试页面
 *
 * 用于测试多设备同步功能
 */

import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useSyncStore } from '@/ui/stores/sync-store';

interface LogEntry {
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  message: string;
  timestamp: number;
}

export function SyncTestPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsRef = useRef<HTMLDivElement>(null);
  const [serverUrl, setServerUrl] = useState('http://localhost:6984');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const {
    status,
    isLoggedIn,
    currentUser,
    login,
    logout,
    connect,
    disconnect,
    syncEvents,
    syncConfig,
  } = useSyncStore();

  // 自动滚动日志
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // 添加日志
  const addLog = (level: LogEntry['level'], message: string) => {
    setLogs((prev) => [
      ...prev,
      {
        level,
        message,
        timestamp: Date.now(),
      },
    ]);
  };

  // 处理登录
  const handleLogin = async () => {
    try {
      addLog('INFO', `正在登录用户 ${username}...`);
      await login(username, password);
      addLog('SUCCESS', `用户 ${username} 登录成功`);
    } catch (error) {
      addLog('ERROR', `登录失败: ${(error as Error).message}`);
    }
  };

  // 处理连接
  const handleConnect = async () => {
    try {
      addLog('INFO', `正在连接到 ${serverUrl}...`);
      await connect(serverUrl);
      addLog('SUCCESS', '连接成功');
    } catch (error) {
      addLog('ERROR', `连接失败: ${(error as Error).message}`);
    }
  };

  // 处理断开
  const handleDisconnect = async () => {
    await disconnect();
    addLog('INFO', '已断开连接');
  };

  // 处理同步事件
  const handleSyncEvents = async () => {
    addLog('INFO', '正在同步事件...');
    await syncEvents();
    addLog('SUCCESS', '事件同步完成');
  };

  // 处理同步配置
  const handleSyncConfig = async () => {
    addLog('INFO', '正在同步配置...');
    await syncConfig();
    addLog('SUCCESS', '配置同步完成');
  };

  // 处理登出
  const handleLogout = () => {
    logout();
    addLog('INFO', '已退出登录');
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">同步测试</h1>

      {/* 连接设置 */}
      <Card>
        <CardHeader>
          <CardTitle>连接设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="serverUrl">服务器地址</Label>
            <Input
              id="serverUrl"
              placeholder="http://localhost:6984"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              placeholder="请输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoggedIn}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoggedIn}
            />
          </div>

          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <>
                <Badge variant="default">已登录: {currentUser}</Badge>
                <Button variant="outline" onClick={handleLogout}>
                  退出登录
                </Button>
              </>
            ) : (
              <Button onClick={handleLogin}>登录</Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={
                status.state === 'connected' ? 'default' : 'destructive'
              }
            >
              {status.state === 'connected'
                ? '已连接'
                : status.state === 'connecting'
                  ? '连接中...'
                  : '未连接'}
            </Badge>

            {status.state === 'connected' && (
              <Button variant="outline" onClick={handleDisconnect}>
                断开
              </Button>
            )}

            {isLoggedIn && status.state !== 'connected' && (
              <Button onClick={handleConnect}>连接服务器</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 同步控制 */}
      {status.state === 'connected' && (
        <Card>
          <CardHeader>
            <CardTitle>同步控制</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Button onClick={handleSyncEvents}>同步事件</Button>
              <Button onClick={handleSyncConfig}>同步配置</Button>
            </div>

            <div className="text-sm text-muted-foreground">
              {status.lastSync
                ? `上次同步: ${new Date(status.lastSync).toLocaleString()}`
                : '从未同步'}
            </div>

            <div className="text-sm">
              同步模式: {status.syncMode === 'realtime' ? '实时' : '定时'}
              {status.syncMode === 'polling' &&
                ` (${status.pollInterval} 分钟)`}
            </div>

            <div className="text-sm">
              待同步变更: {status.pendingChanges}
            </div>

            <div className="text-sm">
              冲突数量: {status.conflictCount}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 测试日志 */}
      <Card>
        <CardHeader>
          <CardTitle>测试日志</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={logsRef}
            className="h-64 overflow-y-auto font-mono text-sm bg-muted rounded p-4 space-y-1"
          >
            {logs.length === 0 ? (
              <div className="text-muted-foreground">暂无日志</div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={
                    log.level === 'INFO'
                      ? 'text-blue-600'
                      : log.level === 'SUCCESS'
                        ? 'text-green-600'
                        : log.level === 'WARN'
                          ? 'text-yellow-600'
                          : 'text-red-600'
                  }
                >
                  [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                </div>
              ))
            )}
          </div>

          {logs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setLogs([])}
            >
              清空日志
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
