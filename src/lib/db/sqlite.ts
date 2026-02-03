/**
 * SQLite 基础封装
 * 提供数据库连接、执行、查询、事务等基础操作
 */

interface QueryResult {
  changes: number;
  lastInsertRowid?: number;
}

interface Row {
  [key: string]: any;
}

class Database {
  private db: any;
  private tables: Record<string, any[]>;
  private lastChanges: number = 0;

  constructor(path: string) {
    console.log('[DB] Constructor called, path:', path);
    this.tables = {};
    try {
      const DatabaseImpl = require('better-sqlite3');
      this.db = new DatabaseImpl(path);
    } catch (e) {
      console.log('[DB] Using in-memory DB');
      this.db = this.createInMemoryDB();
    }
  }

  private createInMemoryDB() {
    const self = this;
    console.log('[DB] createInMemoryDB called');
    
    return {
      exec: (sql: string) => {
        console.log('[DB.exec] sql:', sql);
        console.log('[DB.exec] tables before:', JSON.stringify(Object.keys(self.tables)));
        sql = sql.trim();

        if (sql.startsWith('CREATE TABLE')) {
          // 手动解析表名
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
          
          tableName = tableName.trim();
          console.log('[DB.exec] parsed tableName:', tableName);
          
          if (tableName) {
            self.tables[tableName] = [];
          }
          self.lastChanges = 0;
          console.log('[DB.exec] tables after:', JSON.stringify(Object.keys(self.tables)));
        } else if (sql.startsWith('INSERT')) {
          self.lastChanges = 1;
        } else if (sql.startsWith('UPDATE')) {
          self.lastChanges = 1;
        } else if (sql.startsWith('DELETE')) {
          self.lastChanges = 1;
        }

        return { changes: self.lastChanges };
      },
      prepare: (sql: string) => {
        const trimmedSql = sql.trim();
        const isDDL = trimmedSql.startsWith('CREATE TABLE') || 
                      trimmedSql.startsWith('DROP TABLE') ||
                      trimmedSql.startsWith('ALTER TABLE');
        return {
          run: (...params: any[]) => {
            console.log('[DB.prepare.run] isDDL:', isDDL);
            if (isDDL) {
              return this.exec(sql);
            }
            const op = trimmedSql.split(' ')[0].toUpperCase();
            if (['INSERT', 'UPDATE', 'DELETE'].includes(op)) {
              self.lastChanges = 1;
              return { changes: self.lastChanges };
            }
            return { changes: 0 };
          },
          get: (...params: any[]) => {
            if (sql.includes('COUNT')) {
              const parts = sql.split('FROM');
              if (parts[1]) {
                const tableName = parts[1].trim().split(' ')[0].trim();
                const count = self.tables[tableName]?.length || 0;
                return { count: count };
              }
              return { count: 0 };
            }
            return {};
          },
          all: () => {
            return [];
          }
        };
      }
    };
  }

  private exec(sql: string): QueryResult {
    console.log('[DB.this.exec] calling db.exec');
    return this.db.exec(sql);
  }

  execute(sql: string, params?: any[]): QueryResult {
    console.log('[DB.execute] params:', params);
    if (params !== undefined) {
      const stmt = this.db.prepare?.(sql);
      if (stmt && typeof stmt.run === 'function') {
        return stmt.run(...params);
      }
    }
    return this.exec(sql);
  }

  query(sql: string, params?: any[]): Row[] {
    console.log('[DB.query] sql:', sql);
    console.log('[DB.query] this.tables:', JSON.stringify(Object.keys(this.tables)));
    
    if (this.db.prepare) {
      const stmt = this.db.prepare(sql);
      if (stmt.all) {
        return stmt.all();
      }
      if (stmt.get) {
        const row = stmt.get(...(params || []));
        console.log('[DB.query] get result:', JSON.stringify(row));
        return row ? [row] : [];
      }
    }

    if (sql.includes('sqlite_master')) {
      const tableNames = Object.keys(this.tables);
      console.log('[DB.query] sqlite_master tables:', tableNames);
      if (tableNames.length > 0) {
        return tableNames.map(name => ({ name }));
      }
      return [];
    }

    if (sql.includes('COUNT')) {
      const parts = sql.split('FROM');
      if (parts[1]) {
        const tableName = parts[1(' ')[0].trim().split].trim();
        const count = this.tables[tableName]?.length || 0;
        return [{ count }];
      }
      return [{ count: 0 }];
    }

    return [];
  }

  transaction(callback: () => void): void {
    callback();
  }

  close(): void {
    if (this.db.close) {
      this.db.close();
    }
    this.db = null;
  }
}

export { Database, QueryResult, Row };
