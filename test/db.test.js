// The database adapter of the Durable Object (worker/db.js). Its SQL runs on Cloudflare only: every other test
// uses node:sqlite (db-node.js), which takes a typed array as it is. What the adapter does to the values on their
// way to the storage is checked here, with a storage whose `sql.exec` writes down the bindings it is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durableDb } from '../worker/db.js';

const QUERY = 'INSERT INTO product_photos (product_id, data) VALUES (?, ?)';
const METHODS = ['get', 'all', 'run']; // the three ways of running a statement with values

// The values the storage receives when the database is called as `method` with `values`.
function received(method, ...values) {
  const calls = [];
  const sql = {
    exec(query, ...bindings) {
      calls.push({ query, bindings });
      return { toArray: () => [], one: () => ({ changes: 0, id: 0 }) };
    },
  };
  durableDb({ sql })[method](QUERY, ...values);
  assert.equal(calls[0].query, QUERY);
  return calls[0].bindings;
}

const bytesOf = (buffer) => [...new Uint8Array(buffer)];

test('BLOB : un Uint8Array entier part en ArrayBuffer de sa taille exacte, à sa place parmi les autres valeurs', () => {
  for (const method of METHODS) {
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3);
    const [id, blob, label] = received(method, 5, bytes, 'après');
    assert.equal(id, 5, method);
    assert.ok(blob instanceof ArrayBuffer, method);
    assert.equal(blob.byteLength, 7, method);
    assert.deepEqual(bytesOf(blob), [...bytes], method);
    assert.equal(label, 'après', method);
  }
});

test('BLOB : une partie d’un tampon part en copie de sa seule taille, jamais le tampon entier', () => {
  for (const method of METHODS) {
    const pool = Uint8Array.of(9, 9, 1, 2, 3, 9, 9, 9);
    // Its start, its middle, its end: the buffer behind each is bigger than the bytes it shows.
    for (const [part, expected] of [[pool.subarray(0, 3), [9, 9, 1]], [pool.subarray(2, 5), [1, 2, 3]], [pool.subarray(5), [9, 9, 9]]]) {
      assert.equal(part.buffer.byteLength, 8);
      const [blob] = received(method, part);
      assert.ok(blob instanceof ArrayBuffer, `${method} ${expected}`);
      assert.notEqual(blob, pool.buffer, `${method} ${expected}`);
      assert.equal(blob.byteLength, expected.length, `${method} ${expected}`);
      assert.deepEqual(bytesOf(blob), expected, `${method} ${expected}`);
    }
    assert.deepEqual([...pool], [9, 9, 1, 2, 3, 9, 9, 9]); // the bytes it was cut from are as they were
  }
});

test('BLOB : les autres valeurs passent telles quelles, qu’un Uint8Array voyage avec elles ou non', () => {
  const buffer = new ArrayBuffer(4); // already what the storage takes
  const others = [null, 7, 2.5, 'texte', 10n, buffer];
  for (const method of METHODS) {
    for (const values of [others, [...others, Uint8Array.of(1, 2)]]) {
      const bindings = received(method, ...values);
      assert.equal(bindings.length, values.length, method);
      others.forEach((value, i) => assert.equal(bindings[i], value, `${method} ${i}`));
    }
  }
  assert.deepEqual(received('get'), []); // and a statement without values has none
});
