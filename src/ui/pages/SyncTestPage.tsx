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
import {
  useSyncStore,
} from '@/ui/stores/sync-store';
import type { Conflict } from '@/environment/interfaces/sync.port';
import { resolveSyncServerUrl } from '@/config/port-env';

interface LogEntry {
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  message: string;
  timestamp: number;
}

export function SyncTestPage() {
  const defaultSyncServerUrl = resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsRef = useRef<HTMLDivElement>(null);
  const [serverUrl, setServerUrl] = useState(defaultSyncServerUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const {
    status,
    isLoggedIn,
    currentUser,
    conflicts,
    login,
    logout,
    connect,
    disconnect,
    syncEvents,
    syncConfig,
    getConflicts,
    resolveConflict,
  } = useSyncStore();

  // 自动滚动日志
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // 初始加载冲突列表
  useEffect(() => {
    if (status.state === 'connected') {
      getConflicts();
    }
  }, [status.state, getConflicts]);

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
      // 连接成功后获取冲突列表
      const conflictList = await getConflicts();
      if (conflictList.length > 0) {
        addLog('WARN', `检测到 ${conflictList.length} 个冲突`);
      }
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
    try {
      const result = await syncEvents();
      if (result.success) {
        addLog('SUCCESS', `事件同步完成: 上传 ${result.uploaded}, 下载 ${result.downloaded}`);
      } else {
        addLog('ERROR', `事件同步失败: ${result.errors.join(', ')}`);
      }
    } catch (error) {
      addLog('ERROR', `事件同步失败: ${(error as Error).message}`);
    }
  };

  // 处理同步配置
  const handleSyncConfig = async () => {
    addLog('INFO', '正在同步配置...');
    try {
      const result = await syncConfig();
      if (result.success) {
        addLog('SUCCESS', `配置同步完成: 上传 ${result.uploaded}, 下载 ${result.downloaded}`);
      } else {
        addLog('ERROR', `配置同步失败: ${result.errors.join(', ')}`);
      }
    } catch (error) {
      addLog('ERROR', `配置同步失败: ${(error as Error).message}`);
    }
  };

  // 处理登出
  const handleLogout = () => {
    logout();
    addLog('INFO', '已退出登录');
  };

  // 处理解决冲突
  const handleResolveConflict = async (
    conflict: Conflict,
    resolution: 'local' | 'remote' | 'merge'
  ) => {
    try {
      addLog('INFO', `正在解决冲突 ${conflict.docId}...`);
      await resolveConflict(conflict.docId, resolution);
      addLog('SUCCESS', `冲突 ${conflict.docId} 已解决`);
      // 刷新冲突列表
      await getConflicts();
    } catch (error) {
      addLog('ERROR', `解决冲突失败: ${(error as Error).message}`);
    }
  };

  // 格式化时间显示
  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
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
              placeholder={defaultSyncServerUrl}
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

      {/* 冲突列表 */}
      {status.state === 'connected' && conflicts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>冲突列表 ({conflicts.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {conflicts.map((conflict) => (
              <div
                key={conflict.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-sm">{conflict.docId}</div>
                  <Badge variant={conflict.resolved ? 'default' : 'destructive'}>
                    {conflict.resolved ? '已解决' : '未解决'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded">
                    <div className="font-medium mb-1">本地版本</div>
                    <div className="text-muted-foreground">
                      {conflict.local.timestamp > 0
                        ? formatTimestamp(conflict.local.timestamp)
                        : '未知时间'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      设备: {conflict.local.deviceId.slice(0, 8)}...
                    </div>
                    <pre className="mt-2 text-xs overflow-auto max-h-24">
                      {JSON.stringify(conflict.local.value, null, 2)}
                    </pre>
                  </div>

                  <div className="bg-green-50 dark:bg-green-950 p-3 rounded">
                    <div className="font-medium mb-1">远端版本</div>
                    <div className="text-muted-foreground">
                      {conflict.remote.timestamp > 0
                        ? formatTimestamp(conflict.remote.timestamp)
                        : '未知时间'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      设备: {conflict.remote.deviceId.slice(0, 8)}...
                    </div>
                    <pre className="mt-2 text-xs overflow-auto max-h-24">
                      {JSON.stringify(conflict.remote.value, null, 2)}
                    </pre>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleResolveConflict(conflict, 'local')}
                  >
                    保留本地
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleResolveConflict(conflict, 'remote')}
                  >
                    保留远端
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleResolveConflict(conflict, 'merge')}
                  >
                    手动合并
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 导入导出 */}
      {status.state === 'connected' && (
        <Card>
          <CardHeader>
            <CardTitle>导入导出</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 items-center">
              <Button
                variant="outline"
                onClick={() => {
                  addLog('INFO', '正在从本地导入...');
                  // TODO: 实现导入功能
                  addLog('SUCCESS', '导入功能待实现');
                }}
              >
                从本地导入
              </Button>
              <select
                className="border rounded px-2 py-1 text-sm"
                defaultValue="merge"
              >
                <option value="merge">合并</option>
                <option value="skip">跳过</option>
                <option value="overwrite">覆盖</option>
              </select>
            </div>

            <div className="flex gap-4">
              <Button
                variant="outline"
                onClick={() => {
                  addLog('INFO', '正在导出到文件...');
                  // TODO: 实现导出功能
                  addLog('SUCCESS', '导出功能待实现');
                }}
              >
                导出到文件
              </Button>
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
