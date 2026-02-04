/**
 * Pairing System Types
 * 定义配对相关的类型接口
 */

/** 配对会话状态 */
export type PairingStatus =
  | 'idle'         // 空闲，无待确认配对
  | 'pending'      // 等待对方确认
  | 'confirmed'    // 配对成功
  | 'cancelled'    // 已取消
  | 'expired';     // 已过期

/** 配对会话 */
export interface PairingSession {
  pairingId: string;        // 配对会话 ID (UUID)
  code: string;             // 6 位配对码
  initiatorId: string;      // 发起方 userId
  responderId?: string;     // 响应方 userId (确认后填充)
  status: PairingStatus;
  createdAt: number;         // 创建时间戳
  expiresAt: number;        // 过期时间戳
  attempts: number;         // 尝试次数
}

/** 配对结果 */
export interface PairingResult {
  pairingId: string;
  code: string;
}

/** 确认配对结果 */
export interface ConfirmResult {
  pairedUserId: string;
}

/** 配对错误类型 */
export enum PairingErrorType {
  PAIRING_EXPIRED = 'PAIRING_EXPIRED',
  INVALID_CODE = 'INVALID_CODE',
  PAIRING_IN_PROGRESS = 'PAIRING_IN_PROGRESS',
  MAX_ATTEMPTS_EXCEEDED = 'MAX_ATTEMPTS_EXCEEDED',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_PAIRED = 'ALREADY_PAIRED',
}

/** 配对错误 */
export interface PairingError extends Error {
  type: PairingErrorType;
}

/** 信任关系（配对成功后保存） */
export interface TrustRelationship {
  peerId: string;           // 对方 userId
  peerPublicKey: string;    // 对方公钥
  createdAt: number;
}
