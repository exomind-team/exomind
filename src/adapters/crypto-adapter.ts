/**
 * 加密适配器 - AES-256-GCM 加密实现
 *
 * 只负责：
 * - 消息内容的端到端加密
 * - 本地数据的存储加密
 *
 * 不再负责：
 * - 用户密码哈希（由服务器处理）
 */

// 固定公开盐（用于多设备密钥派生，保持一致性）
const ENCRYPTION_SALT = 'exomind-v1-salt';

const PBKDF2_ITERATIONS = 100000;  // NIST 推荐至少 100,000 次
const IV_LENGTH = 12;  // NIST 推荐 12 字节 = 96 位
const KEY_LENGTH = 32;  // 256 位

/**
 * 从密码派生 AES-256 密钥
 */
export async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // 将密码 + 固定盐导入为 PBKDF2 密钥
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password + ENCRYPTION_SALT),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 派生 AES-256-GCM 密钥
  return await crypto.subtle.deriveKey(
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
  const encrypted = await crypto.subtle.encrypt(
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
  const decrypted = await crypto.subtle.decrypt(
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

  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
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
