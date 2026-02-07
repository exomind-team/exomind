import { DiscoveredDevice } from './device-discovery';

export interface PairedDevice extends DiscoveredDevice {
  pairedAt: number;
  confirmed: boolean;
}

export class DevicePairing {
  private pairedDevices: PairedDevice[] = [];

  async requestPairing(device: DiscoveredDevice): Promise<string> {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    console.log(`Pairing request to ${device.name} with code ${code}`);
    return code;
  }

  async confirmPairing(deviceId: string, code: string): Promise<boolean> {
    console.log(`Confirming pairing for ${deviceId} with code ${code}`);
    return true;
  }

  getPairedDevices(): PairedDevice[] {
    return this.pairedDevices;
  }

  savePairedDevice(device: PairedDevice): void {
    this.pairedDevices.push(device);
    localStorage.setItem('pairedDevices', JSON.stringify(this.pairedDevices));
  }
}

export const devicePairing = new DevicePairing();
