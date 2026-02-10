/**
 * Storage Port - 存储接口定义
 */
export interface IStoragePort {
  /** 读取数据 */
  read<T>(key: string): Promise<T | null>;
  /** 写入数据 */
  write<T>(key: string, data: T): Promise<void>;
  /** 删除数据 */
  delete(key: string): Promise<void>;
  /** 检查是否存在 */
  exists(key: string): Promise<boolean>;
  /** 获取所有键 */
  keys(): Promise<string[]>;
  /** 清空所有数据 */
  clear(): Promise<void>;
}
