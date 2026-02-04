import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Copy,
  Check,
  Info,
  Shield,
  Network,
  Smartphone,
  Monitor,
  Server,
  Download,
  FileText
} from 'lucide-react';
import { useChatStore } from '../../lib/stores/chat-store';
import { exportMessagesToMarkdown } from '../../hooks/useMarkdownExport';

interface SettingsPageProps {
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function SettingsPage({ connectionStatus, onConnect, onDisconnect }: SettingsPageProps) {
  const { messages } = useChatStore();
  const [localIP, setLocalIP] = useState<string>('获取中...');
  const [remoteIP, setRemoteIP] = useState('');
  const [ipCopied, setIpCopied] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<Array<{id: string; name: string; ip: string; type: string}>>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 模拟获取本机 IP
  useEffect(() => {
    const fetchIP = async () => {
      try {
        // 实际实现中，这里应该调用 Rust 后端命令
        // const ip = await invoke<string>('get_local_ip');
        // setLocalIP(`${ip}:1949`);

        // 模拟获取 IP
        setTimeout(() => {
          setLocalIP('192.168.1.100:1949');
        }, 1000);
      } catch {
        setLocalIP('无法获取');
      }
    };
    fetchIP();
  }, []);

  // 模拟获取已配对设备
  useEffect(() => {
    // 实际实现中，这里应该从 store 读取已配对设备
    setPairedDevices([
      { id: '1', name: '我的手机', ip: '192.168.1.101:1949', type: 'phone' },
      { id: '2', name: '办公室电脑', ip: '192.168.1.102:1949', type: 'desktop' },
    ]);
  }, []);

  const copyIP = async () => {
    if (localIP !== '获取中...' && localIP !== '无法获取') {
      try {
        await navigator.clipboard.writeText(localIP);
        setIpCopied(true);
        setTimeout(() => setIpCopied(false), 2000);
      } catch {
        setError('复制失败');
      }
    }
  };

  const handleConnect = async () => {
    if (!remoteIP.trim()) return;

    setIsConnecting(true);
    setError(null);

    try {
      // 实际实现中，这里应该调用 Rust 后端命令
      // await invoke('connect_to_peer', { ip: remoteIP.trim() });

      // 模拟连接
      await new Promise(resolve => setTimeout(resolve, 2000));

      onConnect?.();
    } catch {
      setError('连接失败，请检查 IP 地址');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    // 实际实现中，这里应该断开连接
    onDisconnect?.();
  };

  const handleRefresh = () => {
    // 模拟刷新
    setPairedDevices([]);
    setTimeout(() => {
      setPairedDevices([
        { id: '1', name: '我的手机', ip: '192.168.1.101:1949', type: 'phone' },
        { id: '2', name: '办公室电脑', ip: '192.168.1.102:1949', type: 'desktop' },
      ]);
    }, 500);
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'phone':
        return <Smartphone size={20} />;
      case 'desktop':
        return <Monitor size={20} />;
      default:
        return <Server size={20} />;
    }
  };

  // 导出消息到 Markdown 文件
  const handleExportMessages = async () => {
    if (messages.length === 0) {
      setError('没有消息可导出');
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportSuccess(false);

    try {
      // 生成带时间戳的文件名
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `exomind-messages-${timestamp}.md`;
      const title = `ExoMind 消息导出 (${new Date().toLocaleDateString('zh-CN')})`;

      // 将消息转换为 JSON 字符串
      const messagesJson = JSON.stringify(messages);

      // 调用 Rust 命令导出
      await exportMessagesToMarkdown(filename, title, messagesJson);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (err) {
      setError('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 标题 */}
        <h1 className="text-2xl font-bold text-gray-900">设置</h1>

        {/* 关于部分 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <Info size={20} className="text-blue-600" />
            关于 ExoMind
          </h2>
          <p className="text-gray-600">
            ExoMind 是一个本地优先的多设备消息同步应用，帮助您在不同设备间安全地同步和分享信息。
          </p>
          <p className="text-gray-500 text-sm mt-2">版本 0.1.0</p>
        </section>

        {/* 网络状态 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <Network size={20} className="text-blue-600" />
            网络状态
          </h2>
          <div className="space-y-4">
            {/* 本机 IP */}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">本机地址</span>
              <div className="flex items-center gap-2">
                <code className="bg-gray-100 px-3 py-1 rounded text-sm font-mono">
                  {localIP}
                </code>
                <button
                  onClick={copyIP}
                  className="p-2 hover:bg-gray-100 rounded transition-colors"
                  title="复制地址"
                  disabled={localIP === '获取中...' || localIP === '无法获取'}
                >
                  {ipCopied ? (
                    <Check size={16} className="text-green-600" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            </div>

            {/* 连接状态 */}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">连接状态</span>
              <span
                className={`px-3 py-1 rounded-full text-sm ${
                  connectionStatus === 'connected'
                    ? 'bg-green-100 text-green-700'
                    : connectionStatus === 'connecting'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {connectionStatus === 'connected'
                  ? '已连接'
                  : connectionStatus === 'connecting'
                  ? '连接中...'
                  : '离线'}
              </span>
            </div>
          </div>
        </section>

        {/* 已连接设备 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Monitor size={20} className="text-blue-600" />
              已配对设备 ({pairedDevices.length})
            </h2>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors"
            >
              <RefreshCw size={16} />
              <span className="text-sm">刷新</span>
            </button>
          </div>

          {pairedDevices.length === 0 ? (
            <p className="text-gray-500 text-center py-4">
              暂未配对任何设备
            </p>
          ) : (
            <ul className="space-y-2">
              {pairedDevices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500">
                      {getDeviceIcon(device.type)}
                    </span>
                    <div>
                      <p className="font-medium text-gray-900">{device.name}</p>
                      <p className="text-sm text-gray-500 font-mono">{device.ip}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-green-600 text-sm">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    在线
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 添加连接 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <Network size={20} className="text-blue-600" />
            添加连接
          </h2>
          <p className="text-gray-600 text-sm mb-4">
            输入另一台设备的地址进行连接（格式: IP地址:端口）
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={remoteIP}
              onChange={(e) => setRemoteIP(e.target.value)}
              placeholder="例如: 192.168.1.100:1949"
              disabled={connectionStatus === 'connected'}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 font-mono"
            />
            {connectionStatus === 'connected' ? (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                断开
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={isConnecting || !remoteIP.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    连接中...
                  </>
                ) : (
                  '连接'
                )}
              </button>
            )}
          </div>
        </section>

        {/* 消息导出 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <FileText size={20} className="text-blue-600" />
            消息导出
          </h2>
          <p className="text-gray-600 text-sm mb-4">
            将所有消息导出为 Markdown 格式，方便备份和查看
          </p>

          {exportSuccess && (
            <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-lg text-sm flex items-center gap-2">
              <Check size={16} />
              消息已成功导出到 Markdown 文件
            </div>
          )}

          <button
            onClick={handleExportMessages}
            disabled={isExporting || messages.length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isExporting ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download size={16} />
                导出消息 ({messages.length} 条)
              </>
            )}
          </button>
        </section>

        {/* 安全说明 */}
        <section className="bg-blue-50 rounded-lg p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
            <Shield size={20} className="text-blue-600" />
            安全提示
          </h2>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>- 所有消息使用端到端加密</li>
            <li>- 数据仅存储在您的本地设备</li>
            <li>- 请确保连接可信的设备</li>
            <li>- 建议在同一局域网内使用</li>
          </ul>
        </section>

        {/* 错误提示 */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
