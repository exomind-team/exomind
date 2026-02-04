import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DevicePanel } from '../../src/components/Chat/DevicePanel';
import type { DiscoveredDevice } from '../../lib/sync/device-discovery';

const mockDevices: DiscoveredDevice[] = [
  { id: 'd1', name: 'Desktop-PC', ip: '192.168.1.100', port: 8080, type: 'desktop' },
  { id: 'd2', name: 'Phone-X', ip: '192.168.1.101', port: 8080, type: 'mobile' },
];

const mockPairedDevices: DiscoveredDevice[] = [
  { id: 'p1', name: 'Laptop-Pro', ip: '192.168.1.200', port: 8080, type: 'desktop' },
];

describe('DevicePanel', () => {
  const onSelectDevice = vi.fn();

  beforeEach(() => {
    onSelectDevice.mockClear();
  });

  it('should display empty state when no devices', () => {
    render(
      <DevicePanel
        devices={[]}
        pairedDevices={[]}
        selectedDevice={null}
        onSelectDevice={onSelectDevice}
      />
    );

    expect(screen.getByText('已配对设备')).toBeInTheDocument();
    expect(screen.getByText('发现设备')).toBeInTheDocument();
    expect(screen.queryByText('Laptop-Pro')).not.toBeInTheDocument();
  });

  it('should display paired devices', () => {
    render(
      <DevicePanel
        devices={[]}
        pairedDevices={mockPairedDevices}
        selectedDevice={null}
        onSelectDevice={onSelectDevice}
      />
    );

    expect(screen.getByText('Laptop-Pro')).toBeInTheDocument();
  });

  it('should display discovered devices', () => {
    render(
      <DevicePanel
        devices={mockDevices}
        pairedDevices={[]}
        selectedDevice={null}
        onSelectDevice={onSelectDevice}
      />
    );

    expect(screen.getByText('Desktop-PC')).toBeInTheDocument();
    expect(screen.getByText('Phone-X')).toBeInTheDocument();
  });

  it('should highlight selected device', () => {
    render(
      <DevicePanel
        devices={mockDevices}
        pairedDevices={[]}
        selectedDevice={mockDevices[0]}
        onSelectDevice={onSelectDevice}
      />
    );

    const desktopItem = screen.getByText('Desktop-PC').closest('li');
    expect(desktopItem).toHaveClass('device-item', 'selected');
  });

  it('should call onSelectDevice when clicking device', () => {
    render(
      <DevicePanel
        devices={mockDevices}
        pairedDevices={[]}
        selectedDevice={null}
        onSelectDevice={onSelectDevice}
      />
    );

    fireEvent.click(screen.getByText('Desktop-PC'));
    expect(onSelectDevice).toHaveBeenCalledWith(mockDevices[0]);
  });

  it('should show device type icon', () => {
    render(
      <DevicePanel
        devices={mockDevices}
        pairedDevices={[]}
        selectedDevice={null}
        onSelectDevice={onSelectDevice}
      />
    );

    expect(screen.getByText('Desktop-PC')).toBeInTheDocument();
    expect(screen.getByText('Phone-X')).toBeInTheDocument();
  });

  it('should show refresh button', () => {
    render(
      <DevicePanel
        devices={[]}
        pairedDevices={[]}
        selectedDevice={null}
        onSelectDevice={onSelectDevice}
      />
    );

    expect(screen.getByTitle('刷新设备列表')).toBeInTheDocument();
  });
});
