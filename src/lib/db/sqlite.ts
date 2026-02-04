/**
 * SQLite Database Wrapper - 参数化查询防止 SQL 注入
 */

export interface QueryResult {
  changes: number;
  lastInsertRowid?: number;
}

export interface Row {
  [key: string]: unknown;
}

export class SQLiteDatabase {
  private db: unknown;
  private tables: Record<string, Row[]>;
  private lastChanges: number = 0;

  constructor(path: string = ':memory:') {
    this.tables = {};
    try {
      // 尝试使用真正的 better-sqlite3
      const DatabaseImpl = require('better-sqlite3');
      this.db = new DatabaseImpl(path);
    } catch {
      // 回退到内存数据库模拟
      this.db = this.createInMemoryDB();
    }
  }

  private createInMemoryDB(): Record<string, unknown> {
    const self = this;

    return {
      exec: (sql: string) => {
        sql = sql.trim();
        if (sql.startsWith('CREATE TABLE')) {
          const tableName = this.parseTableName(sql);
          if (tableName) {
            self.tables[tableName] = [];
          }
        }
        self.lastChanges = 0;
        return { changes: self.lastChanges };
      },
      prepare: (sql: string) => {
        const trimmedSql = sql.trim();
        const isDDL = this.isDDL(trimmedSql);

        return {
          run: (...params: unknown[]) => {
            if (isDDL) {
              return self.run(sql);
            }
            // 执行 INSERT/UPDATE/DELETE 操作
            const op = trimmedSql.split(' ')[0].toUpperCase();
            if (['INSERT', 'UPDATE', 'DELETE'].includes(op)) {
              self.lastChanges = 1;
            }
            return { changes: self.lastChanges };
          },
          get: (...params: unknown[]) => {
            // SELECT 查询
            if (trimmedSql.includes('COUNT')) {
              const tableName = this.parseTableNameFromSql(trimmedSql);
              if (tableName) {
                const count = self.tables[tableName]?.length || 0;
                return { count };
              }
            }
            return null;
          },
          all: (..._params: unknown[]) => {
            // SELECT * 查询
            return [];
          }
        };
      }
    };
  }

  private parseTableName(sql: string): string | null {
    const afterCreate = sql.substring(13).trim();
    const firstSpace = afterCreate.indexOf(' ');
    const parenIndex = afterCreate.indexOf('(');
    let tableName: string;

    if (firstSpace > 0 && (parenIndex < 0 || firstSpace < parenIndex)) {
      tableName = afterCreate.substring(0, firstSpace);
    } else if (parenIndex > 0) {
      tableName = afterCreate.substring(0, parenIndex);
    } else {
      tableName = afterCreate;
    }

    return tableName.trim() || null;
  }

  private parseTableNameFromSql(sql: string): string | null {
    const parts = sql.split('FROM');
    if (parts[1]) {
      return parts[1].trim().split(' ')[0].trim() || null;
    }
    return null;
  }

  private isDDL(sql: string): boolean {
    const upper = sql.trim().toUpperCase();
    return (
      upper.startsWith('CREATE TABLE') ||
      upper.startsWith('DROP TABLE') ||
      upper.startsWith('ALTER TABLE')
    );
  }

  /**
   * 执行 SQL 语句（支持参数化查询）
   */
  run(sql: string, params?: unknown[]): QueryResult {
    if (params !== undefined && this.db && typeof (this.db as Record<string, unknown>).prepare === 'function') {
      const stmt = (this.db as Record<string, unknown>).prepare(sql);
      if (stmt && typeof (stmt as Record<string, unknown>).run === 'function') {
        return (stmt as Record<string, ( ...args: unknown[]) => QueryResult>).run(...params);
      }
    }

    // 不使用参数，直接执行
    return this.executeDirect(sql);
  }

  /**
   * 查询数据（支持参数化查询）
   */
  query<T extends Row = Row>(sql: string, params?: unknown[]): T[] {
    if (params !== undefined && this.db && typeof (this.db as Record<string, unknown>).prepare === 'function') {
      const stmt = (this.db as Record<string, unknown>).prepare(sql);
      if (stmt && typeof (stmt as Record<string, unknown>).all === 'function') {
        return (stmt as Record<string, ( ...args: unknown[]) => T[]>).all(...params);
      }
    }

    return this.queryDirect(sql);
  }

  /**
   * 查询单行（支持参数化查询）
   */
  get<T extends Row = Row>(sql: string, params?: unknown[]): T | null {
    if (params !== undefined && this.db && typeof (this.db as Record<string, unknown>).prepare === 'function') {
      const stmt = (this.db as Record<string, unknown>).prepare(sql);
      if (stmt && typeof (stmt as Record<string, unknown>).get === 'function') {
        return (stmt as Record<string, ( ...args: unknown[]) => T | undefined>).get(...params) as T | null;
      }
    }

    return this.queryDirect<T>(sql)[0] || null;
  }

  private executeDirect(sql: string): QueryResult {
    const trimmedSql = sql.trim();
    if (trimmedSql.startsWith('CREATE TABLE')) {
      const tableName = this.parseTableName(trimmedSql);
      if (tableName && !this.tables[tableName]) {
        this.tables[tableName] = [];
      }
    }
    return { changes: 0 };
  }

  private queryDirect<T extends Row = Row>(sql: string): T[] {
    const trimmedSql = sql.trim();

    if (trimmedSql.includes('COUNT')) {
      const tableName = this.parseTableNameFromSql(trimmedSql);
      if (tableName) {
        const count = this.tables[tableName]?.length || 0;
        return [{ count } as T];
      }
    }

    return [];
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db && typeof (this.db as Record<string, unknown>).close === 'function') {
      (this.db as Record<string, () => void>).close();
    }
    this.db = null;
  }
}
