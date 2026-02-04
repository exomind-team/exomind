/**
 * Pairing Service
 * 设备配对服务，处理配对码生成和验证
 */

import { store } from '@tauri-apps/plugin-store';
import { v4 as uuidv4 } from 'uuid';
import {
  PairingSession,
  PairingResult,
  ConfirmResult,
  PairingError,
  PairingErrorType,
  PairingStatus,
  TrustRelationship,
} from './pairing-types';
import { getUserId } from '../user/user-id';

/** 存储键名 */
const PAIRING_SESSION_KEY = 'pairing.session';
const TRUST_RELATIONSHIPS_KEY = 'pairing.trust';
const PAIRING_LOCK_KEY = 'pairing.lock';

/** 配对码有效期（毫秒）= 5 分钟 */
const PAIRING_EXPIRY_MS = 5 * 60 * 1000;

/** 最大尝试次数 */
const MAX_ATTEMPTS = 3;

/** 配对锁定期（毫秒）= 1 分钟 */
const LOCKOUT_MS = 60 * 1000;

/**
 * 生成 6 位随机数字配对码
 */
function generatePairingCode(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const num = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  return (num % 1000000).toString().padStart(6, '0');
}

/**
 * 创建配对错误
 */
function createPairingError(type: PairingErrorType, message: string): PairingError {
  const error = new Error(message) as PairingError;
  error.type = type;
  return error;
}

/**
 * 获取信任关系列表
 */
async function getTrustRelationships(): Promise<Map<string, TrustRelationship>> {
  try {
    const stored = await store.get<Record<string, TrustRelationship>>(TRUST_RELATIONSHIPS_KEY);
    return new Map(Object.entries(stored || {}));
  } catch {
    return new Map();
  }
}

/**
 * 保存信任关系
 */
async function saveTrustRelationship(peerId: string, relationship: TrustRelationship): Promise<void> {
  const relationships = await getTrustRelationships();
  relationships.set(peerId, relationship);
  await store.set(TRUST_RELATIONSHIPS_KEY, Object.fromEntries(relationships));
  await store.save();
}

/**
 * 获取配对锁状态
 */
async function getPairingLock(): { locked: boolean; unlockAt: number } | null {
  try {
    const lock = await store.get<{ locked: boolean; unlockAt: number }>(PAIRING_LOCK_KEY);
    if (!lock || !lock.locked) return null;
    if (Date.now() > lock.unlockAt) {
      await store.delete(PAIRING_LOCK_KEY);
      return null;
    }
    return lock;
  } catch {
    return null;
  }
}

/**
 * 设置配对锁
 */
async function setPairingLock(): Promise<void> {
  await store.set(PAIRING_LOCK_KEY, {
    locked: true,
    unlockAt: Date.now() + LOCKOUT_MS,
  });
  await store.save();
}

/**
 * 清除配对锁
 */
async function clearPairingLock(): Promise<void> {
  await store.delete(PAIRING_LOCK_KEY);
}

/**
 * 配对服务类
 */
export class PairingService {
  private static instance: PairingService | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): PairingService {
    if (!PairingService.instance) {
      PairingService.instance = new PairingService();
    }
    return PairingService.instance;
  }

  /**
   * 开始配对（发起方）
   * 返回配对码供对方输入
   */
  async startPairing(): Promise<PairingResult> {
    // 检查是否有待确认的配对
    const existingSession = await this.getPairingSession();
    if (existingSession && existingSession.status === 'pending') {
      const remaining = Math.ceil((existingSession.expiresAt - Date.now()) / 1000);
      if (remaining > 0) {
        throw createPairingError(
          PairingErrorType.PAIRING_IN_PROGRESS,
          `已有待确认的配对，请在 ${remaining} 秒内完成或取消`
        );
      }
    }

    // 检查配对锁
    const lock = await getPairingLock();
    if (lock) {
      const remaining = Math.ceil((lock.unlockAt - Date.now()) / 1000);
      throw createPairingError(
        PairingErrorType.MAX_ATTEMPTS_EXCEEDED,
        `尝试次数过多，请在 ${remaining} 秒后重试`
      );
    }

    // 生成配对码和会话
    const pairingId = uuidv4();
    const code = generatePairingCode();
    const initiatorId = await getUserId();
    const now = Date.now();

    const session: PairingSession = {
      pairingId,
      code,
      initiatorId,
      status: 'pending',
      createdAt: now,
      expiresAt: now + PAIRING_EXPIRY_MS,
      attempts: 0,
    };

    // 保存会话
    await this.savePairingSession(session);

    return { pairingId, code };
  }

  /**
   * 确认配对（响应方）
   * 验证配对码并建立信任关系
   */
  async confirmPairing(code: string): Promise<ConfirmResult> {
    // 检查配对锁
    const lock = await getPairingLock();
    if (lock) {
      const remaining = Math.ceil((lock.unlockAt - Date.now()) / 1000);
      throw createPairingError(
        PairingErrorType.MAX_ATTEMPTS_EXCEEDED,
        `尝试次数过多，请在 ${remaining} 秒后重试`
      );
    }

    // 获取会话
    const session = await this.getPairingSession();
    if (!session) {
      throw createPairingError(PairingErrorType.NOT_FOUND, '配对码不存在或已过期');
    }

    // 验证状态
    if (session.status !== 'pending') {
      if (session.status === 'confirmed') {
        throw createPairingError(PairingErrorType.ALREADY_PAIRED, '配对已完成');
      }
      throw createPairingError(PairingErrorType.PAIRING_EXPIRED, '配对已过期');
    }

    // 验证过期
    if (Date.now() > session.expiresAt) {
      await this.clearPairingSession();
      throw createPairingError(PairingErrorType.PAIRING_EXPIRED, '配对码已过期');
    }

    // 验证配对码
    if (code !== session.code) {
      session.attempts++;
      await this.savePairingSession(session);

      if (session.attempts >= MAX_ATTEMPTS) {
        await setPairingLock();
        await this.clearPairingSession();
        throw createPairingError(
          PairingErrorType.MAX_ATTEMPTS_EXCEEDED,
          '尝试次数过多，请稍后重试'
        );
      }

      const remaining = MAX_ATTEMPTS - session.attempts;
      throw createPairingError(
        PairingErrorType.INVALID_CODE,
        `配对码错误，剩余 ${remaining} 次尝试机会`
      );
    }

    // 配对成功
    const responderId = await getUserId();
    session.responderId = responderId;
    session.status = 'confirmed';
    await this.savePairingSession(session);

    // 确定对方的 ID
    const peerId = session.initiatorId;

    // 清除会话
    await this.clearPairingSession();

    return { pairedUserId: peerId };
  }

  /**
   * 取消配对
   */
  async cancelPairing(): Promise<void> {
    await this.clearPairingSession();
  }

  /**
   * 获取当前配对状态
   */
  async getPairingStatus(): Promise<PairingSession | null> {
    return this.getPairingSession();
  }

  /**
   * 检查是否有待确认的配对
   */
  async hasPendingPairing(): Promise<boolean> {
    const session = await this.getPairingSession();
    return session?.status === 'pending' && Date.now() < session.expiresAt;
  }

  /**
   * 保存配对会话
   */
  private async savePairingSession(session: PairingSession): Promise<void> {
    await store.set(PAIRING_SESSION_KEY, session);
    await store.save();
  }

  /**
   * 获取配对会话
   */
  private async getPairingSession(): Promise<PairingSession | null> {
    try {
      const stored = await store.get<PairingSession>(PAIRING_SESSION_KEY);
      return stored || null;
    } catch {
      return null;
    }
  }

  /**
   * 清除配对会话
   */
  private async clearPairingSession(): Promise<void> {
    await store.delete(PAIRING_SESSION_KEY);
  }
}

/**
 * 保存信任关系（供加密模块使用）
 */
export async function saveTrustRelationship(peerId: string, peerPublicKey: string): Promise<void> {
  const relationship: TrustRelationship = {
    peerId,
    peerPublicKey,
    createdAt: Date.now(),
  };
  await store.set(`pairing.trust.${peerId}`, relationship);
  await store.save();
}

/**
 * 获取信任关系
 */
export async function getTrustRelationship(peerId: string): Promise<TrustRelationship | null> {
  try {
    return await store.get<TrustRelationship>(`pairing.trust.${peerId}`) || null;
  } catch {
    return null;
  }
}

/**
 * 检查是否已与该设备配对
 */
export async function isPaired(peerId: string): Promise<boolean> {
  const relationship = await getTrustRelationship(peerId);
  return !!relationship;
}

/**
 * 删除信任关系（取消配对时使用）
 */
export async function deleteTrustRelationship(peerId: string): Promise<void> {
  await store.delete(`pairing.trust.${peerId}`);
  await store.save();
}

/**
 * 获取配对服务的便捷函数
 */
export function getPairingService(): PairingService {
  return PairingService.getInstance();
}
