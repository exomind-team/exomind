/**
 * Crypto Module Types
 * 定义加密相关的类型接口
 */

/** 加密消息格式 */
export interface EncryptedMessage {
  version: 1;              // 协议版本
  iv: string;              // Base64 编码的 IV (12 字节)
  ciphertext: string;      // Base64 编码的密文
  authTag: string;         // Base64 编码的认证标签 (16 字节)
  timestamp: number;       // 发送时间戳
  senderId: string;        // 发送方 userId
}

/** 密钥对 */
export interface KeyPair {
  publicKey: string;       // Base64 编码的公钥
  privateKey: string;      // Base64 编码的私钥（本地存储）
}

/** 加密错误类型 */
export enum CryptoErrorType {
  NOT_PAIRED = 'NOT_PAIRED',
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  KEY_DERIVATION_FAILED = 'KEY_DERIVATION_FAILED',
}

/** 加密错误 */
export interface CryptoError extends Error {
  type: CryptoErrorType;
}

/** 密钥派生参数 */
export interface DeriveKeyParams {
  peerId: string;          // 对方 userId
  theirPublicKey: string;   // 对方公钥 (Base64)
}
