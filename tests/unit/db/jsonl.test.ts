import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { JSONLDatabase } from '../../../src/lib/db/jsonl';

describe('JSONL Database', () => {
  let db: JSONLDatabase;
  const testPath = 'D:/project/exomind-dev-chat/test_db.jsonl';

  beforeEach(() => {
    try { unlinkSync(testPath); } catch {}
    db = new JSONLDatabase(testPath);
  });

  it('should create file if not exists', () => {
    const testFile = 'D:/project/exomind-dev-chat/new_db.jsonl';
    try { unlinkSync(testFile); } catch {}
    const newDb = new JSONLDatabase(testFile);
    expect(existsSync(testFile)).toBe(true);
  });

  it('should insert record', () => {
    db.insert({ id: '1', name: 'test', value: 123 });
    const records = db.all();
    expect(records.length).toBe(1);
    expect(records[0].name).toBe('test');
  });

  it('should update record', () => {
    db.insert({ id: '1', name: 'old' });
    db.update('1', { name: 'new' });
    const record = db.find('1');
    expect(record?.name).toBe('new');
  });

  it('should delete record', () => {
    db.insert({ id: '1', name: 'test' });
    db.delete('1');
    const records = db.all();
    expect(records.length).toBe(0);
  });

  it('should query with filter', () => {
    db.insert({ id: '1', type: 'a', value: 10 });
    db.insert({ id: '2', type: 'b', value: 20 });
    db.insert({ id: '3', type: 'a', value: 30 });

    const filtered = db.where({ type: 'a' });
    expect(filtered.length).toBe(2);
  });

  it('should support transaction (batch operations)', () => {
    db.transaction(() => {
      db.insert({ id: '1', name: 'a' });
      db.insert({ id: '2', name: 'b' });
      db.insert({ id: '3', name: 'c' });
    });

    const records = db.all();
    expect(records.length).toBe(3);
  });
});
