import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database } from '../../../src/lib/db/sqlite';

describe('SQLite Base Operations', () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(':memory:');
  });

  afterAll(() => {
    db.close();
  });

  it('should create table', () => {
    const result = db.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER)', []);
    expect(result.changes).toBe(0);
    
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.length).toBe(1);
    expect(tables[0].name).toBe('test');
  });

  it('should insert record', () => {
    const result = db.execute(
      'INSERT INTO test (name, value) VALUES (?, ?)',
      ['test', 123]
    );
    expect(result.changes).toBe(1);
  });

  it('should query records', () => {
    const rows = db.query('SELECT * FROM test');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
  });

  it('should update record', () => {
    const result = db.execute(
      'UPDATE test SET value = ? WHERE name = ?',
      [456, 'test']
    );
    expect(result.changes).toBe(1);
  });

  it('should delete record', () => {
    const result = db.execute('DELETE FROM test WHERE name = ?', ['test']);
    expect(result.changes).toBe(1);
  });

  it('should support transaction', () => {
    db.transaction(() => {
      db.execute('INSERT INTO test (name, value) VALUES (?, ?)', ['t1', 1]);
      db.execute('INSERT INTO test (name, value) VALUES (?, ?)', ['t2', 2]);
    });

    const rows = db.query('SELECT COUNT(*) as count FROM test');
    expect(rows[0].count).toBe(2);
  });
});
