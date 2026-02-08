import { DeviceList } from './DeviceList';

interface DevicesPageProps {
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
}

export function DevicesPage({ connectionStatus: _ }: DevicesPageProps) {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">设备</h2>
      <p className="text-muted-foreground mb-6">管理已配对的设备</p>
      <DeviceList devices={[]} />
    </div>
  );
}
