/**
 * WebStorageAdapter - Web 存储适配器
 */

import type { IStoragePort } from '../interfaces/storage.port.js';

export class WebStorageAdapter implements IStoragePort {
  async read<T>(key: string): Promise<T | null> {
    if (typeof window === 'undefined') return null;
    const data = localStorage.getItem(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(data));
  }

  async delete(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  }

  async exists(key: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(key) !== null;
  }

  async keys(): Promise<string[]> {
    if (typeof window === 'undefined') return [];
    return Object.keys(localStorage);
  }

  async clear(): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.clear();
  }
}
