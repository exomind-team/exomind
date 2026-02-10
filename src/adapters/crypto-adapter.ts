/**
 * 加密适配器 - AES-256-GCM 加密实现
 *
 * 方案A：密钥从用户密码派生
 * - 设备A: 密码 + 固定盐 → 密钥A
 * - 设备B: 相同密码 + 相同盐 → 相同密钥
 * - 加密数据可跨设备解密
 */

// 固定公开盐（用于多设备密钥派生，保持一致性）
const ENCRYPTION_SALT = 'exomind-v1-salt';

/**
 * 密钥派生迭代次数（PBKDF2）
 * NIST 推荐至少 100,000 次
 */
const PBKDF2_ITERATIONS = 100000;

/**
 * AES-GCM IV 长度（12字节 = 96位）
 * NIST 推荐使用 96 位 IV
 */
const IV_LENGTH = 12;

/**
 * 加密 Port 接口
 */
export interface ICryptoPort {
  /**
   * 使用密码生成加密密钥（方案A：多设备用相同密码生成相同密钥）
   */
  deriveKeyFromPassword(password: string): Promise<CryptoKey>;

  /**
   * AES-256-GCM 加密
   * @param plaintext 明文
   * @returns Base64 编码的密文（IV + 加密数据）
   */
  encrypt(plaintext: string): Promise<string>;

  /**
   * AES-256-GCM 解密
   * @param ciphertext Base64 编码的密文
   * @returns 明文
   */
  decrypt(ciphertext: string): Promise<string>;

  /**
   * 设置当前密码（用于后续加密/解密）
   */
  setPassword(password: string): Promise<void>;

  /**
   * 清空密钥（安全清理）
   */
  clear(): void;
}

/**
 * 使用 PBKDF2 从密码派生 AES-256 密钥
 * 支持多设备用相同密码生成相同密钥
 */
export async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // 将密码 + 固定盐导入为 PBKDF2 密钥
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password + ENCRYPTION_SALT),
    'PBKDF2',
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
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * AES-256-GCM 加密
 */
export async function encryptAes256(
  plaintext: string,
  password: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // 从密码派生密钥
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
 */
export async function decryptAes256(
  ciphertext: string,
  password: string
): Promise<string> {
  const decoder = new TextDecoder();

  // 从密码派生密钥
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
 * 生成随机盐
 *
 * @param length - 盐长度（字节数，默认 16）
 * @returns Base64 编码的盐字符串
 */
export function generateSalt(length: number = 16): string {
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);

  // Base64 编码
  const base64Chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';

  // 每 3 字节转换为 4 个 Base64 字符
  for (let i = 0; i < randomBytes.length; i += 3) {
    const byte1 = randomBytes[i];
    const byte2 = randomBytes[i + 1] ?? 0;
    const byte3 = randomBytes[i + 2] ?? 0;

    const char1 = base64Chars[byte1 >> 2];
    const char2 = base64Chars[((byte1 & 0x03) << 4) | (byte2 >> 4)];
    const char3 = base64Chars[((byte2 & 0x0f) << 2) | (byte3 >> 6)];
    const char4 = base64Chars[byte3 & 0x3f];

    // 填充 '=' 如果字节不足
    result += char1;
    result += char2;
    result += i + 1 < randomBytes.length ? char3 : '=';
    result += i + 2 < randomBytes.length ? char4 : '=';
  }

  return result;
}

/**
 * SHA-256 哈希
 *
 * @param message - 消息字符串
 * @returns 十六进制哈希字符串
 */
export async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const msgBuffer = encoder.encode(message);

  // 使用 Web Crypto API 计算 SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  // 转换为十六进制字符串
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PBKDF2-HMAC-SHA256 哈希长度（32字节 = 256位）
 */
const HASH_LENGTH = 32;

/**
 * 带盐哈希密码（使用 PBKDF2-HMAC-SHA256）
 *
 * @param password - 原始密码
 * @param salt - 盐值（Base64 编码）
 * @returns 格式化的哈希字符串 "$pbkdf2$salt$hash"
 */
export async function hashPassword(
  password: string,
  salt: string
): Promise<string> {
  const encoder = new TextEncoder();
  const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));

  // 使用 PBKDF2 派生密钥
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    HASH_LENGTH * 8
  );

  const hashBytes = new Uint8Array(derivedBits);
  const hash = btoa(String.fromCharCode(...hashBytes));

  return `$pbkdf2$${salt}$${hash}`;
}

/**
 * 验证密码（使用 PBKDF2-HMAC-SHA256）
 *
 * @param password - 原始密码
 * @param stored - 存储的格式化哈希字符串
 * @returns 是否匹配
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  // 解析存储的哈希字符串格式: $pbkdf2$salt$hash
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== 'pbkdf2') {
    return false;
  }

  const salt = parts[2];
  const storedHash = parts[3];

  // 重新计算哈希
  const encoder = new TextEncoder();
  const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    HASH_LENGTH * 8
  );

  const computedHash = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));

  return computedHash === storedHash;
}

/**
 * 便捷函数：生成带盐哈希的密码（自动生成盐）
 *
 * @param password - 原始密码
 * @returns 格式化的哈希字符串（自动生成盐）
 */
export async function hashPasswordWithSalt(
  password: string
): Promise<string> {
  const salt = generateSalt(16);
  return hashPassword(password, salt);
}

/**
 * 便捷函数：快速加密（自动派生密钥）
 *
 * @param plaintext 明文
 * @param password 密码
 * @returns Base64 编码的密文
 */
export async function quickEncrypt(
  plaintext: string,
  password: string
): Promise<string> {
  return encryptAes256(plaintext, password);
}

/**
 * 便捷函数：快速解密（自动派生密钥）
 *
 * @param ciphertext Base64 编码的密文
 * @param password 密码
 * @returns 明文
 */
export async function quickDecrypt(
  ciphertext: string,
  password: string
): Promise<string> {
  return decryptAes256(ciphertext, password);
}

/**
 * 加密适配器类实现
 *
 * 使用示例：
 * ```typescript
 * const crypto = new CryptoAdapter();
 * await crypto.setPassword('my-password');
 *
 * const encrypted = await crypto.encrypt('secret data');
 * const decrypted = await crypto.decrypt(encrypted);
 * ```
 */
export class CryptoAdapter implements ICryptoPort {
  private currentKey: CryptoKey | null = null;

  setPassword(password: string): Promise<void> {
    return this.deriveKey(password).then((key) => {
      this.currentKey = key;
    });
  }

  async encrypt(plaintext: string): Promise<string> {
    if (!this.currentKey) {
      throw new Error('Password not set. Call setPassword() first.');
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // 生成随机 IV (12字节)
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    // 加密
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.currentKey,
      data
    );

    // 组合 IV + 加密数据
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Base64 编码
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (!this.currentKey) {
      throw new Error('Password not set. Call setPassword() first.');
    }

    const decoder = new TextDecoder();

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
      this.currentKey,
      encrypted
    );

    return decoder.decode(decrypted);
  }

  deriveKey(password: string): Promise<CryptoKey> {
    return deriveKeyFromPassword(password);
  }

  deriveKeyFromPassword(password: string): Promise<CryptoKey> {
    return deriveKeyFromPassword(password);
  }

  clear(): void {
    this.currentKey = null;
  }

  // === 密码哈希方法 ===

  generateSalt(length?: number): string {
    return generateSalt(length);
  }

  sha256(message: string): Promise<string> {
    return sha256(message);
  }

  hashPassword(password: string, salt: string): Promise<string> {
    return hashPassword(password, salt);
  }

  verifyPassword(password: string, stored: string): Promise<boolean> {
    return verifyPassword(password, stored);
  }
}
