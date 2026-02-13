/**
 * Node.js Storage Adapter
 *
 * Provides PouchDB with Node.js adapter for MCP server
 */

import PouchDB from 'pouchdb';
import PouchDBNode from 'pouchdb-node';

// Use Node.js adapter for server-side storage
const PouchDBAdapter = PouchDB.defaults({
  adapter: 'node',
  db: (name: string) => new PouchDBNode(name),
});

// Re-export with the adapter
export { PouchDBAdapter as PouchDB };

// Export a factory function to create databases
export function createDatabase(name: string) {
  return new PouchDB(name, { adapter: 'node' });
}
