/**
 * 加密 Port 接口和类型定义
 *
 * 基于 SPEC-301 多设备数据同步规格
 * @see docs/specs/SPEC-301-多设备数据同步.md
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 加密结果
 */
export interface EncryptResult {
  ciphertext: string;
  iv: string;
}

/**
 * 密钥派生选项
 */
export interface KeyDerivationOptions {
  iterations?: number;
  hashAlgorithm?: 'SHA-256' | 'SHA-384' | 'SHA-512';
  salt?: string;
}

/**
 * 加密选项
 */
export interface EncryptOptions {
  algorithm?: 'AES-GCM';
  keyLength?: 256;
  ivLength?: 12;
}

/**
 * 解密选项
 */
export interface DecryptOptions {
  algorithm?: 'AES-GCM';
}

// ============================================================================
// Port 接口
// ============================================================================

/**
 * 加密 Port 接口
 *
 * 支持 AES-256-GCM 加密，用于：
 * - API 密钥加密存储
 * - 敏感配置加密
 * - 端到端加密支持
 *
 * 方案 A：密钥从用户密码派生，支持多设备同步
 * - 设备A: 密码 + 固定盐 -> 密钥A
 * - 设备B: 相同密码 + 相同盐 -> 相同密钥
 * - 加密数据可跨设备解密
 */
export interface ICryptoPort {
  // === 密钥管理 ===
  /**
   * 使用 PBKDF2 从密码派生 AES-256 密钥
   * 支持多设备用相同密码生成相同密钥
   *
   * @param password - 用户密码
   * @param options - 派生选项
   * @returns 加密密钥
   */
  deriveKeyFromPassword(
    password: string,
    options?: KeyDerivationOptions
  ): Promise<CryptoKey>;

  /**
   * 设置当前会话密钥（用于批量加密/解密操作）
   *
   * @param key - CryptoKey 实例
   */
  setKey(key: CryptoKey): Promise<void>;

  /**
   * 清除当前会话密钥
   */
  clearKey(): Promise<void>;

  // === 加密操作 ===
  /**
   * AES-256-GCM 加密
   *
   * @param plaintext - 明文字符串
   * @returns Base64 编码的密文（包含 IV）
   */
  encrypt(plaintext: string): Promise<string>;

  /**
   * AES-256-GCM 加密（带选项）
   *
   * @param plaintext - 明文字符串
   * @param options - 加密选项
   * @returns 加密结果
   */
  encryptWithOptions(
    plaintext: string,
    options?: EncryptOptions
  ): Promise<EncryptResult>;

  /**
   * 加密 JSON 对象
   *
   * @param data - JSON 对象
   * @returns Base64 编码的密文
   */
  encryptJson<T>(data: T): Promise<string>;

  // === 解密操作 ===
  /**
   * AES-256-GCM 解密
   *
   * @param ciphertext - Base64 编码的密文
   * @returns 明文字符串
   */
  decrypt(ciphertext: string): Promise<string>;

  /**
   * AES-256-GCM 解密（带选项）
   *
   * @param ciphertext - 加密结果
   * @param options - 解密选项
   * @returns 明文字符串
   */
  decryptWithOptions(
    ciphertext: EncryptResult,
    options?: DecryptOptions
  ): Promise<string>;

  /**
   * 解密 JSON 对象
   *
   * @param ciphertext - Base64 编码的密文
   * @returns JSON 对象
   */
  decryptJson<T>(ciphertext: string): Promise<T>;

  // === 密码哈希（用于用户认证）===
  /**
   * 生成随机盐
   *
   * @param length - 盐长度
   * @returns 随机盐字符串
   */
  generateSalt(length?: number): string;

  /**
   * SHA-256 哈希
   *
   * @param message - 消息字符串
   * @returns 十六进制哈希字符串
   */
  sha256(message: string): Promise<string>;

  /**
   * 带盐哈希密码
   *
   * @param password - 原始密码
   * @param salt - 盐值
   * @returns 格式化的哈希字符串 "salt:hash"
   */
  hashPassword(password: string, salt: string): Promise<string>;

  /**
   * 验证密码
   *
   * @param password - 原始密码
   * @param stored - 存储的格式化哈希字符串
   * @returns 是否匹配
   */
  verifyPassword(password: string, stored: string): Promise<boolean>;
}
