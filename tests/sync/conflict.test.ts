/**
 * 冲突解决模块单元测试
 *
 * 测试 LWW（Last-Write-Wins）冲突解决策略：
 * - 时间戳比较
 * - 设备 ID 裁决
 * - 冲突检测
 */

import { describe, it, expect } from 'vitest';
import {
  resolveByLWW,
  detectConflict,
  createConflict,
  autoResolve,
} from '../../src/lib/sync/conflict-resolver';

describe('resolveByLWW', () => {
  it('应该选择时间戳更新的本地版本', () => {
    const local = { timestamp: 1000, deviceId: 'device-a', value: { name: 'Alice' } };
    const remote = { timestamp: 900, deviceId: 'device-b', value: { name: 'Bob' } };

    expect(resolveByLWW(local, remote)).toBe('local');
  });

  it('应该选择时间戳更新的远程版本', () => {
    const local = { timestamp: 1000, deviceId: 'device-a', value: { name: 'Alice' } };
    const remote = { timestamp: 1100, deviceId: 'device-b', value: { name: 'Bob' } };

    expect(resolveByLWW(local, remote)).toBe('remote');
  });

  it('时间戳相同时应该选择设备 ID 更大的', () => {
    const local = { timestamp: 1000, deviceId: 'device-a', value: { name: 'Alice' } };
    const remote = { timestamp: 1000, deviceId: 'device-b', value: { name: 'Bob' } };

    // 'device-b' > 'device-a'
    expect(resolveByLWW(local, remote)).toBe('remote');
  });

  it('时间戳和设备 ID 都相同时应该返回 remote', () => {
    const local = { timestamp: 1000, deviceId: 'device-a', value: { name: 'Alice' } };
    const remote = { timestamp: 1000, deviceId: 'device-a', value: { name: 'Bob' } };

    // 设备 ID 相同，不会进入时间戳相等的分支，会返回 remote（因为 local.deviceId > remote.deviceId 为 false）
    expect(resolveByLWW(local, remote)).toBe('remote');
  });

  it('应该正确处理大数值时间戳', () => {
    const local = { timestamp: 1704067200000, deviceId: 'A', value: { version: 2 } };
    const remote = { timestamp: 1704067199000, deviceId: 'B', value: { version: 1 } };

    expect(resolveByLWW(local, remote)).toBe('local');
  });

  it('应该正确处理零时间戳', () => {
    const local = { timestamp: 0, deviceId: 'A', value: {} };
    const remote = { timestamp: 1, deviceId: 'B', value: {} };

    expect(resolveByLWW(local, remote)).toBe('remote');
  });
});

describe('detectConflict', () => {
  it('应该正确检测冲突（不同设备 + 不同时间戳）', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: {} };
    const remote = { timestamp: 1100, deviceId: 'B', value: {} };

    expect(detectConflict(local, remote)).toBe(true);
  });

  it('相同设备不应该有冲突', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: {} };
    const remote = { timestamp: 1100, deviceId: 'A', value: {} };

    expect(detectConflict(local, remote)).toBe(false);
  });

  it('时间戳相同不应该有冲突', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: {} };
    const remote = { timestamp: 1000, deviceId: 'B', value: {} };

    expect(detectConflict(local, remote)).toBe(false);
  });

  it('应该正确处理嵌套对象', () => {
    const local = { timestamp: 2000, deviceId: 'A', value: { nested: { data: 'local' } } };
    const remote = { timestamp: 1000, deviceId: 'B', value: { nested: { data: 'remote' } } };

    expect(detectConflict(local, remote)).toBe(true);
  });

  it('应该正确处理数组值', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: [1, 2, 3] };
    const remote = { timestamp: 1000, deviceId: 'B', value: [4, 5, 6] };

    expect(detectConflict(local, remote)).toBe(false);
  });
});

describe('createConflict', () => {
  it('应该正确创建冲突对象', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: { name: 'Alice' } };
    const remote = { timestamp: 1100, deviceId: 'B', value: { name: 'Bob' } };

    const conflict = createConflict('config:theme', 'config', local, remote);

    expect(conflict.id).toContain('config:theme');
    expect(conflict.docId).toBe('config:theme');
    expect(conflict.docType).toBe('config');
    expect(conflict.local).toEqual(local);
    expect(conflict.remote).toEqual(remote);
    expect(conflict.resolved).toBe(false);
  });

  it('应该支持事件类型的冲突', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: { content: 'local' } };
    const remote = { timestamp: 1100, deviceId: 'B', value: { content: 'remote' } };

    const conflict = createConflict('event:123', 'event', local, remote);

    expect(conflict.docType).toBe('event');
  });

  it('冲突 ID 应该基于 docId 生成唯一标识', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: {} };
    const remote = { timestamp: 1100, deviceId: 'B', value: {} };

    const conflict = createConflict('doc-1', 'config', local, remote);

    // ID 应该以 docId 为前缀
    expect(conflict.id.startsWith('doc-1-')).toBe(true);
    expect(conflict.id).toMatch(/^doc-1-\d+$/);
  });
});

describe('autoResolve', () => {
  it('应该自动选择时间戳更新的版本', () => {
    const local = { timestamp: 2000, deviceId: 'A', value: { data: 'local' } };
    const remote = { timestamp: 1000, deviceId: 'B', value: { data: 'remote' } };

    const resolved = autoResolve(local, remote);

    expect(resolved).toEqual({ data: 'local' });
  });

  it('时间戳相同时应该根据设备 ID 选择', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: { data: 'local' } };
    const remote = { timestamp: 1000, deviceId: 'B', value: { data: 'remote' } };

    const resolved = autoResolve(local, remote);

    // 'device-b' > 'device-a'，所以选择远程
    expect(resolved).toEqual({ data: 'remote' });
  });

  it('应该正确处理简单值类型', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: 'hello' };
    const remote = { timestamp: 1000, deviceId: 'B', value: 'world' };

    const resolved = autoResolve(local, remote);

    expect(resolved).toBe('world');
  });

  it('应该正确处理数值类型', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: 42 };
    const remote = { timestamp: 1000, deviceId: 'B', value: 100 };

    const resolved = autoResolve(local, remote);

    expect(resolved).toBe(100);
  });

  it('应该正确处理布尔类型', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: true };
    const remote = { timestamp: 1000, deviceId: 'B', value: false };

    const resolved = autoResolve(local, remote);

    expect(resolved).toBe(false);
  });

  it('应该正确处理 null 值', () => {
    const local = { timestamp: 1000, deviceId: 'A', value: null };
    const remote = { timestamp: 1000, deviceId: 'B', value: { key: 'value' } };

    const resolved = autoResolve(local, remote);

    expect(resolved).toEqual({ key: 'value' });
  });
});

describe('完整冲突解决流程', () => {
  it('应该支持完整的冲突检测到解决流程', () => {
    // 场景：用户在手机和平板上同时修改主题配置
    const phoneLocal = { timestamp: 1704067200000, deviceId: 'phone-001', value: { theme: 'dark' } };
    const tabletRemote = { timestamp: 1704067201000, deviceId: 'tablet-001', value: { theme: 'light' } };

    // 检测冲突
    const hasConflict = detectConflict(phoneLocal, tabletRemote);
    expect(hasConflict).toBe(true);

    // 解决冲突
    const winner = resolveByLWW(phoneLocal, tabletRemote);
    expect(winner).toBe('remote'); // 平板时间戳更新

    // 获取获胜的值
    const resolved = autoResolve(phoneLocal, tabletRemote);
    expect(resolved).toEqual({ theme: 'light' });
  });

  it('应该处理无冲突的合并场景', () => {
    // 场景：只在本地修改
    const local = { timestamp: 2000, deviceId: 'A', value: { data: 'new' } };
    const remote = { timestamp: 1000, deviceId: 'A', value: { data: 'old' } };

    const hasConflict = detectConflict(local, remote);
    expect(hasConflict).toBe(false); // 相同设备

    const winner = resolveByLWW(local, remote);
    expect(winner).toBe('local');
  });

  it('应该正确处理多设备同步的边界情况', () => {
    // 边界情况：时间戳差异极小
    const local = { timestamp: 1704067200001, deviceId: 'device-A', value: { count: 1 } };
    const remote = { timestamp: 1704067200000, deviceId: 'device-B', value: { count: 2 } };

    expect(resolveByLWW(local, remote)).toBe('local');
    expect(detectConflict(local, remote)).toBe(true);

    // 边界情况：设备 ID 非常接近
    const local2 = { timestamp: 1000, deviceId: 'device-Z', value: { letter: 'Z' } };
    const remote2 = { timestamp: 1000, deviceId: 'device-A', value: { letter: 'A' } };

    // 'device-Z' > 'device-A'
    expect(resolveByLWW(local2, remote2)).toBe('local');
  });
});
