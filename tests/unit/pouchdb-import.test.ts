/**
 * 测试 PouchDB 动态导入
 */

import { describe, expect, it } from 'vitest';

describe('PouchDB dynamic import', () => {
  it('should correctly import PouchDB and instantiate', async () => {
    // 动态导入 PouchDB
    const pouchdb = await import('pouchdb');

    console.log('PouchDB module keys:', Object.keys(pouchdb));
    console.log('PouchDB default:', pouchdb.default);
    console.log('PouchDB is function:', typeof pouchdb.default);

    // 检查是否有 default 导出
    if (pouchdb.default) {
      // 创建数据库实例
      const PouchDB = pouchdb.default;
      console.log('Creating test database...');

      const db = new PouchDB('test_db');
      console.log('Database created:', db);

      // 清理
      await db.destroy();
      console.log('Database destroyed');
    }
  });
});
