/**
 * 冲突解决模块
 *
 * 实现 LWW（Last-Write-Wins）冲突解决策略：
 * - 基于时间戳选择最新版本
 * - 时间戳相同时使用设备 ID 作为裁决
 */

import type { Conflict } from '@/environment/interfaces/sync.port';

interface DocWithRev {
  value: unknown;
  timestamp: number;
  deviceId: string;
  _rev?: string;
}

/**
 * LWW 冲突解决
 * 比较时间戳和设备 ID，选择最终胜出的版本
 *
 * @param local 本地版本
 * @param remote 远程版本
 * @returns 'local' 表示保留本地，'remote' 表示保留远程
 */
export function resolveByLWW(
  local: DocWithRev,
  remote: DocWithRev
): 'local' | 'remote' {
  // 时间戳比较
  if (local.timestamp > remote.timestamp) {
    return 'local';
  } else if (local.timestamp < remote.timestamp) {
    return 'remote';
  }

  // 时间戳相同，比较设备 ID（最后写入的设备胜出）
  return local.deviceId > remote.deviceId ? 'local' : 'remote';
}

/**
 * 检测是否存在冲突
 *
 * @param local 本地版本
 * @param remote 远程版本
 * @returns true 表示存在冲突
 */
export function detectConflict(
  local: DocWithRev,
  remote: DocWithRev
): boolean {
  // 如果两者都有修改且时间戳不同，则有冲突
  // 冲突条件：不同设备 + 不同时间戳
  return (
    local.timestamp !== remote.timestamp &&
    local.deviceId !== remote.deviceId
  );
}

/**
 * 创建冲突对象
 *
 * @param docId 文档 ID
 * @param docType 文档类型
 * @param local 本地版本
 * @param remote 远程版本
 * @returns 冲突对象
 */
export function createConflict(
  docId: string,
  docType: 'event' | 'config',
  local: DocWithRev,
  remote: DocWithRev
): Conflict {
  return {
    id: `${docId}-${Date.now()}`,
    docId,
    docType,
    local,
    remote,
    resolved: false,
  };
}

/**
 * 自动解决冲突（使用 LWW）
 *
 * @param conflict 冲突对象
 * @returns 解决后的值
 */
export function autoResolve(
  local: DocWithRev,
  remote: DocWithRev
): unknown {
  const winner = resolveByLWW(local, remote);
  return winner === 'local' ? local.value : remote.value;
}
