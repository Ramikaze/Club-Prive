// node:sqlite version of the database adapter (see db.js), used by the tests.
import { DatabaseSync } from 'node:sqlite';

export function nodeDb(file) {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const statements = new Map();
  const st = (query) => {
    let s = statements.get(query);
    if (!s) {
      s = db.prepare(query);
      statements.set(query, s);
    }
    return s;
  };
  return {
    get: (query, ...params) => st(query).get(...params),
    all: (query, ...params) => st(query).all(...params),
    run(query, ...params) {
      const r = st(query).run(...params);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    exec(query) {
      db.exec(query);
    },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw err;
      }
    },
    close: () => db.close(),
  };
}
