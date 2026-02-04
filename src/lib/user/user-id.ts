/**
 * User Identity Module
 * Handles user ID generation and storage
 */

import { store } from '@tauri-apps/plugin-store';

/** 存储键名 */
const USER_ID_KEY = 'user.identity';

/** 用户身份接口 */
export interface UserIdentity {
  userId: string;
  createdAt: number;
}

/**
 * 生成随机用户 ID (32 字符十六进制 = 16 字节)
 */
function generateUserId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 用户身份管理类
 */
export class UserIdService {
  private static instance: UserIdService | null = null;
  private cachedUserId: string | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): UserIdService {
    if (!UserIdService.instance) {
      UserIdService.instance = new UserIdService();
    }
    return UserIdService.instance;
  }

  /**
   * 获取用户 ID，如果不存在则生成新的
   */
  async getUserId(): Promise<string> {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }

    try {
      const stored = await store.get<string>(USER_ID_KEY);
      if (stored) {
        this.cachedUserId = stored;
        return stored;
      }
    } catch (error) {
      console.warn('Failed to load userId from store, generating new one:', error);
    }

    // 生成新的用户 ID
    const newUserId = generateUserId();
    await this.saveUserId(newUserId);
    this.cachedUserId = newUserId;
    return newUserId;
  }

  /**
   * 检查用户 ID 是否已存在
   */
  async hasUserId(): Promise<boolean> {
    try {
      const stored = await store.get<string>(USER_ID_KEY);
      return !!stored;
    } catch {
      return false;
    }
  }

  /**
   * 生成新的用户 ID（会覆盖旧的）
   */
  async generateNewId(): Promise<string> {
    const newUserId = generateUserId();
    await this.saveUserId(newUserId);
    this.cachedUserId = newUserId;
    return newUserId;
  }

  /**
   * 获取格式化后的用户 ID (XXXX-XXXX-XXXX-XXXX)
   */
  async getFormattedId(): Promise<string> {
    const userId = await this.getUserId();
    return userId.replace(/(.{4})/g, '$1-').slice(0, -1);
  }

  /**
   * 保存用户 ID 到存储
   */
  private async saveUserId(userId: string): Promise<void> {
    try {
      await store.set(USER_ID_KEY, userId);
      await store.save();
    } catch (error) {
      console.error('Failed to save userId:', error);
      throw new Error('Failed to save userId');
    }
  }

  /**
   * 清除缓存（主要用于测试）
   */
  clearCache(): void {
    this.cachedUserId = null;
  }
}

/**
 * 获取用户 ID 的便捷函数
 */
export async function getUserId(): Promise<string> {
  return UserIdService.getInstance().getUserId();
}

/**
 * 获取格式化后的用户 ID
 */
export async function getFormattedUserId(): Promise<string> {
  return UserIdService.getInstance().getFormattedId();
}

/**
 * 检查是否已有用户 ID
 */
export async function hasUserId(): Promise<boolean> {
  return UserIdService.getInstance().hasUserId();
}

/**
 * 生成新的用户 ID
 */
export async function generateNewUserId(): Promise<string> {
  return UserIdService.getInstance().generateNewId();
}
