export interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  type: 'desktop' | 'mobile';
}

export class DeviceDiscovery {
  private discoveredDevices: DiscoveredDevice[] = [];

  async startDiscovery(): Promise<void> {
    console.log('Starting device discovery...');
  }

  stopDiscovery(): void {
    console.log('Stopping device discovery...');
  }

  getDiscoveredDevices(): DiscoveredDevice[] {
    return this.discoveredDevices;
  }

  addDevice(device: DiscoveredDevice): void {
    this.discoveredDevices.push(device);
  }
}

export const deviceDiscovery = new DeviceDiscovery();
