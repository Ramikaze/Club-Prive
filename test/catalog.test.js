// Catalogue photos and catalogue import: the three photo routes, the version of a photo in the product
// lists, the temporary import door (POST /api/admin/catalog-import) and the real catalogue copied into
// the demo space. Pictures are built here from their signature bytes: the server tells a format by those.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../worker/auth.js';
import { MIGRATIONS, migrate } from '../worker/schema.js';
import { nodeDb } from '../worker/db-node.js';
import { Server, Site, Client, ok, ORIGIN, UM } from './harness.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const PROPRIO = 'mot-de-passe-proprio';
const GERANT = 'mot-de-passe-gerant';
const IMPORT_TOKEN = 'code-import-test';
const PHOTO_MAX = 200 * 1024;

// A real club with its administrator and a manager signed in. `env`: the Worker's secrets.
async function setup({ env = {} } = {}) {
  const server = new Server(env);
  servers.push(server);
  await server.start();
  await server.addUser('proprietaire', 'Propriétaire', 'admin', PROPRIO);
  await server.addUser('gerant', 'Gérant', 'gerant', GERANT);
  const admin = new Client(server);
  await admin.login('proprietaire', PROPRIO);
  const manager = new Client(server);
  await manager.login('gerant', GERANT);
  return { server, admin, manager };
}

// The same, with an empty demo space beside it.
async function withDemo({ env = {} } = {}) {
  const spaces = await setup({ env });
  const demo = new Server(env, { demo: true });
  servers.push(demo);
  await demo.start();
  return { ...spaces, real: spaces.server, demo };
}

// A client of the demo space serving the real club's signed-in `client`: the Worker's two steps, taken
// at every call so that the configuration handed over is the real club's as it is then.
const sessionHash = (client) => sha256Hex(decodeURIComponent(client.cookie.split('=')[1]));
const inDemo = (real, demo, client) => new Client({
  fetch: async (url, init) => demo.api.handleDemo(
    new Request(ORIGIN + url, init), structuredClone(real.api.demoContext(await sessionHash(client))),
  ),
});

const SIGNATURE = {
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
};

// A picture of `size` bytes: the signature of its format, then `fill`. Gives the bytes and the request body.
function picture(mime = 'image/jpeg', size = 600, fill = 7) {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set(SIGNATURE[mime]);
  return { bytes, body: { mime, data: Buffer.from(bytes).toString('base64') } };
}

// The photo route answers bytes, not JSON, which Client.call would read as text.
async function getPhoto(client, id, query = '') {
  const res = await client.server.fetch(`/api/products/${id}/photo${query}`, { headers: client.cookie ? { cookie: client.cookie } : {} });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const error = res.ok ? null : JSON.parse(new TextDecoder().decode(bytes)).error;
  return { status: res.status, headers: res.headers, bytes, error };
}

const newProduct = async (admin, extra = {}) => ok(await admin.post('/api/products', {
  category: 'cigare', name: 'Robusto test', reference: 'T-ROB', price: 10000 * UM, ...extra,
}));

// ---------------------------------------------------------------------------- the photo routes

test('photo : un administrateur l’ajoute, tout utilisateur connecté la relit telle quelle', async () => {
  const { admin, manager } = await setup();
  const p = await newProduct(admin);
  assert.equal(p.photo_version, null);

  const sent = picture('image/jpeg', 5000);
  const saved = ok(await admin.put(`/api/products/${p.id}/photo`, sent.body));
  assert.equal(saved.id, p.id);
  assert.equal(saved.name, 'Robusto test');
  assert.match(saved.photo_version, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

  for (const client of [admin, manager]) {
    const got = await getPhoto(client, p.id);
    assert.equal(got.status, 200);
    assert.deepEqual(got.bytes, sent.bytes);
    assert.equal(got.headers.get('content-type'), 'image/jpeg');
    assert.equal(got.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(got.headers.get('x-frame-options'), 'DENY');
    // Should a browser ever open the picture as a page, this lets it load and run nothing.
    assert.equal(got.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  }
  // The version in the address serves the browser's cache; the server does not read it.
  assert.deepEqual((await getPhoto(manager, p.id, `?v=${encodeURIComponent(saved.photo_version)}`)).bytes, sent.bytes);
  assert.deepEqual((await getPhoto(manager, p.id, '?v=autre-chose')).bytes, sent.bytes);
  assert.equal(ok(await manager.get('/api/products'))[0].photo_version, saved.photo_version);
});

test('photo : JPEG, PNG et WebP sont servis avec leur propre type, une seule photo par produit', async () => {
  const { server, admin, manager } = await setup();
  const p = await newProduct(admin);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/jpeg']) {
    const sent = picture(mime, 800, 3);
    ok(await admin.put(`/api/products/${p.id}/photo`, sent.body));
    const got = await getPhoto(manager, p.id);
    assert.equal(got.headers.get('content-type'), mime);
    assert.deepEqual(got.bytes, sent.bytes);
  }
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM product_photos').n, 1);
  const row = server.club.get('SELECT mime, bytes, updated_by FROM product_photos WHERE product_id = ?', p.id);
  assert.deepEqual({ ...row }, { mime: 'image/jpeg', bytes: 800, updated_by: server.club.userByLogin('proprietaire').id });
});

test('photo : sans session, 401 ; sans photo ou produit inconnu, 404', async () => {
  const { admin, manager, server } = await setup();
  const p = await newProduct(admin);
  ok(await admin.put(`/api/products/${p.id}/photo`, picture().body));
  const anonymous = new Client(server);

  const refused = await getPhoto(anonymous, p.id);
  assert.equal(refused.status, 401);
  assert.equal(refused.error.code, 'NON_CONNECTE');
  assert.equal((await anonymous.put(`/api/products/${p.id}/photo`, picture().body)).status, 401);

  const bare = await newProduct(admin, { name: 'Sans photo', reference: 'T-SANS' });
  for (const id of [bare.id, 9999]) {
    const missing = await getPhoto(manager, id);
    assert.equal(missing.status, 404, String(id));
    assert.equal(missing.error.code, 'INTROUVABLE');
    assert.equal(missing.headers.get('cache-control'), 'no-store'); // an error is never cached
  }
  assert.equal((await getPhoto(manager, 'abc')).status, 400);
});

test('photo : un gérant ne peut ni l’ajouter ni la retirer', async () => {
  const { admin, manager } = await setup();
  const p = await newProduct(admin);
  assert.equal((await manager.put(`/api/products/${p.id}/photo`, picture().body)).status, 403);
  assert.equal((await getPhoto(admin, p.id)).status, 404);

  const sent = picture('image/png', 700);
  ok(await admin.put(`/api/products/${p.id}/photo`, sent.body));
  const refused = await manager.del(`/api/products/${p.id}/photo`);
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error.code, 'INTERDIT');
  assert.deepEqual((await getPhoto(manager, p.id)).bytes, sent.bytes);
});

test('photo : 200 Ko au plus une fois décodée, la limite de 256 Ko des autres requêtes reste', async () => {
  const { admin } = await setup();
  const p = await newProduct(admin);
  const url = `/api/products/${p.id}/photo`;

  // Exactly 200 KB passes. In base64 it is 273 KB of text: the photo routes read a larger body.
  const edge = picture('image/jpeg', PHOTO_MAX);
  ok(await admin.put(url, edge.body));
  assert.deepEqual((await getPhoto(admin, p.id)).bytes, edge.bytes);

  const heavy = await admin.put(url, picture('image/jpeg', PHOTO_MAX + 1, 9).body);
  assert.equal(heavy.status, 400);
  assert.equal(heavy.data.error.message, 'Photo trop lourde : 200 Ko au plus.');
  assert.deepEqual((await getPhoto(admin, p.id)).bytes, edge.bytes); // the photo it would have replaced is still there

  // A body far beyond even that is turned away before anything is read of it.
  assert.equal((await admin.put(url, picture('image/jpeg', 400 * 1024).body)).status, 413);
  // Elsewhere a body is still limited to 256 KB.
  const long = await admin.post('/api/products', { category: 'cigare', name: 'Trop long', reference: 'T-LONG', price: UM, description: 'x'.repeat(260 * 1024) });
  assert.equal(long.status, 413);
});

test('photo : format hors liste, contenu qui n’est pas ce qu’annonce le type, données illisibles : 400, rien n’est gardé', async () => {
  const { admin, server } = await setup();
  const p = await newProduct(admin);
  const url = `/api/products/${p.id}/photo`;
  const text = (s) => Buffer.from(s).toString('base64');
  const riffWave = new Uint8Array(40).fill(1);
  riffWave.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); // RIFF....WAVE: a sound, not a WebP
  const jpeg = picture('image/jpeg').body.data;

  for (const [label, body] of [
    ['GIF', { mime: 'image/gif', data: jpeg }],
    ['SVG, qui peut porter des scripts', { mime: 'image/svg+xml', data: text('<svg xmlns="http://www.w3.org/2000/svg"/>') }],
    ['HTML', { mime: 'text/html', data: text('<html></html>') }],
    ['type absent', { data: jpeg }],
    ['type non textuel', { mime: 7, data: jpeg }],
    ['PNG annoncé en JPEG', { mime: 'image/jpeg', data: picture('image/png').body.data }],
    ['JPEG annoncé en PNG', { mime: 'image/png', data: jpeg }],
    ['JPEG annoncé en WebP', { mime: 'image/webp', data: jpeg }],
    ['RIFF qui n’est pas un WebP', { mime: 'image/webp', data: Buffer.from(riffWave).toString('base64') }],
    ['texte annoncé en JPEG', { mime: 'image/jpeg', data: text('ceci n’est pas une image') }],
    ['base64 invalide', { mime: 'image/jpeg', data: '!!!pas du base64!!!' }],
    ['base64 mal rempli', { mime: 'image/jpeg', data: jpeg.slice(0, -1) }],
    ['base64 avec un espace', { mime: 'image/jpeg', data: `${jpeg.slice(0, 8)} ${jpeg.slice(8)}` }],
    ['données absentes', { mime: 'image/jpeg' }],
    ['données vides', { mime: 'image/jpeg', data: '' }],
    ['données non textuelles', { mime: 'image/jpeg', data: [255, 216, 255] }],
  ]) {
    const r = await admin.put(url, body);
    assert.equal(r.status, 400, label);
    assert.equal(r.data.error.code, 'INVALIDE', label);
  }
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM product_photos').n, 0);
  assert.equal((await getPhoto(admin, p.id)).status, 404);
  // The type may be written in capitals, not the content.
  ok(await admin.put(url, { ...picture('image/png').body, mime: ' IMAGE/PNG ' }));
  assert.equal((await getPhoto(admin, p.id)).headers.get('content-type'), 'image/png');
});

test('photo : retirer la rend introuvable ; une photo déjà absente ou un produit inconnu ne cassent rien', async () => {
  const { admin, manager, server } = await setup();
  const p = await newProduct(admin);
  ok(await admin.put(`/api/products/${p.id}/photo`, picture().body));
  assert.ok(ok(await manager.get('/api/products'))[0].photo_version);

  const removed = ok(await admin.del(`/api/products/${p.id}/photo`));
  assert.equal(removed.id, p.id);
  assert.equal(removed.photo_version, null);
  assert.equal((await getPhoto(manager, p.id)).status, 404);
  assert.equal(ok(await manager.get('/api/products'))[0].photo_version, null);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM product_photos').n, 0);

  // Removing a photo that is not there answers the same way and writes nothing to the journal.
  const journal = server.club.auditLog().length;
  assert.equal(ok(await admin.del(`/api/products/${p.id}/photo`)).photo_version, null);
  assert.equal(server.club.auditLog().length, journal);

  assert.equal((await admin.put('/api/products/9999/photo', picture().body)).status, 404);
  assert.equal((await admin.del('/api/products/9999/photo')).status, 404);
  assert.equal((await admin.put('/api/products/abc/photo', picture().body)).status, 400);
});

test('photo : le journal garde qui a ajouté, remplacé, retiré — jamais l’image', async () => {
  const { admin, server } = await setup();
  const p = await newProduct(admin);
  ok(await admin.put(`/api/products/${p.id}/photo`, picture('image/jpeg', 3000).body));
  ok(await admin.put(`/api/products/${p.id}/photo`, picture('image/png', 4000).body));
  ok(await admin.del(`/api/products/${p.id}/photo`));

  const entries = server.club.auditLog().filter((a) => a.action.startsWith('produit.photo'));
  assert.deepEqual(entries.map((a) => a.action), ['produit.photo_retirer', 'produit.photo', 'produit.photo']);
  assert.ok(entries.every((a) => a.entity === 'product' && a.entity_id === p.id && a.user_name === 'Propriétaire'));
  assert.deepEqual(entries[2].details, { mime: 'image/jpeg', bytes: 3000, replaced: false });
  assert.deepEqual(entries[1].details, { mime: 'image/png', bytes: 4000, replaced: true });
  assert.ok(entries.every((a) => JSON.stringify(a.details ?? {}).length < 100));
});

test('photo_version : la date de la photo, nulle sans photo, partout où un produit est rendu', async () => {
  const { admin, manager } = await setup();
  const withPhoto = await newProduct(admin, { name: 'Avec photo', reference: 'T-AVEC' });
  const without = await newProduct(admin, { name: 'Sans photo', reference: 'T-SANS' });
  const hidden = await newProduct(admin, { name: 'Retiré de la vente', reference: 'T-RETIRE' });
  const saved = ok(await admin.put(`/api/products/${withPhoto.id}/photo`, picture().body));
  const savedHidden = ok(await admin.put(`/api/products/${hidden.id}/photo`, picture('image/png').body));
  ok(await admin.put(`/api/products/${hidden.id}`, { active: false }));

  const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p.photo_version]));
  assert.deepEqual(byId(ok(await manager.get('/api/products'))), { [withPhoto.id]: saved.photo_version, [without.id]: null });
  assert.deepEqual(byId(ok(await admin.get('/api/products?all=1'))), {
    [withPhoto.id]: saved.photo_version, [without.id]: null, [hidden.id]: savedHidden.photo_version,
  });
  // The product's other answers carry it too: an update, a stock entry, the stock alerts of the dashboard.
  assert.equal(ok(await admin.put(`/api/products/${withPhoto.id}`, { price: 9000 * UM })).photo_version, saved.photo_version);
  assert.equal(ok(await manager.post(`/api/products/${withPhoto.id}/stock`, { kind: 'entree', quantity: 1 })).photo_version, saved.photo_version);
  const alerts = ok(await manager.get('/api/dashboard')).stock_alerts;
  assert.equal(alerts.find((p) => p.id === withPhoto.id).photo_version, saved.photo_version);
  assert.equal(alerts.find((p) => p.id === without.id).photo_version, null);
  // Lists carry the version, never a picture.
  for (const p of ok(await admin.get('/api/products?all=1'))) assert.ok(!('data' in p) && !('bytes' in p), p.name);
});

test('photo_version : change à chaque remplacement, même dans la même milliseconde ou quand l’horloge recule', async () => {
  const { admin, server } = await setup();
  const p = await newProduct(admin);
  const url = `/api/products/${p.id}/photo`;
  const at = (iso) => { server.club.at = Date.parse(iso); };

  at('2026-10-23T10:00:00.000Z');
  const first = ok(await admin.put(url, picture('image/jpeg', 500, 1).body)).photo_version;
  assert.equal(first, '2026-10-23T10:00:00.000Z');
  const second = ok(await admin.put(url, picture('image/jpeg', 500, 2).body)).photo_version; // same instant
  assert.ok(second > first, `${second} > ${first}`);
  at('2026-10-23T09:59:59.000Z'); // the clock went back
  const third = ok(await admin.put(url, picture('image/jpeg', 500, 3).body)).photo_version;
  assert.ok(third > second, `${third} > ${second}`);
  at('2026-10-23T11:00:00.000Z');
  assert.equal(ok(await admin.put(url, picture('image/jpeg', 500, 4).body)).photo_version, '2026-10-23T11:00:00.000Z');
  server.club.at = null;
});

test('photos : « Effacer toutes les données » les efface avant les produits', async () => {
  const { admin, server } = await setup();
  const p = await newProduct(admin);
  ok(await admin.put(`/api/products/${p.id}/photo`, picture().body));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM product_photos').n, 1);

  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM product_photos').n, 0);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM products').n, 0);
  const { tables } = server.club.auditLog().find((a) => a.action === 'donnees.effacer').details;
  assert.ok(tables.indexOf('product_photos') >= 0 && tables.indexOf('product_photos') < tables.indexOf('products'), tables.join(' '));
});

test('table des photos : un seul enregistrement par produit, types limités, produit existant', async () => {
  const { admin, server } = await setup();
  const p = await newProduct(admin);
  const columns = server.club.all('PRAGMA table_info(product_photos)').map((c) => `${c.name} ${c.type}`).sort();
  assert.deepEqual(columns, ['bytes INTEGER', 'data BLOB', 'mime TEXT', 'product_id INTEGER', 'updated_at TEXT', 'updated_by INTEGER']);

  const insert = (id, mime) => server.club.run(
    "INSERT INTO product_photos (product_id, mime, bytes, updated_at, data) VALUES (?, ?, 1, '2026-10-23T10:00:00.000Z', x'ff')", id, mime,
  );
  assert.throws(() => insert(p.id, 'image/gif'), /constraint/i);
  assert.throws(() => insert(9999, 'image/png'), /constraint/i); // no such product
  insert(p.id, 'image/png');
  assert.throws(() => insert(p.id, 'image/png'), /constraint/i); // one photo per product
});

test('migration v12 vers v13 : la table des photos est ajoutée, les produits existants restent', () => {
  const db = nodeDb(':memory:');
  try {
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const version of MIGRATIONS.slice(0, 12)) for (const sql of version) db.exec(sql);
    db.run("INSERT INTO meta VALUES ('schema_version', '12')");
    db.run("INSERT INTO products (id, category, name, reference, price, created_at) VALUES (5, 'cigare', 'Ancien', 'CIG-005', 100, '2026-01-01T00:00:00Z')");
    migrate(db);
    migrate(db);
    assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.ok(MIGRATIONS.length >= 13);
    assert.equal(db.get('SELECT name FROM products WHERE id = 5').name, 'Ancien');
    assert.equal(db.get('SELECT COUNT(*) AS n FROM product_photos').n, 0);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------- the import door

const ITEM = { name: 'Cohiba Siglo I', price: 12500, category: 'cigare', description: 'Cigare cubain de petit format.' };

// The door has no session: a client without a cookie, and the secret in a header of its own.
const importWith = (client, body, token = IMPORT_TOKEN) => client.post(
  '/api/admin/catalog-import', body, token === null ? {} : { 'x-import-token': token },
);
const productCount = (server) => server.club.get('SELECT COUNT(*) AS n FROM products').n;

test('import : sans IMPORT_TOKEN configuré, la porte répond 503 et rien n’est créé', async () => {
  const { server } = await setup();
  const door = new Client(server);
  for (const token of [null, IMPORT_TOKEN, '']) {
    const r = await importWith(door, { item: ITEM }, token);
    assert.equal(r.status, 503, String(token));
    assert.equal(r.data.error.code, 'CODE_ABSENT');
  }
  assert.equal(productCount(server), 0);
  const empty = await setup({ env: { IMPORT_TOKEN: '' } }); // a secret left empty is no secret
  assert.equal((await importWith(new Client(empty.server), { item: ITEM }, '')).status, 503);
});

test('import : sans code ou avec un mauvais code, 403 ; une session d’administrateur n’y change rien', async () => {
  const { server, admin } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const journal = server.club.auditLog().length;

  // Four failures: a fifth would lock the door (next test).
  for (const [label, client, token] of [
    ['sans en-tête', door, null],
    ['mauvais code', door, 'mauvais-code'],
    ['code tronqué', door, IMPORT_TOKEN.slice(0, -1)],
    ['administrateur connecté, sans code', admin, null],
  ]) {
    const r = await importWith(client, { item: ITEM }, token);
    assert.equal(r.status, 403, label);
    assert.equal(r.data.error.code, 'CODE_INCORRECT', label);
  }
  assert.equal(productCount(server), 0);
  assert.equal(server.club.auditLog().length, journal);
});

test('import : cinq échecs de suite bloquent la porte une minute, même avec le bon code', async () => {
  const { server } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  for (let i = 0; i < 5; i += 1) assert.equal((await importWith(door, { item: ITEM }, 'mauvais-code')).status, 403);

  const locked = await importWith(door, { item: ITEM });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.error.code, 'TROP_DE_TENTATIVES');
  assert.equal(productCount(server), 0);
  // The installation code has its own count.
  assert.notEqual((await door.post('/api/setup/reset', { setup_token: 'x', login: 'a', password: 'b' })).status, 429);
});

// A call to the door with its body as written (the Client of the tests always sends JSON that parses). `declare`:
// says the body's length in the request, as a call over the network does.
const importRaw = (server, body, { token = IMPORT_TOKEN, declare = false } = {}) => server.fetch('/api/admin/catalog-import', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token === null ? {} : { 'x-import-token': token }),
    ...(declare ? { 'content-length': String(body.length) } : {}),
  },
  body,
});
const NOT_JSON = 'ceci n’est pas du JSON {';
const TOO_BIG = JSON.stringify({ item: ITEM, filler: 'x'.repeat(310 * 1024) }); // beyond the 300 KB the door reads

test('import : le code est vérifié avant le corps — sans le bon code, 403 quel que soit le corps', async () => {
  const { server } = await setup({ env: { IMPORT_TOKEN } });

  // Four failures: a fifth would lock the door.
  for (const [label, body, options] of [
    ['mauvais code, corps qui n’est pas du JSON', NOT_JSON, { token: 'mauvais-code' }],
    ['mauvais code, corps trop gros', TOO_BIG, { token: 'mauvais-code' }],
    ['mauvais code, corps trop gros et longueur annoncée', TOO_BIG, { token: 'mauvais-code', declare: true }],
    ['sans code, corps qui n’est pas du JSON', NOT_JSON, { token: null }],
  ]) {
    const r = await importRaw(server, body, options);
    assert.equal(r.status, 403, label);
    assert.equal((await r.json()).error.code, 'CODE_INCORRECT', label);
  }
  // With the right code the body is read, and refused as it always was.
  const unreadable = await importRaw(server, NOT_JSON);
  assert.equal(unreadable.status, 400);
  assert.equal((await unreadable.json()).error.code, 'INVALIDE');
  for (const declare of [false, true]) {
    const heavy = await importRaw(server, TOO_BIG, { declare });
    assert.equal(heavy.status, 413, String(declare));
    assert.equal((await heavy.json()).error.code, 'TROP_VOLUMINEUX');
  }
  assert.equal(productCount(server), 0);
});

test('import : un corps illisible ne dispense ni du compte des échecs, ni du blocage, ni du 503', async () => {
  const { server } = await setup({ env: { IMPORT_TOKEN } });
  for (let i = 0; i < 5; i += 1) assert.equal((await importRaw(server, NOT_JSON, { token: 'mauvais-code' })).status, 403, String(i));
  for (const body of [NOT_JSON, TOO_BIG]) {
    const locked = await importRaw(server, body); // the right code, a locked door
    assert.equal(locked.status, 429);
    assert.equal((await locked.json()).error.code, 'TROP_DE_TENTATIVES');
  }

  const bare = await setup(); // no IMPORT_TOKEN
  for (const body of [NOT_JSON, TOO_BIG]) {
    const absent = await importRaw(bare.server, body);
    assert.equal(absent.status, 503);
    assert.equal((await absent.json()).error.code, 'CODE_ABSENT');
  }
});

test('import : sans le bon code, le corps de la requête n’est même pas lu', async () => {
  const { server } = await setup({ env: { IMPORT_TOKEN } });
  const bare = await setup(); // no IMPORT_TOKEN
  // A request whose body is a stream that gives its bytes on demand only, and notes that it was asked for them.
  const watched = (token) => {
    const seen = { read: false };
    const body = new ReadableStream({
      pull(controller) {
        seen.read = true;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ item: ITEM })));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const request = new Request(`${ORIGIN}/api/admin/catalog-import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === null ? {} : { 'x-import-token': token }) },
      body,
      duplex: 'half',
    });
    return { seen, request };
  };

  for (const [label, door, token, status] of [
    ['mauvais code', server, 'mauvais-code', 403],
    ['sans code', server, null, 403],
    ['code non configuré', bare.server, IMPORT_TOKEN, 503],
  ]) {
    const { seen, request } = watched(token);
    assert.equal((await door.api.handle(request)).status, status, label);
    assert.equal(seen.read, false, label);
  }
  // The right code gets its body read, which shows the stream does tell.
  const { seen, request } = watched(IMPORT_TOKEN);
  assert.equal((await server.api.handle(request)).status, 200);
  assert.equal(seen.read, true);
  assert.equal(productCount(server), 1);
});

test('import : le bon code crée la fiche — CIG-001, prix ×100, stock 0, photo servie, journal sans auteur', async () => {
  const { server, admin, manager } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const sent = picture('image/jpeg', 4000, 5);

  const created = ok(await importWith(door, { item: { ...ITEM, photo: sent.body } }));
  assert.deepEqual(created, { id: created.id, reference: 'CIG-001', status: 'created', photo: true });
  const row = server.club.get('SELECT * FROM products WHERE id = ?', created.id);
  assert.deepEqual(
    [row.name, row.category, row.price, row.stock_qty, row.low_stock_threshold, row.active, row.is_demo, row.description, row.created_by],
    ['Cohiba Siglo I', 'cigare', 12500 * UM, 0, 3, 1, 0, 'Cigare cubain de petit format.', null],
  );
  assert.deepEqual((await getPhoto(manager, created.id)).bytes, sent.bytes);
  const listed = ok(await admin.get('/api/products')).find((p) => p.id === created.id);
  assert.equal(listed.price, 12500 * UM);
  assert.ok(listed.photo_version);
  assert.equal(listed.out, true);

  const entry = server.club.auditLog().find((a) => a.action === 'produit.importer');
  assert.equal(entry.user_id, null);
  assert.equal(entry.entity, 'product');
  assert.equal(entry.entity_id, created.id);
  assert.equal(entry.details.name, 'Cohiba Siglo I');
  assert.equal(entry.details.status, 'created');
  assert.ok(!JSON.stringify(entry.details).includes(IMPORT_TOKEN));

  // The next references: the cigars go on from CIG-001, the bottles have their own series.
  const next = ok(await importWith(door, { item: { name: 'Montecristo No 4', price: 9000, category: 'cigare' } }));
  assert.deepEqual(next, { id: next.id, reference: 'CIG-002', status: 'created', photo: false });
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM product_photos WHERE product_id = ?', next.id).n, 0);
  assert.equal(server.club.get('SELECT description FROM products WHERE id = ?', next.id).description, null);
  const bottle = ok(await importWith(door, { item: { name: 'Rhum vieux', price: 30000, category: 'bouteille' } }));
  assert.equal(bottle.reference, 'BOU-001');
  assert.equal(ok(await importWith(door, { item: { name: 'Partagas Serie D No 4', price: 10000, category: 'cigare' } })).reference, 'CIG-003');
});

test('import : les références suivent le plus grand numéro en service, pas les autres séries', async () => {
  const { server, admin } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  await newProduct(admin, { name: 'Choisi à la main', reference: 'CIG-041' });
  await newProduct(admin, { name: 'Autre série', reference: 'CIG-DEMO-99' });
  await newProduct(admin, { name: 'Bouteille', category: 'bouteille', reference: 'BOU-007' });

  assert.equal(ok(await importWith(door, { item: { name: 'Nouveau cigare', price: 5000, category: 'cigare' } })).reference, 'CIG-042');
  assert.equal(ok(await importWith(door, { item: { name: 'Nouvelle bouteille', price: 5000, category: 'bouteille' } })).reference, 'BOU-008');
});

test('import : même nom, aux majuscules et espaces près — mise à jour du prix, de la description et de la photo, sans doublon', async () => {
  const { server, admin, manager } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const first = picture('image/jpeg', 2000, 1);
  const created = ok(await importWith(door, { item: { ...ITEM, photo: first.body } }));
  const versionBefore = server.club.get('SELECT updated_at FROM product_photos WHERE product_id = ?', created.id).updated_at;

  // The owner took it off sale and counted some in meanwhile: the import leaves it off sale, the stock stays.
  ok(await admin.put(`/api/products/${created.id}`, { active: false, reference: 'MA-REF' }));
  ok(await manager.post(`/api/products/${created.id}/stock`, { kind: 'entree', quantity: 5 }));

  const second = picture('image/png', 2500, 2);
  const updated = ok(await importWith(door, {
    item: { name: '  COHIBA siglo i ', price: 13000, category: 'cigare', description: 'Nouvelle description.', photo: second.body },
  }));
  assert.deepEqual(updated, { id: created.id, reference: 'MA-REF', status: 'updated', photo: true });
  assert.equal(productCount(server), 1);
  const row = server.club.get('SELECT * FROM products WHERE id = ?', created.id);
  assert.deepEqual(
    [row.name, row.price, row.description, row.active, row.stock_qty, row.reference],
    ['Cohiba Siglo I', 13000 * UM, 'Nouvelle description.', 0, 5, 'MA-REF'],
  );
  const got = await getPhoto(manager, created.id);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(got.bytes, second.bytes);
  assert.ok(server.club.get('SELECT updated_at FROM product_photos WHERE product_id = ?', created.id).updated_at > versionBefore);
  assert.equal(server.club.auditLog().find((a) => a.action === 'produit.importer').details.status, 'updated');

  // Without a description or a photo in the call, the product keeps its own.
  const bare = ok(await importWith(door, { item: { name: 'cohiba siglo i', price: 14000, category: 'cigare' } }));
  assert.deepEqual(bare, { id: created.id, reference: 'MA-REF', status: 'updated', photo: true });
  const kept = server.club.get('SELECT price, description FROM products WHERE id = ?', created.id);
  assert.deepEqual({ ...kept }, { price: 14000 * UM, description: 'Nouvelle description.' });
  assert.deepEqual((await getPhoto(manager, created.id)).bytes, second.bytes);
  // An empty description clears it.
  ok(await importWith(door, { item: { name: 'Cohiba Siglo I', price: 14000, category: 'cigare', description: '' } }));
  assert.equal(server.club.get('SELECT description FROM products WHERE id = ?', created.id).description, null);
  assert.equal(productCount(server), 1);
});

test('import : une mise à jour n’apporte que le prix, la description et la photo — le reste du produit ne bouge pas', async () => {
  const { server, admin } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const created = ok(await importWith(door, { item: ITEM }));
  // What the owner did by hand since: another alert threshold, and the product off sale.
  ok(await admin.put(`/api/products/${created.id}`, { low_stock_threshold: 8, active: false }));
  const restOf = () => {
    const row = { ...server.club.get('SELECT * FROM products WHERE id = ?', created.id) };
    for (const column of ['price', 'description', 'updated_at', 'updated_by']) delete row[column];
    return row;
  };
  const before = restOf();
  assert.deepEqual([before.active, before.low_stock_threshold], [0, 8]);

  // With a new description, then with a photo.
  ok(await importWith(door, { item: { ...ITEM, price: 13000, description: 'Nouvelle description.' } }));
  ok(await importWith(door, { item: { ...ITEM, price: 14000, photo: picture().body } }));

  assert.deepEqual(restOf(), before);
  assert.deepEqual(ok(await admin.get('/api/products')), []); // still off sale
  const row = server.club.get('SELECT price, description, updated_by FROM products WHERE id = ?', created.id);
  assert.deepEqual({ ...row }, { price: 14000 * UM, description: ITEM.description, updated_by: null });
  // A product on sale stays on sale.
  ok(await admin.put(`/api/products/${created.id}`, { active: true }));
  ok(await importWith(door, { item: { ...ITEM, price: 15000 } }));
  assert.equal(ok(await admin.get('/api/products')).length, 1);
});

test('import : un produit de même nom mais d’une autre catégorie est refusé (409), sans rien écrire', async () => {
  const { server, admin } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const bottle = await newProduct(admin, { name: 'Havane Club', category: 'bouteille', reference: 'BOU-001', price: 30000 * UM, description: 'Un rhum.' });
  await newProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001', price: 12000 * UM });
  ok(await admin.put(`/api/products/${bottle.id}/photo`, picture('image/jpeg', 1500, 3).body));
  const state = () => ({
    products: server.club.all('SELECT * FROM products ORDER BY id').map((r) => ({ ...r })),
    photos: server.club.all('SELECT * FROM product_photos ORDER BY product_id').map((r) => ({ ...r })),
    journal: server.club.auditLog().length,
  });
  const before = state();

  for (const [name, category, message] of [
    [' HAVANE club ', 'cigare', "Le produit « Havane Club » existe déjà (catégorie bouteille) ; la fiche importée le range en cigare. Rien n'a été modifié."],
    ['cohiba siglo i', 'bouteille', "Le produit « Cohiba Siglo I » existe déjà (catégorie cigare) ; la fiche importée le range en bouteille. Rien n'a été modifié."],
  ]) {
    const r = await importWith(door, { item: { name, category, price: 99000, description: 'Autre texte.', photo: picture('image/png', 900).body } });
    assert.equal(r.status, 409, name);
    assert.equal(r.data.error.code, 'CATEGORIE_DIFFERENTE', name);
    assert.equal(r.data.error.message, message, name);
  }
  assert.deepEqual(state(), before); // no price, no description, no photo, no journal entry

  // The same names in their own category are the same products.
  assert.equal(ok(await importWith(door, { item: { name: 'havane club', category: 'bouteille', price: 31000 } })).id, bottle.id);
});

test('import : quand une bouteille et un cigare portent le même nom, la fiche met à jour celui de sa catégorie, et le journal garde le nom enregistré', async () => {
  const { server, admin } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const bottle = await newProduct(admin, { name: 'Havane Club', category: 'bouteille', reference: 'BOU-001', price: 30000 * UM });
  const cigar = await newProduct(admin, { name: 'Havane Club', reference: 'CIG-001', price: 12000 * UM });

  const r = ok(await importWith(door, { item: { name: ' HAVANE club ', category: 'cigare', price: 12500 } }));
  assert.deepEqual([r.id, r.status], [cigar.id, 'updated']);
  assert.equal(server.club.get('SELECT price FROM products WHERE id = ?', cigar.id).price, 12500 * UM);
  assert.equal(server.club.get('SELECT price FROM products WHERE id = ?', bottle.id).price, 30000 * UM);
  // The journal names the product as it is stored, not as the file spells it.
  assert.equal(server.club.auditLog().find((a) => a.action === 'produit.importer').details.name, 'Havane Club');
});

test('import : le journal d’une mise à jour garde le prix et la description remplacés, dans les unités de « produit.modifier »', async () => {
  const { server, admin } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const created = ok(await importWith(door, { item: { name: ITEM.name, price: 12500, category: 'cigare' } })); // no description
  ok(await importWith(door, { item: { ...ITEM, price: 13000, description: 'Nouvelle description.' } }));
  ok(await importWith(door, { item: { name: ITEM.name, price: 14000, category: 'cigare' } })); // no description: it stays
  ok(await admin.put(`/api/products/${created.id}`, { price: 15000 * UM }));

  // Newest first.
  const [edit, bare, second, first] = server.club.auditLog().filter((a) => ['produit.importer', 'produit.modifier'].includes(a.action));
  assert.equal(first.details.status, 'created');
  assert.ok(!('avant' in first.details));
  assert.equal(second.details.status, 'updated');
  assert.deepEqual(second.details.avant, { price: 12500 * UM, description: null });
  assert.equal(second.details.price, 13000 * UM);
  assert.deepEqual(bare.details.avant, { price: 13000 * UM, description: 'Nouvelle description.' });
  // The modification of a product by hand counts in the same unit.
  assert.equal(edit.action, 'produit.modifier');
  assert.equal(edit.details.avant.price, 14000 * UM);
});

test('import : le nom est comparé à la casse et à l’écriture Unicode près, et seuls les vrais produits sont visés', async () => {
  const { server } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const actor = server.club.userRow(server.club.userByLogin('proprietaire').id);
  const created = ok(await importWith(door, { item: { name: 'Éclat de Havane', price: 7000, category: 'cigare' } }));
  // The same name in capitals, and with the é written as e + accent.
  assert.equal(ok(await importWith(door, { item: { name: 'ÉCLAT DE HAVANE', price: 7100, category: 'cigare' } })).id, created.id);
  assert.equal(ok(await importWith(door, { item: { name: 'E\u0301clat de Havane', price: 7200, category: 'cigare' } })).id, created.id);
  assert.equal(server.club.get('SELECT price FROM products WHERE id = ?', created.id).price, 7200 * UM);

  // A fictitious product of the same name is not the one the import means: it stays as it is.
  const fictitious = server.club.tx(() => server.club.createProduct(actor, {
    category: 'cigare', name: 'Robusto (démo)', reference: 'CIG-DEMO-01', price: 10000 * UM,
  }, { demo: true }));
  const real = ok(await importWith(door, { item: { name: 'Robusto (démo)', price: 8000, category: 'cigare' } }));
  assert.equal(real.status, 'created');
  assert.notEqual(real.id, fictitious.id);
  assert.equal(server.club.get('SELECT price FROM products WHERE id = ?', fictitious.id).price, 10000 * UM);
});

test('import : un nom reçu en e + accent est gardé en é (NFC), et se retrouve sous l’une ou l’autre écriture', async () => {
  const { server } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const composed = '\u00c9clat de Havane';
  const decomposed = 'E\u0301clat de Havane';
  assert.notEqual(decomposed, composed);

  const created = ok(await importWith(door, { item: { name: decomposed, price: 7000, category: 'cigare' } }));
  assert.equal(server.club.get('SELECT name FROM products WHERE id = ?', created.id).name, composed);
  assert.equal(server.club.auditLog().find((a) => a.action === 'produit.importer').details.name, composed);
  assert.equal(server.club.listProducts()[0].name, composed);

  // Found again under either writing.
  for (const name of [composed, decomposed]) assert.equal(ok(await importWith(door, { item: { name, price: 7100, category: 'cigare' } })).id, created.id);
  assert.equal(productCount(server), 1);
  assert.equal(server.club.get('SELECT name FROM products WHERE id = ?', created.id).name, composed);
});

test('import : prix en francs entiers, nom, catégorie, description et photo vérifiés ; rien n’est créé sur un refus', async () => {
  const { server } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const journal = server.club.auditLog().length;
  const heavy = picture('image/jpeg', PHOTO_MAX + 1).body;

  for (const [label, body] of [
    ['sans rien à faire', {}],
    ['item nul', { item: null }],
    ['item qui n’est pas un objet', { item: 'Cohiba' }],
    ['liste à la place de la fiche', { item: [ITEM] }],
    ['désactivation autre que true', { deactivate_demo_products: 'oui' }],
    ['sans nom', { item: { ...ITEM, name: undefined } }],
    ['nom blanc', { item: { ...ITEM, name: '   ' } }],
    ['nom de 81 caractères', { item: { ...ITEM, name: 'N'.repeat(81) } }],
    ['sans prix', { item: { ...ITEM, price: undefined } }],
    ['prix décimal', { item: { ...ITEM, price: 12.5 } }],
    ['prix négatif', { item: { ...ITEM, price: -1 } }],
    ['prix en lettres', { item: { ...ITEM, price: 'cher' } }],
    ['prix démesuré', { item: { ...ITEM, price: 1e15 } }],
    ['sans catégorie', { item: { ...ITEM, category: undefined } }],
    ['catégorie inconnue', { item: { ...ITEM, category: 'vin' } }],
    ['description de 301 caractères', { item: { ...ITEM, description: 'D'.repeat(301) } }],
    ['photo GIF', { item: { ...ITEM, photo: { mime: 'image/gif', data: picture().body.data } } }],
    ['photo qui n’en est pas une', { item: { ...ITEM, photo: { mime: 'image/png', data: picture().body.data } } }],
    ['photo illisible', { item: { ...ITEM, photo: { mime: 'image/jpeg', data: '***' } } }],
    ['photo trop lourde', { item: { ...ITEM, photo: heavy } }],
    ['photo sans type', { item: { ...ITEM, photo: { data: picture().body.data } } }],
  ]) {
    const r = await importWith(door, body);
    assert.equal(r.status, 400, label);
    assert.equal(r.data.error.code, 'INVALIDE', label);
  }
  assert.equal(productCount(server), 0);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM product_photos').n, 0);
  assert.equal(server.club.auditLog().length, journal);
  // 200 KB of photo still fits the body of the door, which reads more than the 256 KB of other routes.
  const large = ok(await importWith(door, { item: { ...ITEM, photo: picture('image/jpeg', PHOTO_MAX).body } }));
  assert.equal(large.photo, true);
  assert.equal((await importWith(door, { item: { ...ITEM, name: 'Autre', photo: picture('image/jpeg', 400 * 1024).body } })).status, 413);
});

test('import : désactive les produits fictifs du vrai club sans rien supprimer, et le dit', async () => {
  const { server, admin } = await setup({ env: { IMPORT_TOKEN } });
  const door = new Client(server);
  const actor = server.club.userRow(server.club.userByLogin('proprietaire').id);
  const real = await newProduct(admin, { name: 'Vrai cigare', reference: 'CIG-001', initial_stock: 12 });
  const retired = await newProduct(admin, { name: 'Déjà retiré', reference: 'CIG-002' });
  ok(await admin.put(`/api/products/${retired.id}`, { active: false }));
  const fictitious = server.club.tx(() => ['A', 'B'].map((letter, i) => server.club.createProduct(actor, {
    category: 'cigare', name: `Fictif ${letter}`, reference: `CIG-DEMO-0${i + 1}`, price: 10000 * UM, initial_stock: 5,
  }, { demo: true })));
  const journal = server.club.auditLog().length;

  // A call with a fiche the door refuses does nothing at all, the retirement included.
  const refused = await importWith(door, { item: { ...ITEM, price: -1 }, deactivate_demo_products: true });
  assert.equal(refused.status, 400);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM products WHERE is_demo = 1 AND active = 1').n, 2);
  assert.equal(server.club.auditLog().length, journal);

  const done = ok(await importWith(door, { deactivate_demo_products: true }));
  assert.deepEqual(done, { deactivated: 2 });
  const rows = server.club.all('SELECT id, active, is_demo, stock_qty FROM products ORDER BY id').map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: real.id, active: 1, is_demo: 0, stock_qty: 12 },
    { id: retired.id, active: 0, is_demo: 0, stock_qty: 0 },
    ...fictitious.map((p) => ({ id: p.id, active: 0, is_demo: 1, stock_qty: 5 })),
  ]);
  assert.deepEqual(ok(await admin.get('/api/products')).map((p) => p.id), [real.id]);
  const entry = server.club.auditLog().find((a) => a.action === 'produits.desactiver_fictifs');
  assert.equal(entry.user_id, null);
  assert.equal(entry.details.count, 2);
  assert.equal(server.club.auditLog().length, journal + 1);

  // Again: nothing left to retire.
  assert.deepEqual(ok(await importWith(door, { deactivate_demo_products: true })), { deactivated: 0 });
  assert.equal(productCount(server), 4);
  // A fiche and the retirement can come in one call.
  const both = ok(await importWith(door, { item: ITEM, deactivate_demo_products: true }));
  assert.deepEqual(both, { id: both.id, reference: 'CIG-003', status: 'created', photo: false, deactivated: 0 });
});

test('import : la porte n’existe pas dans l’espace démo, même avec le bon code', async () => {
  const { real, demo, admin } = await withDemo({ env: { IMPORT_TOKEN } });
  const asAdmin = inDemo(real, demo, admin);

  for (const body of [{ item: ITEM }, { deactivate_demo_products: true }]) {
    const r = await asAdmin.post('/api/admin/catalog-import', body, { 'x-import-token': IMPORT_TOKEN });
    assert.equal(r.status, 404);
    assert.equal(r.data.error.code, 'INTROUVABLE');
  }
  // Nor through the Worker's router, with the demo header, signed in or not.
  const site = new Site(real, demo);
  const viaSite = new Client(site);
  const headers = { 'x-club-espace': 'demo', 'x-import-token': IMPORT_TOKEN };
  assert.equal((await viaSite.post('/api/admin/catalog-import', { item: ITEM }, headers)).status, 401);
  await viaSite.login('gerant', GERANT);
  assert.equal((await viaSite.post('/api/admin/catalog-import', { item: ITEM }, headers)).status, 404);
  assert.equal(demo.club.get("SELECT COUNT(*) AS n FROM products WHERE name = 'Cohiba Siglo I'").n, 0);
  assert.equal(productCount(real), 0);
  // The real club answers on the same path without the header.
  ok(await new Client(site).post('/api/admin/catalog-import', { item: ITEM }, { 'x-import-token': IMPORT_TOKEN }));
  assert.equal(productCount(real), 1);
});

// ---------------------------------------------------------------------------- the demo space

const actorOf = (club, login) => club.userRow(club.userByLogin(login).id);

test('démo : la configuration envoyée porte les produits actifs du vrai club, sans aucune photo', async () => {
  const { real, admin } = await withDemo();
  const a = await newProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001', description: 'Un cigare.', initial_stock: 40 });
  const b = await newProduct(admin, { name: 'Montecristo No 4', reference: 'CIG-002' });
  const hidden = await newProduct(admin, { name: 'Retiré', reference: 'CIG-003' });
  ok(await admin.put(`/api/products/${hidden.id}`, { active: false }));
  real.club.tx(() => real.club.createProduct(actorOf(real.club, 'proprietaire'), {
    category: 'cigare', name: 'Ancien fictif', reference: 'CIG-DEMO-01', price: UM,
  }, { demo: true }));
  const saved = ok(await admin.put(`/api/products/${a.id}/photo`, picture('image/jpeg', 90000).body));

  const { products } = real.club.demoConfig();
  assert.deepEqual(products.map((p) => p.id), [a.id, b.id]); // active, real ones only
  assert.deepEqual(Object.keys(products[0]).sort(), [
    'category', 'description', 'id', 'low_stock_threshold', 'name', 'photo_version', 'price', 'reference',
  ]);
  assert.deepEqual([products[0].name, products[0].description, products[0].photo_version], ['Cohiba Siglo I', 'Un cigare.', saved.photo_version]);
  assert.equal(products[1].photo_version, null);
  assert.ok(JSON.stringify(real.club.demoConfig()).length < 30000); // text only: the 90 KB picture is not in it
});

test('démo : les produits du vrai club sont recopiés avec leurs identifiants et un stock de 10, avec les produits fictifs', async () => {
  const { real, demo, admin } = await withDemo();
  const a = await newProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001', description: 'Un cigare.', price: 12000 * UM, initial_stock: 40, low_stock_threshold: 5 });
  const b = await newProduct(admin, { name: 'Whisky maison', category: 'bouteille', reference: 'BOU-001', price: 30000 * UM });
  const hidden = await newProduct(admin, { name: 'Retiré', reference: 'CIG-003' });
  ok(await admin.put(`/api/products/${hidden.id}`, { active: false }));
  real.club.tx(() => real.club.createProduct(actorOf(real.club, 'proprietaire'), {
    category: 'cigare', name: 'Ancien fictif', reference: 'CIG-DEMO-01', price: UM,
  }, { demo: true }));

  demo.club.prepareDemo(real.club.demoConfig());

  const all = demo.club.listProducts({ includeInactive: true });
  const copies = all.filter((p) => !p.is_demo).sort((x, y) => x.id - y.id);
  assert.deepEqual(copies.map((p) => [p.id, p.name, p.reference, p.category, p.price, p.description, p.low_stock_threshold]), [
    [a.id, 'Cohiba Siglo I', 'CIG-001', 'cigare', 12000 * UM, 'Un cigare.', 5],
    [b.id, 'Whisky maison', 'BOU-001', 'bouteille', 30000 * UM, null, 3],
  ]);
  assert.ok(copies.every((p) => p.active && p.stock_qty === 10 && p.out === false)); // 10 each, whatever the real stock
  // The seed's own products are all there too, after the copies.
  const fictitious = all.filter((p) => p.is_demo);
  assert.equal(fictitious.length, 7);
  assert.deepEqual(fictitious.map((p) => p.reference).sort().slice(0, 3), ['BOU-DEMO-01', 'BOU-DEMO-02', 'BOU-DEMO-03']);
  assert.ok(fictitious.every((p) => p.id > Math.max(a.id, b.id)));
  assert.equal(all.length, 9); // neither the retired product nor the old fictitious one of the real club
  // The history of the demo sells the fictitious products only.
  for (const { product_id: id } of demo.club.all('SELECT DISTINCT product_id FROM charges WHERE product_id IS NOT NULL')) {
    assert.equal(all.find((p) => p.id === id).is_demo, true);
  }
  // Each copy has the opening movement that explains its stock.
  const movements = demo.club.stockMovements({ product_id: a.id });
  assert.deepEqual(movements.map((m) => [m.kind, m.quantity, m.stock_after]), [['stock_initial', 10, 10]]);
  // The real club is untouched: its stock is its own, and it still has no fictitious history.
  assert.equal(real.club.listProducts().find((p) => p.id === a.id).stock_qty, 40);
  assert.equal(real.club.get('SELECT COUNT(*) AS n FROM members').n, 0);
});

test('démo : les produits fictifs prennent les identifiants après les produits recopiés, même après un trou', async () => {
  const { real, demo, admin } = await withDemo();
  const a = await newProduct(admin, { name: 'Premier', reference: 'CIG-001' });
  real.db.run(
    "INSERT INTO products (id, category, name, reference, price, created_at) VALUES (500, 'cigare', 'Très loin', 'CIG-500', 100, ?)", new Date().toISOString(),
  );

  demo.club.prepareDemo(real.club.demoConfig());

  const rows = demo.club.all('SELECT id, is_demo FROM products ORDER BY id').map((r) => ({ ...r }));
  assert.deepEqual(rows.slice(0, 2), [{ id: a.id, is_demo: 0 }, { id: 500, is_demo: 0 }]);
  assert.equal(rows.length, 9);
  assert.ok(rows.slice(2).every((r) => r.id > 500 && r.is_demo === 1), JSON.stringify(rows));
  assert.equal(demo.club.listMembers().length, 5); // the seed went through
});

test('démo : les produits ne sont recopiés qu’au remplissage et à la remise à neuf, pas à chaque requête', async () => {
  const { real, demo, admin } = await withDemo();
  const a = await newProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001', price: 12000 * UM });
  demo.club.prepareDemo(real.club.demoConfig());
  const rows = () => demo.club.all('SELECT * FROM products ORDER BY id');
  const written = () => demo.club.get('SELECT total_changes() AS n').n;
  const filled = rows();
  const filledWrites = written();

  // The real club moves on: a renamed product, a new one, a retired one.
  ok(await admin.put(`/api/products/${a.id}`, { name: 'Renommé', price: 15000 * UM }));
  const fresh = await newProduct(admin, { name: 'Tout nouveau', reference: 'CIG-009' });
  demo.club.prepareDemo(real.club.demoConfig());
  assert.equal(written(), filledWrites); // a plain preparation writes nothing
  assert.deepEqual(rows(), filled);
  assert.equal(demo.club.listProducts().some((p) => p.name === 'Tout nouveau'), false);

  // Something happens to the copy in the demo; the reset starts again from the real catalogue as it is now.
  const author = demo.club.userRow(real.club.userByLogin('proprietaire').id); // the demo names its accounts u<id>
  demo.club.tx(() => demo.club.stockOperation(author, a.id, { kind: 'entree', quantity: 5 }));
  assert.equal(demo.club.listProducts().find((p) => p.id === a.id).stock_qty, 15);
  demo.club.resetDemo(real.club.demoConfig(), author);
  const copies = demo.club.listProducts().filter((p) => !p.is_demo).sort((x, y) => x.id - y.id);
  assert.deepEqual(copies.map((p) => [p.id, p.name, p.price, p.stock_qty]), [
    [a.id, 'Renommé', 15000 * UM, 10], [fresh.id, 'Tout nouveau', 10000 * UM, 10],
  ]);
  assert.equal(demo.club.listProducts().filter((p) => p.is_demo).length, 7);
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?', a.id).n, 1);
  // And a second reset gives the same space.
  demo.club.resetDemo(real.club.demoConfig(), author);
  assert.equal(demo.club.listProducts().length, 9);
});

test('démo : un remplissage refusé ou en échec ne laisse aucun produit recopié derrière lui', async () => {
  const { real, demo, admin } = await withDemo();
  await newProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  const config = real.club.demoConfig();

  // The seed finds no plan to sell: the copy made just before it is undone with the rest.
  assert.throws(() => demo.club.prepareDemo({ ...config, plans: [] }));
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM products').n, 0);
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM product_photos').n, 0);

  // A space that holds a product but was never filled is not mixed with the catalogue: refused as any leftover.
  demo.db.run("INSERT INTO products (category, name, reference, price, created_at) VALUES ('cigare', 'Resté là', 'X-1', 100, ?)", new Date().toISOString());
  assert.throws(() => demo.club.prepareDemo(config), (err) => err.code === 'DONNEES_EXISTANTES');
  assert.deepEqual(demo.club.all('SELECT name FROM products').map((p) => p.name), ['Resté là']);
  assert.equal(demo.club.get("SELECT COUNT(*) AS n FROM meta WHERE key = 'demo_seeded'").n, 0);
});

test('démo : un vrai produit qui porte la référence d’un produit fictif la garde, le fictif prend la suivante de sa série', async () => {
  const { real, demo, admin } = await withDemo();
  // The seed's Robusto wants CIG-DEMO-01. Lower case on purpose: references are unique whatever their case.
  const mine = await newProduct(admin, { name: 'Cigare maison', reference: 'cig-demo-01' });
  const inTheDemo = inDemo(real, demo, admin);

  const check = async (step) => {
    const products = ok(await inTheDemo.get('/api/products?all=1'));
    const copy = products.find((p) => p.id === mine.id);
    assert.deepEqual([copy.name, copy.reference, copy.is_demo], ['Cigare maison', 'cig-demo-01', false], step);
    const referenceOf = (name) => products.find((p) => p.name === name).reference;
    assert.deepEqual(
      ['Robusto (démo)', 'Corona (démo)', 'Churchill (démo)', 'Whisky 12 ans (démo)'].map(referenceOf),
      ['CIG-DEMO-02', 'CIG-DEMO-03', 'CIG-DEMO-04', 'BOU-DEMO-01'], step,
    );
    assert.equal(products.length, 8, step);
    assert.equal(new Set(products.map((p) => p.reference.toLowerCase())).size, 8, step);
  };

  await check('ouverture');
  ok(await inTheDemo.post('/api/demo/reset', {}));
  await check('première remise à neuf');
  ok(await inTheDemo.post('/api/demo/reset', {}));
  await check('seconde remise à neuf');
});

test('démo : des références prises de suite, dans les deux séries, sont sautées une à une', async () => {
  const { real, demo, admin } = await withDemo();
  const mine = [];
  for (const [category, reference] of [['cigare', 'cig-demo-01'], ['cigare', 'CIG-DEMO-02'], ['bouteille', 'bou-demo-02']]) {
    mine.push(await newProduct(admin, { name: `Réel ${reference}`, category, reference }));
  }
  demo.club.prepareDemo(real.club.demoConfig());

  const products = demo.club.listProducts();
  assert.deepEqual(mine.map((p) => products.find((x) => x.id === p.id).reference), ['cig-demo-01', 'CIG-DEMO-02', 'bou-demo-02']);
  const fictitious = products.filter((p) => p.is_demo);
  assert.deepEqual(fictitious.map((p) => p.reference).sort(), [
    'BOU-DEMO-01', 'BOU-DEMO-03', 'BOU-DEMO-04', 'BOU-DEMO-05', 'CIG-DEMO-03', 'CIG-DEMO-04', 'CIG-DEMO-05',
  ]);
  assert.equal(demo.club.listMembers().length, 5); // the history was made all the same
});

test('photos : en démo, ajouter ou retirer est refusé sans toucher à la photo du vrai club, qui reste servie par lui', async () => {
  const { real, demo, admin, manager } = await withDemo();
  const p = await newProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  const sent = picture('image/jpeg', 900);
  const saved = ok(await admin.put(`/api/products/${p.id}/photo`, sent.body));

  // The message is the same for an administrator and a manager.
  for (const client of [admin, manager]) {
    const asUser = inDemo(real, demo, client);
    const put = await asUser.put(`/api/products/${p.id}/photo`, picture('image/png', 500).body);
    const del = await asUser.del(`/api/products/${p.id}/photo`);
    for (const refused of [put, del]) {
      assert.equal(refused.status, 403);
      assert.equal(refused.data.error.code, 'MODE_DEMO');
      assert.equal(refused.data.error.message, 'Les photos se gèrent hors du mode démo.');
    }
  }
  assert.deepEqual((await getPhoto(manager, p.id)).bytes, sent.bytes);
  assert.equal(real.club.listProducts()[0].photo_version, saved.photo_version);

  // The demo lists the product under the same id with the photo's version, and holds no picture itself.
  const inTheDemo = inDemo(real, demo, manager);
  const listed = ok(await inTheDemo.get('/api/products')).find((x) => x.id === p.id);
  assert.equal(listed.name, 'Cohiba Siglo I');
  assert.equal(listed.photo_version, saved.photo_version);
  assert.equal(demo.club.get('SELECT COALESCE(SUM(bytes), 0) AS n FROM product_photos').n, 0);
  assert.equal((await inTheDemo.get(`/api/products/${p.id}/photo`)).status, 404); // not an empty image
});

test('photos : l’adresse d’une photo se lit sans l’en-tête démo, par le vrai club, y compris pour un produit recopié en démo', async () => {
  const { real, demo, admin } = await withDemo();
  const p = await newProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  const sent = picture('image/webp', 1200, 5);
  ok(await admin.put(`/api/products/${p.id}/photo`, sent.body));
  const manager = new Client(new Site(real, demo));
  await manager.login('gerant', GERANT);

  // In the demo space the list carries the product and the version of its photo...
  const listed = ok(await manager.call('GET', '/api/products', undefined, { 'x-club-espace': 'demo' })).find((x) => x.id === p.id);
  assert.ok(listed.photo_version);
  // ...and the browser's <img>, which cannot add the header, is answered by the real club.
  const img = await getPhoto(manager, p.id, `?v=${encodeURIComponent(listed.photo_version)}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  assert.deepEqual(img.bytes, sent.bytes);
});
