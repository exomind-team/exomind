import { existsSync, readFileSync, writeFileSync } from 'fs';

export class JSONLDatabase {
  private path: string;

  constructor(path: string) {
    this.path = path;
    // 确保文件存在
    if (!existsSync(path)) {
      writeFileSync(path, '');
    }
  }

  private readAll(): Record<string, unknown>[] {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, 'utf-8');
    if (!content.trim()) return [];
    return content.trim().split('\n').map(line => JSON.parse(line));
  }

  private writeAll(records: Record<string, unknown>[]): void {
    const content = records.map(r => JSON.stringify(r)).join('\n');
    writeFileSync(this.path, content);
  }

  insert(record: Record<string, unknown>): void {
    const records = this.readAll();
    records.push(record);
    this.writeAll(records);
  }

  all(): Record<string, unknown>[] {
    return this.readAll();
  }

  find(id: string): Record<string, unknown> | null {
    const records = this.readAll();
    return records.find(r => r.id === id) || null;
  }

  update(id: string, data: Record<string, unknown>): void {
    const records = this.readAll();
    const index = records.findIndex(r => r.id === id);
    if (index !== -1) {
      records[index] = { ...records[index], ...data };
      this.writeAll(records);
    }
  }

  delete(id: string): void {
    const records = this.readAll();
    const filtered = records.filter(r => r.id !== id);
    this.writeAll(filtered);
  }

  where(filter: Record<string, unknown>): Record<string, unknown>[] {
    const records = this.readAll();
    return records.filter(r => {
      return Object.entries(filter).every(([key, value]) => r[key] === value);
    });
  }

  transaction(fn: () => void): void {
    fn();
  }
}
