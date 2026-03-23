/**
 * 加密适配器 - AES-256-GCM 加密实现
 *
 * 负责：
 * - 消息内容的端到端加密
 * - 本地数据的存储加密
 * - 用户密码哈希（本地注册场景）
 */

import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

// 固定公开盐（用于多设备密钥派生，保持一致性）
const ENCRYPTION_SALT = 'exomind-v1-salt';
// 密码哈希盐（用于本地用户注册）
const PASSWORD_HASH_SALT = 'exomind-password-v1';

const PBKDF2_ITERATIONS = 100000;  // NIST 推荐至少 100,000 次
const IV_LENGTH = 12;  // NIST 推荐 12 字节 = 96 位
const KEY_LENGTH = 256;  // 256 位（Crypto API expects bits）

function getCryptoApi(): Crypto {
  if (typeof globalThis.crypto === 'undefined') {
    throw new Error('当前环境不支持 Web Crypto API');
  }

  return globalThis.crypto;
}

function hasSubtlePBKDF2(cryptoApi: Crypto): boolean {
  const subtle = cryptoApi.subtle;
  return !!subtle
    && typeof subtle.importKey === 'function'
    && typeof subtle.deriveBits === 'function';
}

async function derivePasswordBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password + PASSWORD_HASH_SALT);
  const cryptoApi = getCryptoApi();

  if (hasSubtlePBKDF2(cryptoApi)) {
    const passwordKey = await cryptoApi.subtle.importKey(
      'raw',
      passwordBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await cryptoApi.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      passwordKey,
      256
    );

    return new Uint8Array(derivedBits);
  }

  return noblePbkdf2(nobleSha256, passwordBytes, salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
}

/**
 * 从密码派生 AES-256 密钥
 */
export async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const cryptoApi = getCryptoApi();
  if (!cryptoApi.subtle || typeof cryptoApi.subtle.importKey !== 'function' || typeof cryptoApi.subtle.deriveKey !== 'function') {
    throw new Error('当前环境不支持 AES 加密所需的 Web Crypto Subtle API');
  }

  const encoder = new TextEncoder();

  // 将密码 + 固定盐导入为 PBKDF2 密钥
  const passwordKey = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(password + ENCRYPTION_SALT),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 派生 AES-256-GCM 密钥
  return await cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(ENCRYPTION_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 生成随机盐
 */
export function generateSalt(length: number = 16): Uint8Array {
  const salt = new Uint8Array(length);
  getCryptoApi().getRandomValues(salt);
  return salt;
}

/**
 * AES-256-GCM 加密
 *
 * @param plaintext 明文
 * @param password 密码
 * @returns Base64 编码的密文（IV + 加密数据）
 */
export async function encryptAes256(plaintext: string, password: string): Promise<string> {
  const cryptoApi = getCryptoApi();
  if (!cryptoApi.subtle || typeof cryptoApi.subtle.encrypt !== 'function') {
    throw new Error('当前环境不支持 AES 加密所需的 Web Crypto Subtle API');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // 从密码派生密钥（使用固定盐）
  const key = await deriveKeyFromPassword(password);

  // 生成随机 IV (12字节)
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_LENGTH));

  // 加密
  const encrypted = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // 组合 IV + 加密数据
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Base64 编码
  return btoa(String.fromCharCode(...combined));
}

/**
 * AES-256-GCM 解密
 *
 * @param ciphertext Base64 编码的密文
 * @param password 密码
 * @returns 明文
 */
export async function decryptAes256(ciphertext: string, password: string): Promise<string> {
  const cryptoApi = getCryptoApi();
  if (!cryptoApi.subtle || typeof cryptoApi.subtle.decrypt !== 'function') {
    throw new Error('当前环境不支持 AES 解密所需的 Web Crypto Subtle API');
  }

  const decoder = new TextDecoder();

  // 从密码派生密钥（使用固定盐）
  const key = await deriveKeyFromPassword(password);

  // Base64 解码
  const combined = new Uint8Array(
    atob(ciphertext).split('').map((c) => c.charCodeAt(0))
  );

  // 提取 IV
  const iv = combined.slice(0, IV_LENGTH);
  const encrypted = combined.slice(IV_LENGTH);

  // 解密
  const decrypted = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  return decoder.decode(decrypted);
}

/**
 * SHA-256 哈希
 */
export async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const msgBuffer = encoder.encode(message);
  const cryptoApi = globalThis.crypto;

  if (!cryptoApi?.subtle || typeof cryptoApi.subtle.digest !== 'function') {
    const hashArray = Array.from(nobleSha256(msgBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const hashBuffer = await cryptoApi.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 便捷函数：快速加密（自动派生密钥）
 */
export async function quickEncrypt(plaintext: string, password: string): Promise<string> {
  return encryptAes256(plaintext, password);
}

/**
 * 便捷函数：快速解密（自动派生密钥）
 */
export async function quickDecrypt(ciphertext: string, password: string): Promise<string> {
  return decryptAes256(ciphertext, password);
}

/**
 * 使用 PBKDF2 对密码进行哈希处理
 *
 * @param password 明文密码
 * @returns 格式化的哈希字符串: $pbkdf2$salt$hash
 */
export async function hashPasswordWithSalt(password: string): Promise<string> {
  const salt = getCryptoApi().getRandomValues(new Uint8Array(16));
  const hashArray = Array.from(await derivePasswordBits(password, salt));
  const saltArray = Array.from(salt);

  // 格式化: $pbkdf2$<saltBase64>$<hashBase64>
  const saltBase64 = btoa(String.fromCharCode(...saltArray));
  const hashBase64 = btoa(String.fromCharCode(...hashArray));

  return `$pbkdf2$${saltBase64}$${hashBase64}`;
}

/**
 * 验证密码是否匹配哈希
 *
 * @param password 明文密码
 * @param storedHash 存储的哈希字符串
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    // 解析存储的哈希
    // 支持两种格式：
    // 1) $pbkdf2$<salt>$<hash>（当前格式）
    // 2) pbkdf2$<salt>$<hash>（兼容历史/手动数据）
    const normalizedHash = storedHash.startsWith('$')
      ? storedHash.slice(1)
      : storedHash;
    const parts = normalizedHash.split('$');

    if (parts.length !== 3 || parts[0] !== 'pbkdf2') {
      return false;
    }

    const saltBase64 = parts[1];
    const storedHashBase64 = parts[2];

    // 解码 salt 和 hash
    const salt = new Uint8Array(
      atob(saltBase64).split('').map((c) => c.charCodeAt(0))
    );
    const storedHashArray = new Uint8Array(
      atob(storedHashBase64).split('').map((c) => c.charCodeAt(0))
    );

    // 使用相同参数计算新哈希（WebCrypto 或 JS fallback）
    const newHashArray = await derivePasswordBits(password, salt);

    // 使用恒定时间比较防止时序攻击
    if (newHashArray.length !== storedHashArray.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < newHashArray.length; i++) {
      result |= newHashArray[i] ^ storedHashArray[i];
    }

    return result === 0;
  } catch {
    return false;
  }
}
