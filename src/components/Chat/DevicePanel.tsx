import React, { useState } from 'react';

export interface Device {
  id: string;
  name: string;
  type: 'mobile' | 'desktop' | 'tablet';
  status: 'online' | 'offline';
}

export interface DevicePanelProps {
  devices: Device[];
  currentDevice: string;
  onDeviceSelect?: (deviceId: string) => void;
  onAddDevice?: () => void;
}

export function DevicePanel({ 
  devices, 
  currentDevice, 
  onDeviceSelect,
  onAddDevice 
}: DevicePanelProps): React.ReactElement {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [password, setPassword] = useState('');

  const handleAddDevice = () => {
    setShowAddDialog(true);
    onAddDevice?.();
  };

  const handleConfirmAdd = () => {
    setShowAddDialog(false);
    setPassword('');
  };

  const getDeviceIcon = (type: Device['type']) => {
    switch (type) {
      case 'mobile': return '??';
      case 'desktop': return '???';
      case 'tablet': return '??';
      default: return '??';
    }
  };

  return (
    <div className='device-panel'>
      <div className='device-panel-header'>
        <h3>设备管理</h3>
        <button onClick={handleAddDevice}>添加设备</button>
      </div>

      <div className='device-list'>
        {devices.map(device => (
          <div 
            key={device.id}
            className={'device-item ' + (device.id === currentDevice ? 'current' : '')}
            onClick={() => onDeviceSelect?.(device.id)}
          >
            <span className='device-icon'>{getDeviceIcon(device.type)}</span>
            <span className='device-name'>{device.name}</span>
            <span className={'device-status ' + device.status}>
              {device.status === 'online' ? '在线' : '离线'}
            </span>
            {device.id === currentDevice && (
              <span className='current-badge'>当前设备</span>
            )}
          </div>
        ))}
      </div>

      {showAddDialog && (
        <div className='dialog-overlay'>
          <div className='dialog'>
            <h4>添加设备</h4>
            <p>输入连接密码</p>
            <input
              type='password'
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder='请输入密码'
            />
            <div className='dialog-actions'>
              <button onClick={() => setShowAddDialog(false)}>取消</button>
              <button onClick={handleConfirmAdd}>确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DevicePanel;
