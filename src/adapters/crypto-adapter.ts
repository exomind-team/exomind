/**
 * 加密适配器 - AES-256-GCM 加密实现
 *
 * 负责：
 * - 消息内容的端到端加密
 * - 本地数据的存储加密
 * - 用户密码哈希（本地注册场景）
 */

import { pbkdf2 as pbkdf2Js } from '@noble/hashes/pbkdf2.js';
import { sha256 as sha256Js } from '@noble/hashes/sha2.js';

// 固定公开盐（用于多设备密钥派生，保持一致性）
const ENCRYPTION_SALT = 'exomind-v1-salt';
// 密码哈希盐（用于本地用户注册）
const PASSWORD_HASH_SALT = 'exomind-password-v1';

const PBKDF2_ITERATIONS = 100000;  // NIST 推荐至少 100,000 次
const IV_LENGTH = 12;  // NIST 推荐 12 字节 = 96 位
const KEY_LENGTH = 32;  // 256 位

function getSubtleCrypto(): SubtleCrypto | null {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== 'function') {
    return null;
  }
  return subtle;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(
    atob(base64).split('').map((c) => c.charCodeAt(0))
  );
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function derivePasswordHashWithSubtle(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  if (!subtle || typeof subtle.deriveBits !== 'function') {
    throw new Error('WebCrypto PBKDF2 不可用');
  }

  const encoder = new TextEncoder();
  const passwordKey = await subtle.importKey(
    'raw',
    encoder.encode(password + PASSWORD_HASH_SALT),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await subtle.deriveBits(
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

function derivePasswordHashWithJsPbkdf2(password: string, salt: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  return pbkdf2Js(
    sha256Js,
    encoder.encode(password + PASSWORD_HASH_SALT),
    salt,
    { c: PBKDF2_ITERATIONS, dkLen: 32 }
  );
}

async function derivePasswordHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  if (subtle && typeof subtle.deriveBits === 'function') {
    return derivePasswordHashWithSubtle(password, salt);
  }
  // 无 WebCrypto 时使用纯 JS PBKDF2，保证仍是 KDF 方案而非弱散列兜底。
  return derivePasswordHashWithJsPbkdf2(password, salt);
}

/**
 * 从密码派生 AES-256 密钥
 */
export async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const subtle = getSubtleCrypto();
  if (!subtle) {
    throw new Error('WebCrypto subtle API 不可用');
  }

  // 将密码 + 固定盐导入为 PBKDF2 密钥
  const passwordKey = await subtle.importKey(
    'raw',
    encoder.encode(password + ENCRYPTION_SALT),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 派生 AES-256-GCM 密钥
  return await subtle.deriveKey(
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
  crypto.getRandomValues(salt);
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
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // 从密码派生密钥（使用固定盐）
  const key = await deriveKeyFromPassword(password);

  // 生成随机 IV (12字节)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // 加密
  const subtle = getSubtleCrypto();
  if (!subtle) {
    throw new Error('WebCrypto subtle API 不可用');
  }

  const encrypted = await subtle.encrypt(
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
  const subtle = getSubtleCrypto();
  if (!subtle) {
    throw new Error('WebCrypto subtle API 不可用');
  }

  const decrypted = await subtle.decrypt(
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
  const subtle = getSubtleCrypto();
  if (!subtle) {
    throw new Error('WebCrypto subtle API 不可用');
  }

  const hashBuffer = await subtle.digest('SHA-256', msgBuffer);
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
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivedHash = await derivePasswordHash(password, salt);

  // 格式化: $pbkdf2$<saltBase64>$<hashBase64>
  const saltBase64 = toBase64(salt);
  const hashBase64 = toBase64(derivedHash);

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
    const normalized = storedHash.startsWith('$') ? storedHash.slice(1) : storedHash;
    const parts = normalized.split('$');
    if (parts.length !== 3) {
      return false;
    }

    const [scheme, saltBase64, storedDigest] = parts;

    if (scheme === 'fallback') {
      // 明确拒绝历史弱哈希格式
      return false;
    }

    if (scheme !== 'pbkdf2') {
      return false;
    }

    // 解码 salt 和 hash
    const salt = fromBase64(saltBase64);
    const storedHashArray = fromBase64(storedDigest);

    // 使用相同参数计算新哈希（WebCrypto 或纯 JS PBKDF2）
    const newHashArray = await derivePasswordHash(password, salt);
    return timingSafeEqualBytes(newHashArray, storedHashArray);
  } catch {
    return false;
  }
}
