/**
 * Crypto Service
 * 设备间加密通讯服务
 * 基于 ECDH 密钥交换 + AES-256-GCM 加密
 */

import { store } from '@tauri-apps/plugin-store';
import {
  EncryptedMessage,
  KeyPair,
  CryptoError,
  CryptoErrorType,
} from './crypto-types';
import { getUserId } from '../user/user-id';
import { getTrustRelationship } from '../pairing/pairing-service';

/** 存储键名 */
const KEY_PAIR_KEY = 'crypto.keypair';
const SHARED_KEY_PREFIX = 'crypto.shared.';

/** AES-GCM 参数 */
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 128;

/** ECDH 参数 */
const EC_CURVE = 'P-256';
const EXPORT_FORMAT = 'spki';
const IMPORT_FORMAT = 'spki';

/**
 * 创建加密错误
 */
function createCryptoError(type: CryptoErrorType, message: string): CryptoError {
  const error = new Error(message) as CryptoError;
  error.type = type;
  return error;
}

/**
 * 导出公钥为 Base64
 */
async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await publicKey.export({
    format: 'raw',
    type: EXPORT_FORMAT,
  });
  return Buffer.from(exported).toString('base64');
}

/**
 * 导入公钥
 */
async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const publicKeyData = Buffer.from(publicKeyBase64, 'base64');
  return crypto.subtle.importKey(
    'raw',
    publicKeyData,
    { name: 'ECDH', namedCurve: EC_CURVE },
    true,
    []
  );
}

/**
 * 从本地存储获取本机密钥对
 */
async function getKeyPair(): Promise<KeyPair | null> {
  try {
    return await store.get<KeyPair>(KEY_PAIR_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * 保存本机密钥对
 */
async function saveKeyPair(keyPair: KeyPair): Promise<void> {
  await store.set(KEY_PAIR_KEY, keyPair);
  await store.save();
}

/**
 * 获取共享密钥的存储键
 */
function getSharedKeyStoreKey(peerId: string): string {
  return `${SHARED_KEY_PREFIX}${peerId}`;
}

/**
 * 从本地存储获取共享密钥
 */
async function getSharedKey(peerId: string): Promise<CryptoKey | null> {
  try {
    const stored = await store.get<string>(getSharedKeyStoreKey(peerId));
    if (!stored) return null;

    const keyData = Buffer.from(stored, 'base64');
    return crypto.subtle.importKey(
      'raw',
      keyData,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  } catch {
    return null;
  }
}

/**
 * 保存共享密钥
 */
async function saveSharedKey(peerId: string, key: CryptoKey): Promise<void> {
  const exported = await crypto.subtle.exportKey('raw', key);
  const base64 = Buffer.from(exported).toString('base64');
  await store.set(getSharedKeyStoreKey(peerId), base64);
  await store.save();
}

/**
 * 加密服务类
 */
export class CryptoService {
  private static instance: CryptoService | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  /**
   * 生成密钥对（配对时调用）
   * 返回公钥供对方使用
   */
  async generateKeyPair(): Promise<string> {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: EC_CURVE },
      true,
      []
    );

    const publicKey = await exportPublicKey(keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey(
      'pkcs8',
      keyPair.privateKey
    );

    const keyPairData: KeyPair = {
      publicKey,
      privateKey: Buffer.from(privateKey).toString('base64'),
    };

    await saveKeyPair(keyPairData);
    return publicKey;
  }

  /**
   * 派生共享密钥（配对确认时调用）
   * 用对方公钥和自己私钥生成共享密钥
   */
  async deriveSharedKey(peerId: string, theirPublicKey: string): Promise<void> {
    // 检查是否已配对
    const trust = await getTrustRelationship(peerId);
    if (!trust) {
      throw createCryptoError(CryptoErrorType.NOT_PAIRED, '未与该设备配对');
    }

    // 获取本机密钥对
    const localKeyPair = await getKeyPair();
    if (!localKeyPair) {
      throw createCryptoError(CryptoErrorType.KEY_NOT_FOUND, '本机密钥对不存在');
    }

    try {
      // 导入对方公钥
      const theirPubKey = await importPublicKey(theirPublicKey);

      // 导入本机私钥
      const privateKeyData = Buffer.from(localKeyPair.privateKey, 'base64');
      const ourPrivateKey = await crypto.subtle.importKey(
        'pkcs8',
        privateKeyData,
        { name: 'ECDH', namedCurve: EC_CURVE },
        false,
        []
      );

      // 派生共享密钥
      const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirPubKey },
        ourPrivateKey,
        { name: ALGORITHM, length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
      );

      // 保存共享密钥
      await saveSharedKey(peerId, sharedKey);
    } catch (error) {
      throw createCryptoError(
        CryptoErrorType.KEY_DERIVATION_FAILED,
        `密钥派生失败: ${error}`
      );
    }
  }

  /**
   * 加密消息
   */
  async encrypt(peerId: string, plaintext: string): Promise<string> {
    // 获取共享密钥
    const sharedKey = await getSharedKey(peerId);
    if (!sharedKey) {
      throw createCryptoError(CryptoErrorType.KEY_NOT_FOUND, '加密密钥不存在，请先完成配对');
    }

    try {
      // 生成随机 IV
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

      // 编码消息
      const encoder = new TextEncoder();
      const data = encoder.encode(plaintext);

      // 加密
      const encrypted = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv, tagLength: AUTH_TAG_LENGTH },
        sharedKey,
        data
      );

      // 提取密文和认证标签
      const encryptedArray = new Uint8Array(encrypted);
      const ciphertext = encryptedArray.slice(0, encryptedArray.length - 16);
      const authTag = encryptedArray.slice(encryptedArray.length - 16);

      // 获取本机 userId
      const senderId = await getUserId();

      // 构建加密消息
      const message: EncryptedMessage = {
        version: 1,
        iv: Buffer.from(iv).toString('base64'),
        ciphertext: Buffer.from(ciphertext).toString('base64'),
        authTag: Buffer.from(authTag).toString('base64'),
        timestamp: Date.now(),
        senderId,
      };

      // 返回 Base64 编码的 JSON
      return Buffer.from(JSON.stringify(message)).toString('base64');
    } catch (error) {
      throw createCryptoError(CryptoErrorType.ENCRYPTION_FAILED, `加密失败: ${error}`);
    }
  }

  /**
   * 解密消息
   */
  async decrypt(peerId: string, encryptedMessage: string): Promise<string> {
    // 获取共享密钥
    const sharedKey = await getSharedKey(peerId);
    if (!sharedKey) {
      throw createCryptoError(CryptoErrorType.KEY_NOT_FOUND, '解密密钥不存在，请先完成配对');
    }

    try {
      // 解析加密消息
      const messageData = Buffer.from(encryptedMessage, 'base64');
      const message: EncryptedMessage = JSON.parse(messageData.toString());

      // 验证版本
      if (message.version !== 1) {
        throw createCryptoError(CryptoErrorType.DECRYPTION_FAILED, '不支持的消息版本');
      }

      // 重组加密数据
      const iv = Buffer.from(message.iv, 'base64');
      const ciphertext = Buffer.from(message.ciphertext, 'base64');
      const authTag = Buffer.from(message.authTag, 'base64');
      const encryptedData = Buffer.concat([ciphertext, authTag]);

      // 解密
      const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv, tagLength: AUTH_TAG_LENGTH },
        sharedKey,
        encryptedData
      );

      // 返回明文
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      throw createCryptoError(CryptoErrorType.DECRYPTION_FAILED, `解密失败: ${error}`);
    }
  }

  /**
   * 验证能否与该 peer 通讯
   */
  async canCommunicate(peerId: string): Promise<boolean> {
    const sharedKey = await getSharedKey(peerId);
    return !!sharedKey;
  }

  /**
   * 删除与 peer 的密钥（取消配对时）
   */
  async deleteSharedKey(peerId: string): Promise<void> {
    await store.delete(getSharedKeyStoreKey(peerId));
    await store.save();
  }

  /**
   * 删除本机密钥对
   */
  async deleteKeyPair(): Promise<void> {
    await store.delete(KEY_PAIR_KEY);
    await store.save();
  }
}

/**
 * 获取加密服务的便捷函数
 */
export function getCryptoService(): CryptoService {
  return CryptoService.getInstance();
}
