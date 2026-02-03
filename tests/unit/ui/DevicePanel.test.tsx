import { describe, it, expect, beforeAll } from 'vitest';

let DevicePanel;
let DevicePanelModule;

async function loadDeps() {
  DevicePanelModule = await import('../../../src/components/Chat/DevicePanel');
  DevicePanel = DevicePanelModule.default || DevicePanelModule.DevicePanel;
}

describe('DevicePanel', () => {
  beforeAll(async () => {
    await loadDeps();
  });

  it('should export DevicePanel as default function', () => {
    expect(DevicePanel).toBeDefined();
    expect(typeof DevicePanel).toBe('function');
  });
  
  it('should export default from module', () => {
    expect(DevicePanelModule.default).toBeDefined();
  });
});
