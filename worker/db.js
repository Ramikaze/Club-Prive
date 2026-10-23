// Database adapter over the Durable Object's SQLite storage. The business layer only uses
// get / all / run / exec / transaction, so the same code runs on node:sqlite in tests (db-node.js).

// A BLOB goes in as an ArrayBuffer, the type the storage documents. The business layer hands over typed
// arrays (a photo's bytes): each one crosses as its own bytes and nothing else of the buffer behind it.
// Every other value is passed on as it is.
const asBinary = (value) => {
  if (!ArrayBuffer.isView(value)) return value;
  const whole = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength;
  return whole ? value.buffer : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
};
const bound = (params) => (params.some((value) => ArrayBuffer.isView(value)) ? params.map(asBinary) : params);

export function durableDb(storage) {
  const sql = storage.sql;
  return {
    get: (query, ...params) => sql.exec(query, ...bound(params)).toArray()[0],
    all: (query, ...params) => sql.exec(query, ...bound(params)).toArray(),
    run(query, ...params) {
      sql.exec(query, ...bound(params)).toArray();
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
