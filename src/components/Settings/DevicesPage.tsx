import { DeviceList } from './DeviceList';

interface DevicesPageProps {
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
}

export function DevicesPage({ connectionStatus: _ }: DevicesPageProps) {
  return (
    <div className="p-4 sm:p-6">
      <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">设备</h2>
      <p className="text-sm sm:text-base text-muted-foreground mb-4 sm:mb-6">管理已配对的设备</p>
      <DeviceList devices={[]} />
    </div>
  );
}
