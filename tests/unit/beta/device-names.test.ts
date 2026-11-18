import { afterEach,describe,expect,it } from 'vitest';
import { deviceName,saveDeviceName } from '@/beta/device-names';

afterEach(()=>localStorage.clear());
describe('B14-D01: names annotate stable identity without changing authority',()=>{
  it('keeps device-specific remarks isolated between local installations and preserves other devices',()=>{
    saveDeviceName('pc','tablet','旅行平板');saveDeviceName('pc','phone','手机');saveDeviceName('other-pc','tablet','另一份备注');
    const names=JSON.parse(localStorage.getItem('exomind:beta:device-names:pc')!);
    expect(deviceName('pc','tablet',names)).toBe('旅行平板');expect(deviceName('pc','phone',names)).toBe('手机');expect(deviceName('pc','pc',names)).toBe('本机');
    expect(JSON.parse(localStorage.getItem('exomind:beta:device-names:other-pc')!).tablet).toBe('另一份备注');
  });
  it('preserves corrupt cached names instead of replacing them with an empty table',()=>{
    localStorage.setItem('exomind:beta:device-names:pc','corrupt');expect(()=>saveDeviceName('pc','tablet','平板')).toThrow();expect(localStorage.getItem('exomind:beta:device-names:pc')).toBe('corrupt');
  });
});
