import { DiscoveredDevice } from '../../lib/sync/device-discovery';
import './DevicePanel.css';

interface DevicePanelProps {
  devices: DiscoveredDevice[];
  pairedDevices: DiscoveredDevice[];
  selectedDevice: DiscoveredDevice | null;
  onSelectDevice: (device: DiscoveredDevice | null) => void;
}

export function DevicePanel({
  devices,
  pairedDevices,
  selectedDevice,
  onSelectDevice,
}: DevicePanelProps) {
  const handleDeviceClick = (device: DiscoveredDevice) => {
    if (selectedDevice?.id === device.id) {
      onSelectDevice(null);
    } else {
      onSelectDevice(device);
    }
  };

  const getDeviceIcon = (type: DiscoveredDevice['type']) => {
    return type === 'desktop' ? '🖥️' : '📱';
  };

  return (
    <div className="device-panel">
      <div className="device-panel-header">
        <h2>设备</h2>
        <button
          className="refresh-btn"
          onClick={() => {
            console.log('Refresh devices...');
          }}
          title="刷新设备列表"
        >
          🔄
        </button>
      </div>

      <section className="device-section">
        <h3>已配对设备</h3>
        {pairedDevices.length === 0 ? (
          <p className="empty-message">暂无配对设备</p>
        ) : (
          <ul className="device-list">
            {pairedDevices.map((device) => (
              <li
                key={device.id}
                className={`device-item ${
                  selectedDevice?.id === device.id ? 'selected' : ''
                }`}
                onClick={() => handleDeviceClick(device)}
              >
                <span className="device-icon">{getDeviceIcon(device.type)}</span>
                <div className="device-info">
                  <span className="device-name">{device.name}</span>
                  <span className="device-ip">{device.ip}</span>
                </div>
                {selectedDevice?.id === device.id && (
                  <span className="selected-indicator">✓</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="device-section">
        <h3>发现设备</h3>
        {devices.length === 0 ? (
          <p className="empty-message">正在搜索设备...</p>
        ) : (
          <ul className="device-list">
            {devices.map((device) => (
              <li
                key={device.id}
                className={`device-item ${
                  selectedDevice?.id === device.id ? 'selected' : ''
                }`}
                onClick={() => handleDeviceClick(device)}
              >
                <span className="device-icon">{getDeviceIcon(device.type)}</span>
                <div className="device-info">
                  <span className="device-name">{device.name}</span>
                  <span className="device-ip">{device.ip}</span>
                </div>
                {selectedDevice?.id === device.id && (
                  <span className="selected-indicator">✓</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
