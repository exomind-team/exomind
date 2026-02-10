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
  // 存储密码引用（仅用于 clear() 时清理，JavaScript 无法真正擦除字符串内存）
  // 使用 void 消除未使用警告
  private _passwordRef: string | null = null;
  private currentKey: CryptoKey | null = null;

  async setPassword(password: string): Promise<void> {
    this._passwordRef = password;
    this.currentKey = await deriveKeyFromPassword(password);
    void this._passwordRef; // 消除未使用警告
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

  deriveKeyFromPassword(password: string): Promise<CryptoKey> {
    return deriveKeyFromPassword(password);
  }

  clear(): void {
    this._passwordRef = null;
    this.currentKey = null;
  }
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
