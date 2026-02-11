/**
 * 加密适配器 - AES-256-GCM 加密实现
 *
 * 负责：
 * - 消息内容的端到端加密
 * - 本地数据的存储加密
 * - 用户密码哈希（本地注册场景）
 */

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

function fallbackPasswordDigest(password: string, saltBase64: string): string {
  // 非加密强度哈希，仅用于缺失 WebCrypto(PBKDF2) 时的兼容兜底。
  const source = `${password}|${PASSWORD_HASH_SALT}|${saltBase64}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;

  for (let round = 0; round < 128; round++) {
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      h1 ^= code + round;
      h1 = Math.imul(h1, 16777619);
      h2 ^= code + round * 13;
      h2 = Math.imul(h2, 2246822519);
    }
    h1 ^= h1 >>> 13;
    h2 ^= h2 >>> 11;
  }

  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const subtle = getSubtleCrypto();

  if (!subtle || typeof subtle.deriveBits !== 'function') {
    const saltBase64 = toBase64(salt);
    const digest = fallbackPasswordDigest(password, saltBase64);
    return `$fallback$${saltBase64}$${digest}`;
  }

  // 派生密钥
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

  const hashArray = Array.from(new Uint8Array(derivedBits));
  const saltArray = Array.from(salt);

  // 格式化: $pbkdf2$<saltBase64>$<hashBase64>
  const saltBase64 = toBase64(new Uint8Array(saltArray));
  const hashBase64 = toBase64(new Uint8Array(hashArray));

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
    const encoder = new TextEncoder();

    // 解析存储的哈希
    const normalized = storedHash.startsWith('$') ? storedHash.slice(1) : storedHash;
    const parts = normalized.split('$');
    if (parts.length !== 3) {
      return false;
    }

    const [scheme, saltBase64, storedDigest] = parts;

    if (scheme === 'fallback') {
      const computed = fallbackPasswordDigest(password, saltBase64);
      return timingSafeEqual(computed, storedDigest);
    }

    if (scheme !== 'pbkdf2') {
      return false;
    }

    const subtle = getSubtleCrypto();
    if (!subtle || typeof subtle.deriveBits !== 'function') {
      // 当前环境无 PBKDF2 能力，无法验证 PBKDF2 哈希。
      return false;
    }

    // 解码 salt 和 hash
    const salt = fromBase64(saltBase64);
    const storedHashArray = fromBase64(storedDigest);

    // 使用相同参数计算新哈希
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

    const newHashArray = new Uint8Array(derivedBits);

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
