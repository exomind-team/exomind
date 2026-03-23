/**
 * spark-md5 导入测试
 *
 * TDD 流程：
 * 1. 先写测试（预期失败 - 红）
 * 2. 开发者修复代码
 * 3. 运行测试确认通过（绿）
 */

import { describe, it, expect } from 'vitest';

// 测试 spark-md5 能否正确导入
describe('spark-md5 导入', () => {
  it('应该能导入 spark-md5 模块', async () => {
    // 动态导入 spark-md5
    let SparkMD5: unknown;
    try {
      const module = await import('spark-md5');
      SparkMD5 = module.default || module.SparkMD5 || module;
      expect(SparkMD5).toBeDefined();
    } catch (error) {
      // 如果导入失败，检查是否需要安装
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`spark-md5 导入失败: ${errorMessage}。需要安装: bun add spark-md5`);
    }
  });

  it('SparkMD5.hash 应该生成 MD5 哈希', async () => {
    // spark-md5 导出结构: { default, hash, hashBinary, ... }
    const module = await import('spark-md5');

    // hash 是 named export，可以直接使用
    const hash = module.hash('test');

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(32); // MD5 哈希是 32 位十六进制
  });
});

describe('PouchDB spark-md5 兼容性', () => {
  it('PouchDB 应该能正常工作', async () => {
    const PouchDB = (await import('pouchdb')).default;

    expect(PouchDB).toBeDefined();
    expect(typeof PouchDB).toBe('function');
  });

  // 注意：内存数据库测试需要 pouchdb-memory 包
  // 当前仅测试 PouchDB 模块能正确导入
});
