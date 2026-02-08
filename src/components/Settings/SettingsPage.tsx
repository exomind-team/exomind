import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  FileText,
  QrCode,
  Users,
  Plus,
  Trash2,
  Save
} from 'lucide-react';
import { useChatStore } from '../../lib/stores/chat-store';
import { exportMessagesToMarkdown } from '../../hooks/useMarkdownExport';
import { usePairing, PairedDevice as PairedDeviceType } from '../../hooks/usePairing';
import { PairingModal } from '../Pairing';
import './SettingsPage.css';

interface SettingsPageProps {
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function SettingsPage({ connectionStatus, onConnect, onDisconnect }: SettingsPageProps) {
  const { messages } = useChatStore();
  const [localIP, setLocalIP] = useState<string>('获取中...');
  const [currentPort, setCurrentPort] = useState<number>(0);
  const [isRefreshingIP, setIsRefreshingIP] = useState(false);
  const [isRefreshingPort, setIsRefreshingPort] = useState(false);
  const [remoteIP, setRemoteIP] = useState('');
  const [ipCopied, setIpCopied] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDeviceType[]>([]);

  // 配对相关状态
  const [pairingModal, setPairingModal] = useState<{mode: 'generate' | 'input', code?: string} | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);

  const {
    generatePairingCode,
    confirmPairing,
    getPairedDevices: fetchPairedDevices,
    removePairedDevice,
  } = usePairing();

  // 检测是否为移动端
  const checkIsMobile = useCallback(() => {
    setIsMobile(window.innerWidth < 640);
  }, []);

  useEffect(() => {
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, [checkIsMobile]);

  // 获取本机 IP
  const fetchIP = useCallback(async (refreshPort: boolean = false, port?: number) => {
    try {
      let ip: string;
      if (refreshPort) {
        // 刷新端口 - 获取新随机端口
        ip = await invoke<string>('get_local_ip_with_random_port');
      } else if (port && port > 0) {
        // 保留端口 - 使用当前端口
        ip = await invoke<string>('get_local_ip_with_current_port', { port });
      } else {
        // 首次获取 - 随机端口
        ip = await invoke<string>('get_local_ip_with_random_port');
      }
      setLocalIP(ip);
      // 提取端口号
      const portMatch = ip.match(/:(\d+)$/);
      if (portMatch) {
        setCurrentPort(parseInt(portMatch[1], 10));
      }
    } catch (e) {
      console.error('获取 IP 失败:', e);
      setLocalIP('无法获取');
    }
  }, []);

  // 刷新本机地址（保留端口）
  const refreshIP = async () => {
    setIsRefreshingIP(true);
    await fetchIP(false, currentPort || undefined);
    setTimeout(() => setIsRefreshingIP(false), 500);
  };

  // 刷新端口（获取新端口）
  const refreshPort = async () => {
    setIsRefreshingPort(true);
    await fetchIP(true);
    setTimeout(() => setIsRefreshingPort(false), 500);
  };

  // 初始化获取 IP（获取随机端口）
  useEffect(() => {
    fetchIP(true);
  }, [fetchIP]);

  // 获取已配对设备
  const loadPairedDevices = useCallback(async () => {
    try {
      const devices = await fetchPairedDevices();
      setPairedDevices(devices);
    } catch (err) {
      console.error('加载已配对设备失败:', err);
    }
  }, [fetchPairedDevices]);

  useEffect(() => {
    loadPairedDevices();
  }, [loadPairedDevices]);

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
      // 实际实现中调用 Rust 后端命令
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

  // 生成配对码
  const handleGeneratePairingCode = async () => {
    setIsPairing(true);
    setPairingError(null);

    try {
      // 模拟生成配对码（实际应调用 Rust 命令）
      const code = await generatePairingCode(
        '本机设备',
        localIP || '192.168.1.100:1949',
        'mock-public-key'
      );

      if (code) {
        setGeneratedCode(code);
        setPairingModal({ mode: 'generate', code });
      } else {
        setPairingError('生成配对码失败');
      }
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : '生成配对码失败');
    } finally {
      setIsPairing(false);
    }
  };

  // 确认配对
  const handleConfirmPairing = async (code: string) => {
    setIsPairing(true);
    setPairingError(null);

    try {
      const success = await confirmPairing(code, true);

      if (success) {
        setPairingModal(null);
        await loadPairedDevices();
      } else {
        setPairingError('配对失败，请检查配对码是否正确');
      }
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : '配对失败');
    } finally {
      setIsPairing(false);
    }
  };

  // 移除已配对设备
  const handleRemoveDevice = async (deviceId: string) => {
    try {
      await removePairedDevice(deviceId);
      await loadPairedDevices();
    } catch (err) {
      setError('移除设备失败');
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
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `exomind-messages-${timestamp}.md`;
      const title = `ExoMind 消息导出 (${new Date().toLocaleDateString('zh-CN')})`;
      const messagesJson = JSON.stringify(messages);

      await exportMessagesToMarkdown(filename, title, messagesJson);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (err) {
      setError('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExporting(false);
    }
  };

  // 保存数据到 JSON 文件（参考 MVP 格式）
  const handleSaveData = async () => {
    if (messages.length === 0 && pairedDevices.length === 0) {
      setError('没有数据可保存');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      // 构建 MVP 格式的数据
      const data = {
        events: messages.map(msg => ({
          id: msg.id,
          timestamp: msg.timestamp,
          content: msg.content,
          tags: msg.direction === 'outgoing' ? [] : ['received'],
          meta: {
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            status: msg.status,
            direction: msg.direction
          }
        })),
        timeBlocks: [], // Web 端暂无时间块功能，保留空数组
        savedAt: new Date().toISOString(),
        version: '1.0'
      };

      // 生成文件名
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `exomind-data-${timestamp}.json`;

      // 创建 Blob 并下载
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError('保存失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中...';
      default: return '离线';
    }
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

  return (
    <div className={`settings-page ${isMobile ? 'mobile' : 'desktop'}`}>
      {/* 配对弹窗 */}
      {pairingModal && (
        <PairingModal
          mode={pairingModal.mode}
          pairingCode={generatedCode}
          onClose={() => setPairingModal(null)}
          onPair={handleConfirmPairing}
        />
      )}

      <div className={`settings-container ${isMobile ? 'is-mobile' : ''}`}>
        <div className={`settings-content ${isMobile ? 'is-mobile' : ''}`}>
          {/* 标题 */}
          <h1 className={`settings-title ${isMobile ? 'is-mobile' : ''}`}>设置</h1>

          {/* 关于部分 */}
          <section className={`settings-section ${isMobile ? 'is-mobile' : ''}`}>
            <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
              <Info size={20} className="section-icon" />
              关于 ExoMind
            </h2>
            <p className="section-description">
              ExoMind 是一个本地优先的多设备消息同步应用，帮助您在不同设备间安全地同步和分享信息。
            </p>
            <p className="version-info">版本 0.1.0</p>
          </section>

          {/* 网络状态 */}
          <section className={`settings-section ${isMobile ? 'is-mobile' : ''}`}>
            <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
              <Network size={20} className="section-icon" />
              网络状态
            </h2>
            <div className="space-y-4">
              {/* 本机 IP */}
              <div className={`ip-row ${isMobile ? 'is-mobile' : ''}`}>
                <span className="ip-label">本机地址</span>
                <div className="ip-value">
                  <code className="ip-code">{localIP}</code>
                  <button
                    onClick={refreshIP}
                    className={`btn btn-refresh ${isMobile ? 'is-mobile' : ''}`}
                    title="刷新地址"
                    disabled={isRefreshingIP}
                    aria-label="刷新本机地址"
                    style={{ animation: isRefreshingIP ? 'spin 1s linear infinite' : 'none' }}
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    onClick={refreshPort}
                    className={`btn btn-refresh ${isMobile ? 'is-mobile' : ''}`}
                    title="刷新端口"
                    disabled={isRefreshingPort || localIP === '无法获取'}
                    aria-label="刷新端口"
                    style={{ animation: isRefreshingPort ? 'spin 1s linear infinite' : 'none' }}
                  >
                    <Network size={16} />
                  </button>
                  <button
                    onClick={copyIP}
                    className={`btn btn-refresh ${isMobile ? 'is-mobile' : ''}`}
                    title="复制地址"
                    disabled={localIP === '获取中...' || localIP === '无法获取'}
                    aria-label="复制本机地址"
                  >
                    {ipCopied ? (
                      <Check size={16} />
                    ) : (
                      <Copy size={16} />
                    )}
                  </button>
                </div>
              </div>

              {/* 连接状态 */}
              <div className={`ip-row ${isMobile ? 'is-mobile' : ''}`}>
                <span className="ip-label">连接状态</span>
                <span className={`status-badge ${connectionStatus}`}>
                  <span className="status-dot"></span>
                  {getStatusText()}
                </span>
              </div>
            </div>
          </section>

          {/* 已配对设备 */}
          <section className={`settings-section ${isMobile ? 'is-mobile' : ''}`}>
            <div className={`ip-row ${isMobile ? 'is-mobile' : ''}`}>
              <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
                <Users size={20} className="section-icon" />
                已配对设备 ({pairedDevices.length})
              </h2>
              <button
                onClick={loadPairedDevices}
                className={`btn-refresh ${isMobile ? 'is-mobile' : ''}`}
              >
                <RefreshCw size={16} />
                <span>刷新</span>
              </button>
            </div>

            {pairedDevices.length === 0 ? (
              <p className={`empty-state ${isMobile ? 'is-mobile' : ''}`}>
                暂未配对任何设备
              </p>
            ) : (
              <ul className="device-list">
                {pairedDevices.map((device) => (
                  <li
                    key={device.id}
                    className={`device-item ${isMobile ? 'is-mobile' : ''}`}
                  >
                    <div className="device-info">
                      <span className="device-icon">
                        {getDeviceIcon(device.name.toLowerCase().includes('手机') ? 'phone' : 'desktop')}
                      </span>
                      <div>
                        <p className="device-name">{device.name}</p>
                        <p className="device-ip">{device.ip}</p>
                      </div>
                    </div>
                    <div className="device-actions">
                      <span className="device-online">
                        <span className="online-dot"></span>
                        在线
                      </span>
                      <button
                        onClick={() => handleRemoveDevice(device.id)}
                        className="remove-btn"
                        aria-label={`移除 ${device.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 设备配对 */}
          <section className={`settings-section ${isMobile ? 'is-mobile' : ''}`}>
            <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
              <QrCode size={20} className="section-icon" />
              设备配对
            </h2>
            <p className="section-description">
              通过配对码将其他设备添加到您的网络
            </p>

            {pairingError && (
              <div className={`alert alert-error ${isMobile ? 'is-mobile' : ''}`}>
                {pairingError}
              </div>
            )}

            <div className={`input-group ${isMobile ? 'is-mobile' : ''}`}>
              <button
                onClick={handleGeneratePairingCode}
                disabled={isPairing}
                className={`btn btn-primary ${isMobile ? 'is-mobile' : ''}`}
              >
                {isPairing ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <QrCode size={16} />
                    生成配对码
                  </>
                )}
              </button>
              <button
                onClick={() => setPairingModal({ mode: 'input' })}
                className={`btn btn-secondary ${isMobile ? 'is-mobile' : ''}`}
              >
                <Plus size={16} />
                输入配对码
              </button>
            </div>
          </section>

          {/* 添加连接（IP 直连，保留兼容） */}
          <section className={`settings-section ${isMobile ? 'is-mobile' : ''}`}>
            <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
              <Network size={20} className="section-icon" />
              IP 直连
            </h2>
            <p className="section-description">
              直接输入 IP 地址进行连接（不经过配对流程）
            </p>

            {error && (
              <div className={`alert alert-error ${isMobile ? 'is-mobile' : ''}`}>
                {error}
              </div>
            )}

            <div className={`input-group ${isMobile ? 'is-mobile' : ''}`}>
              <input
                type="text"
                value={remoteIP}
                onChange={(e) => setRemoteIP(e.target.value)}
                placeholder="例如: 192.168.1.100:1949"
                disabled={connectionStatus === 'connected'}
                className={`input-field ${isMobile ? 'is-mobile' : ''}`}
                aria-label="远程设备地址"
              />
              {connectionStatus === 'connected' ? (
                <button
                  onClick={handleDisconnect}
                  className={`btn btn-danger ${isMobile ? 'is-mobile' : ''}`}
                >
                  断开
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={isConnecting || !remoteIP.trim()}
                  className={`btn btn-primary ${isMobile ? 'is-mobile' : ''}`}
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
          <section className={`export-section ${isMobile ? 'is-mobile' : ''}`}>
            <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
              <FileText size={20} className="section-icon" />
              消息导出
            </h2>
            <p className="section-description">
              将所有消息导出为 Markdown 格式，方便备份和查看
            </p>

            {exportSuccess && (
              <div className={`alert alert-success ${isMobile ? 'is-mobile' : ''}`}>
                <Check size={16} />
                消息已成功导出到 Markdown 文件
              </div>
            )}

            <button
              onClick={handleExportMessages}
              disabled={isExporting || messages.length === 0}
              className={`btn btn-success ${isMobile ? 'is-mobile' : ''}`}
            >
              {isExporting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download size={16} />
                  导出消息
                  {messages.length > 0 && (
                    <span className="export-stats">({messages.length} 条)</span>
                  )}
                </>
              )}
            </button>
          </section>

          {/* 数据备份 */}
          <section className={`export-section ${isMobile ? 'is-mobile' : ''}`}>
            <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
              <Save size={20} className="section-icon" />
              数据备份
            </h2>
            <p className="section-description">
              将所有数据保存为 JSON 文件（参考 MVP 格式），可用于迁移或备份
            </p>

            {saveSuccess && (
              <div className={`alert alert-success ${isMobile ? 'is-mobile' : ''}`}>
                <Check size={16} />
                数据已成功保存到 JSON 文件
              </div>
            )}

            <button
              onClick={handleSaveData}
              disabled={isSaving || (messages.length === 0 && pairedDevices.length === 0)}
              className={`btn btn-primary ${isMobile ? 'is-mobile' : ''}`}
            >
              {isSaving ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save size={16} />
                  保存数据
                  {(messages.length > 0 || pairedDevices.length > 0) && (
                    <span className="export-stats">
                      ({messages.length} 条消息{pairedDevices.length > 0 ? `, ${pairedDevices.length} 个设备` : ''})
                    </span>
                  )}
                </>
              )}
            </button>
          </section>

          {/* 安全说明 */}
          <section className={`security-tips ${isMobile ? 'is-mobile' : ''}`}>
            <h2 className={`section-title ${isMobile ? 'is-mobile' : ''}`}>
              <Shield size={20} className="section-icon" />
              安全提示
            </h2>
            <ul className="security-list">
              <li>所有消息使用端到端加密</li>
              <li>数据仅存储在您的本地设备</li>
              <li>请确保连接可信的设备</li>
              <li>建议在同一局域网内使用</li>
            </ul>
          </section>

          {/* 错误提示 */}
          {error && !error.includes('导出失败') && (
            <div className={`alert alert-error ${isMobile ? 'is-mobile' : ''}`}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
