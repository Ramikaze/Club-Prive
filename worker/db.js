// Database adapter over the Durable Object's SQLite storage. The business layer only uses
// get / all / run / exec / transaction, so the same code runs on node:sqlite in tests (db-node.js).
export function durableDb(storage) {
  const sql = storage.sql;
  return {
    get: (query, ...params) => sql.exec(query, ...params).toArray()[0],
    all: (query, ...params) => sql.exec(query, ...params).toArray(),
    run(query, ...params) {
      sql.exec(query, ...params).toArray();
      const r = sql.exec('SELECT changes() AS changes, last_insert_rowid() AS id').one();
      return { changes: r.changes, lastId: r.id };
    },
    exec(query) {
      sql.exec(query);
    },
    // Synchronous: nothing else runs in the object until the function returns. A throw rolls back.
    transaction: (fn) => storage.transactionSync(fn),
  };
}
