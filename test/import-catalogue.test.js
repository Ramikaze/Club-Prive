// The catalogue import script (scripts/import-catalogue.mjs): reading the owner's Excel sheet, checking it
// against the photo manifests, and sending the products to the import door (POST /api/admin/catalog-import).
// Everything here is made up: the real list and the real photos are the owner's and never enter the repository.
// A picture is a few bytes that start like a WebP file, which is all the server looks at.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { Server, Client, UM } from './harness.js';
import { readCatalogue, buildImport, runImport, main } from '../scripts/import-catalogue.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/import-catalogue.mjs', import.meta.url));
const TOKEN = 'code-import-fictif';
const BASE = 'http://localhost:8787';
const PHOTO_MAX = 200 * 1024;

const servers = [];
const folders = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
  for (const dir of folders.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// An Excel file laid out as the owner's: a title, blank rows, the header, then one row per cigar.
function workbook(rows, sheetName = 'Feuil1') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

// `size` bytes that start like a WebP file (RIFF, four bytes of length, WEBP), the rest being `fill`.
function webp(size = 64, fill = 9) {
  const bytes = Buffer.alloc(size, fill);
  bytes.write('RIFF', 0, 'latin1');
  bytes.write('WEBP', 8, 'latin1');
  return bytes;
}

// ---------------------------------------------------------------------------- reading the Excel sheet

test('lecture Excel : saute le titre et les lignes vides, trouve l’en-tête, garde les numéros de ligne d’Excel', () => {
  const rows = readCatalogue(workbook([
    ['liste fictive du club'], [], [],
    ['cigares ', 'prix'],
    ['  alpha robusto ', 11500],
    ['bravo corona', 4500],
    [],
    ['  ', ''],
    ['charlie gordo', 25000],
  ]));
  assert.deepEqual(rows, [
    { row: 5, name: 'alpha robusto', price: 11500 },
    { row: 6, name: 'bravo corona', price: 4500 },
    { row: 9, name: 'charlie gordo', price: 25000 },
  ]);
});

test('lecture Excel : une ligne à moitié remplie reste dans la liste, pour que la vérification la signale', () => {
  const rows = readCatalogue(workbook([
    ['Cigares', ' PRIX '],
    ['alpha', ''],
    ['', 5000],
    ['bravo', 'cher'],
  ]));
  assert.deepEqual(rows, [
    { row: 2, name: 'alpha', price: '' },
    { row: 3, name: '', price: 5000 },
    { row: 4, name: 'bravo', price: 'cher' },
  ]);
});

test('lecture Excel : la feuille Feuil1 passe avant les autres, à défaut la première feuille est lue', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['cigares', 'prix'], ['feuille de brouillon', 1]]), 'Brouillon');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['cigares', 'prix'], ['alpha', 2000]]), 'Feuil1');
  assert.deepEqual(readCatalogue(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })), [{ row: 2, name: 'alpha', price: 2000 }]);
  assert.deepEqual(
    readCatalogue(workbook([['cigares', 'prix'], ['alpha', 2000]], 'Sheet1')),
    [{ row: 2, name: 'alpha', price: 2000 }],
  );
});

test('lecture Excel : sans ligne d’en-tête « cigares » et « prix », elle refuse en le disant', () => {
  assert.throws(() => readCatalogue(workbook([['nom', 'montant'], ['alpha', 2000]])), /« cigares » et « prix »/);
  assert.throws(() => readCatalogue(workbook([['cigares', 'montant'], ['alpha', 2000]])), /« cigares » et « prix »/);
});

// ---------------------------------------------------------------------------- checking the sheet against the manifests

// A manifest entry for a made-up cigar; `extra` overrides any field.
const entry = (input_name, extra = {}) => {
  const slug = input_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { input_name, slug, official_name: `${input_name.trim()} officiel`, file: `${slug}.jpg`, description_fr: 'Une description.', ...extra };
};
const reader = (photos = {}, asked = []) => (slug) => {
  asked.push(slug);
  return photos[slug] ?? null;
};
const check = ({ rows, manifests, photos = {} }) => buildImport({ rows, manifests, readPhoto: reader(photos) });
const oneRow = (extra = {}, row = { row: 5, name: 'alpha', price: 11500 }) => check({
  rows: [row], manifests: [entry('alpha', extra)], photos: { alpha: webp() },
});

test('préparation : relie chaque ligne à sa fiche sans compter majuscules, espaces autour ni écriture Unicode ; nom et description viennent de la fiche', () => {
  const alpha = webp(120, 1);
  const delta = webp(150, 3);
  const asked = [];
  const { items, problems, warnings } = buildImport({
    rows: [
      { row: 5, name: 'alpha robusto', price: 11500 },
      { row: 6, name: 'bravo corona', price: 4500 },
      { row: 7, name: 'Délta gordo', price: 25000 }, // the é in one piece
    ],
    // The manifests as the folder holds them: several files, each a list.
    manifests: [
      [{ input_name: '  ALPHA Robusto ', slug: 'alpha-robusto', official_name: 'Alpha Robusto 5 x 50', file: 'alpha-robusto.jpg', description_fr: 'Un robusto fictif.' }],
      [
        { input_name: 'bravo corona', slug: 'bravo-corona', official_name: 'Bravo Corona', file: null, description_fr: null },
        { input_name: 'Délta Gordo', slug: 'delta-gordo', official_name: 'Delta Gordo Grande Reserve', file: 'delta-gordo.png', description_fr: 'Un gordo fictif.' },
      ],
    ],
    readPhoto: reader({ 'alpha-robusto': alpha, 'delta-gordo': delta }, asked),
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(items, [
    { row: 5, slug: 'alpha-robusto', name: 'Alpha Robusto 5 x 50', price: 11500, description: 'Un robusto fictif.', photo: { mime: 'image/webp', bytes: alpha } },
    { row: 6, slug: 'bravo-corona', name: 'Bravo Corona', price: 4500, description: null, photo: null },
    { row: 7, slug: 'delta-gordo', name: 'Delta Gordo Grande Reserve', price: 25000, description: 'Un gordo fictif.', photo: { mime: 'image/webp', bytes: delta } },
  ]);
  // A cigar without a photo is a product like another: its picture is not looked for.
  assert.deepEqual(asked, ['alpha-robusto', 'delta-gordo']);
});

test('préparation : une ligne sans fiche, une fiche sans ligne et un nom qui désigne deux fiches sont tous signalés', () => {
  const { items, problems } = check({
    rows: [
      { row: 5, name: 'alpha', price: 1000 },
      { row: 6, name: 'bravo', price: 2000 },
      { row: 7, name: 'charlie', price: 3000 },
    ],
    manifests: [entry('alpha'), entry('charlie'), entry(' Charlie ', { slug: 'charlie-bis' }), entry('zulu')],
    photos: { alpha: webp() },
  });
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.match(problems[0], /Ligne 6 « bravo » : aucune fiche/);
  assert.match(problems[1], /Ligne 7 « charlie » : 2 fiches/);
  assert.match(problems[2], /Fiche « zulu » \(zulu\) : aucune ligne/);
  assert.deepEqual(items.map((i) => i.name), ['alpha officiel']);
});

test('préparation : deux produits ne portent jamais le même nom, qu’il vienne de deux fiches ou de deux lignes', () => {
  // Two cigars of the sheet that the manifests name alike (case and spaces do not count).
  const alike = check({
    rows: [{ row: 5, name: 'alpha', price: 1000 }, { row: 6, name: 'bravo', price: 2000 }, { row: 7, name: 'charlie', price: 3000 }],
    manifests: [
      entry('alpha', { official_name: 'Edition limitée 2025' }),
      entry('bravo', { official_name: '  EDITION LIMITÉE 2025 ' }),
      entry('charlie', { official_name: 'Edition limitee 2025' }),
    ],
    photos: { alpha: webp(), bravo: webp(), charlie: webp() },
  });
  // The accent makes the third one another name.
  assert.equal(alike.problems.length, 1, alike.problems.join('\n'));
  assert.match(alike.problems[0], /Nom en double « Edition limitée 2025 » : lignes 5 et 6/);

  // The same cigar twice in the sheet.
  const twice = check({
    rows: [{ row: 5, name: 'alpha', price: 1000 }, { row: 6, name: 'bravo', price: 2000 }, { row: 8, name: 'Alpha ', price: 1000 }],
    manifests: [entry('alpha'), entry('bravo')],
    photos: { alpha: webp(), bravo: webp() },
  });
  assert.equal(twice.problems.length, 1, twice.problems.join('\n'));
  assert.match(twice.problems[0], /Nom en double « alpha officiel » : lignes 5 et 8/);

  const thrice = check({
    rows: [5, 6, 9].map((row) => ({ row, name: 'alpha', price: 1000 })),
    manifests: [entry('alpha')],
    photos: { alpha: webp() },
  });
  assert.match(thrice.problems.join('\n'), /lignes 5, 6 et 9/);
});

test('préparation : le prix est un nombre entier de francs, de 1 à 1 000 000 000', () => {
  for (const price of [0, 12.5, 'cher', '11500', -5, 1000000001, Number.NaN, Infinity, '', null, undefined]) {
    const { items, problems } = oneRow({}, { row: 5, name: 'alpha', price });
    assert.equal(problems.length, 1, `${String(price)} : ${problems.join('\n')}`);
    assert.match(problems[0], /Ligne 5 « alpha » : prix invalide/, String(price));
    assert.deepEqual(items, [], String(price));
  }
  for (const price of [1, 11500, 1000000000]) {
    const { items, problems } = oneRow({}, { row: 5, name: 'alpha', price });
    assert.deepEqual(problems, [], String(price));
    assert.equal(items[0].price, price);
  }
});

test('préparation : le nom fait de 1 à 80 caractères, et à défaut de nom officiel le nom du fichier Excel est pris, avec un avertissement', () => {
  const long = oneRow({ official_name: 'N'.repeat(81) });
  assert.equal(long.problems.length, 1, long.problems.join('\n'));
  assert.match(long.problems[0], /Ligne 5 « alpha » : nom trop long \(81 caractères, 80 au plus\)/);
  assert.deepEqual(oneRow({ official_name: ` ${'N'.repeat(80)} ` }).problems, []);

  for (const official_name of [null, '', '   ', undefined]) {
    const { items, problems, warnings } = oneRow(
      { input_name: 'alpha robusto', official_name, file: null, description_fr: null },
      { row: 5, name: '  alpha robusto ', price: 4000 },
    );
    assert.deepEqual(problems, [], String(official_name));
    assert.equal(items[0].name, 'alpha robusto');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Ligne 5 « alpha robusto » : pas de nom officiel/);
  }
});

test('préparation : la description va jusqu’à 300 caractères, avec un avertissement au-delà de 250', () => {
  for (const [length, problems, warnings] of [[250, 0, 0], [251, 0, 1], [300, 0, 1], [301, 1, 0]]) {
    const result = oneRow({ description_fr: 'D'.repeat(length) });
    assert.equal(result.problems.length, problems, `${length} : ${result.problems.join('\n')}`);
    assert.equal(result.warnings.length, warnings, `${length} : ${result.warnings.join('\n')}`);
  }
  assert.match(oneRow({ description_fr: 'D'.repeat(301) }).problems[0], /Ligne 5 « alpha » : description trop longue \(301 caractères, 300 au plus\)/);
  assert.match(oneRow({ description_fr: 'D'.repeat(260) }).warnings[0], /Ligne 5 « alpha » : description longue \(260 caractères/);
  // No description, or a blank one, is no description.
  for (const description_fr of [null, '', '  ', undefined]) assert.equal(oneRow({ description_fr }).items[0].description, null);
});

test('préparation : la photo existe, commence comme une image WebP et pèse 200 Ko au plus', () => {
  const withPhoto = (bytes, extra) => check({ rows: [{ row: 5, name: 'alpha', price: 1000 }], manifests: [entry('alpha', extra)], photos: bytes === undefined ? {} : { alpha: bytes } });

  assert.deepEqual(withPhoto(webp(PHOTO_MAX)).problems, []);
  const heavy = withPhoto(webp(PHOTO_MAX + 1));
  assert.equal(heavy.problems.length, 1);
  assert.match(heavy.problems[0], /Ligne 5 « alpha » : photo trop lourde \(204 801 octets, 204 800 au plus\)/);
  assert.deepEqual(heavy.items, []);

  const png = Buffer.alloc(80, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  const riffOnly = Buffer.alloc(80, 7);
  riffOnly.write('RIFF', 0, 'latin1');
  riffOnly.write('WAVE', 8, 'latin1');
  const webpOnly = Buffer.alloc(80, 7);
  webpOnly.write('RIFX', 0, 'latin1');
  webpOnly.write('WEBP', 8, 'latin1');
  for (const [label, bytes] of [
    ['PNG', png], ['RIFF sans WEBP', riffOnly], ['WEBP sans RIFF', webpOnly], ['trop court', Buffer.from('RIFF')], ['vide', Buffer.alloc(0)],
  ]) {
    const bad = withPhoto(bytes);
    assert.equal(bad.problems.length, 1, `${label} : ${bad.problems.join('\n')}`);
    assert.match(bad.problems[0], /Ligne 5 « alpha » : la photo .* n'est pas une image WebP/, label);
    assert.deepEqual(bad.items, [], label);
  }

  const missing = withPhoto(undefined);
  assert.equal(missing.problems.length, 1);
  assert.match(missing.problems[0], /Ligne 5 « alpha » : photo introuvable \(import\/alpha\.webp\)/);

  const unreadable = buildImport({
    rows: [{ row: 5, name: 'alpha', price: 1000 }],
    manifests: [entry('alpha')],
    readPhoto: () => { throw new Error('EACCES: permission denied'); },
  });
  assert.match(unreadable.problems.join('\n'), /Ligne 5 « alpha » : photo illisible \(EACCES/);
});

test('préparation : l’identifiant d’une photo ne sort jamais du dossier import', () => {
  const asked = [];
  for (const slug of ['../secret', 'sous/dossier', '.cache', 'a\\b', '', 'espace ici']) {
    const { problems, items } = buildImport({
      rows: [{ row: 5, name: 'alpha', price: 1000 }],
      manifests: [entry('alpha', { slug })],
      readPhoto: reader({}, asked),
    });
    assert.equal(problems.length, 1, `${slug} : ${problems.join('\n')}`);
    assert.match(problems[0], /Ligne 5 « alpha » : identifiant de photo invalide/, slug);
    assert.deepEqual(items, []);
  }
  assert.deepEqual(asked, []);
});

test('préparation : un fichier sans aucun cigare est refusé, et tous les problèmes sont rendus d’un coup', () => {
  assert.match(check({ rows: [], manifests: [] }).problems.join('\n'), /aucun cigare/);

  const { problems } = check({
    rows: [{ row: 5, name: 'alpha', price: 0 }, { row: 6, name: 'bravo', price: 1000 }],
    manifests: [entry('alpha', { description_fr: 'D'.repeat(301) }), entry('yankee')],
    photos: { alpha: webp(PHOTO_MAX + 1) },
  });
  // alpha: price, description, photo; bravo: no entry; yankee: no row.
  assert.equal(problems.length, 5, problems.join('\n'));
});

// ---------------------------------------------------------------------------- sending to the import door

// A real club in memory, with the import secret (or none) and an administrator who can read the photos back.
async function club({ token = TOKEN } = {}) {
  const server = new Server(token === null ? {} : { IMPORT_TOKEN: token });
  servers.push(server);
  await server.start();
  await server.addUser('proprietaire', 'Propriétaire', 'admin', 'mot-de-passe-proprio');
  const admin = new Client(server);
  await admin.login('proprietaire', 'mot-de-passe-proprio');
  return { server, admin };
}

// The script's `fetch`, ending in the club's API instead of the network; the calls it receives are kept.
function door(server) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, redirect: init.redirect, headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const { pathname, search } = new URL(url);
    return server.fetch(pathname + search, init);
  };
  return { fetch, calls };
}

// A `fetch` that answers from a script, one answer per call: [status, body] or an Error to throw.
function scripted(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const answer = answers.shift();
    assert.ok(answer, 'the script made a call nobody planned');
    if (answer instanceof Error) throw answer;
    const [status, body] = answer;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}
const done = (n, extra = {}) => [200, { id: n, reference: `CIG-${String(n).padStart(3, '0')}`, status: 'created', photo: true, ...extra }];
const refusal = (status, code, message) => [status, { error: { code, message, details: null } }];
const noReply = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

const item = (row, name, extra = {}) => ({
  row, slug: `produit-${row}`, name, price: 9000 + row, description: `Description de ${name}.`, photo: { mime: 'image/webp', bytes: webp(300 + row, row) }, ...extra,
});

// What a run prints and how long it waited, kept instead of shown and slept.
function witness() {
  const lines = [];
  const sleeps = [];
  return { lines, sleeps, log: (line) => lines.push(line), sleep: async (ms) => { sleeps.push(ms); }, text: () => lines.join('\n') };
}

const send = (items, fetch, witnessed, token = TOKEN) => runImport({ items, baseUrl: BASE, token, fetch, log: witnessed.log, sleep: witnessed.sleep });
const productCount = (server) => server.club.get('SELECT COUNT(*) AS n FROM products').n;
async function photoOf(admin, id) {
  const res = await admin.server.fetch(`/api/products/${id}/photo`, { headers: { cookie: admin.cookie } });
  return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
}

test('envoi : retire d’abord les produits fictifs, puis crée un produit par ligne dans l’ordre (CIG-001, CIG-002…), photo comprise', async () => {
  const { server, admin } = await club();
  const actor = server.club.userRow(server.club.userByLogin('proprietaire').id);
  server.club.tx(() => ['A', 'B'].map((letter, i) => server.club.createProduct(actor, {
    category: 'cigare', name: `Fictif ${letter}`, reference: `CIG-DEMO-0${i + 1}`, price: 10000 * UM, initial_stock: 5,
  }, { demo: true })));
  const { fetch, calls } = door(server);
  const w = witness();
  const items = [item(5, 'Alpha Robusto'), item(6, 'Bravo Corona', { photo: null, description: null })];

  const summary = await send(items, fetch, w);

  assert.deepEqual(summary, { deactivated: 2, created: 2, updated: 0, withPhoto: 1, withoutPhoto: 1, failures: [], stopped: null, remaining: 0 });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].body, { deactivate_demo_products: true });
  assert.deepEqual(calls[1].body, {
    item: { name: 'Alpha Robusto', price: 9005, category: 'cigare', description: 'Description de Alpha Robusto.', photo: { mime: 'image/webp', data: items[0].photo.bytes.toString('base64') } },
  });
  // No description and no photo: the keys are not there, so a product keeps what it has.
  assert.deepEqual(calls[2].body, { item: { name: 'Bravo Corona', price: 9006, category: 'cigare' } });
  for (const call of calls) {
    assert.equal(call.url, `${BASE}/api/admin/catalog-import`);
    assert.equal(call.method, 'POST');
    // A redirect is never followed: the code in the headers would go along with it.
    assert.equal(call.redirect, 'manual');
    assert.equal(call.headers.get('content-type'), 'application/json');
    assert.equal(call.headers.get('x-import-token'), TOKEN);
    assert.equal(call.headers.get('origin'), null);
    assert.equal(call.headers.get('cookie'), null);
  }

  const rows = server.club.all('SELECT name, reference, price, active, is_demo FROM products ORDER BY id').map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { name: 'Fictif A', reference: 'CIG-DEMO-01', price: 10000 * UM, active: 0, is_demo: 1 },
    { name: 'Fictif B', reference: 'CIG-DEMO-02', price: 10000 * UM, active: 0, is_demo: 1 },
    { name: 'Alpha Robusto', reference: 'CIG-001', price: 9005 * UM, active: 1, is_demo: 0 },
    { name: 'Bravo Corona', reference: 'CIG-002', price: 9006 * UM, active: 1, is_demo: 0 },
  ]);
  const alpha = server.club.get("SELECT id FROM products WHERE name = 'Alpha Robusto'").id;
  const bravo = server.club.get("SELECT id FROM products WHERE name = 'Bravo Corona'").id;
  const photo = await photoOf(admin, alpha);
  assert.equal(photo.type, 'image/webp');
  assert.ok(photo.bytes.equals(items[0].photo.bytes));
  assert.equal((await photoOf(admin, bravo)).status, 404);

  const text = w.text();
  assert.match(text, /2 produits fictifs/);
  assert.match(text, /CIG-001\s+créé\s+Alpha Robusto\s+avec photo/);
  assert.match(text, /CIG-002\s+créé\s+Bravo Corona\s+sans photo/);
  assert.deepEqual(w.sleeps, []);
});

test('envoi : relancé, il met à jour les mêmes produits sans doublon, et la dernière photo envoyée est celle qui reste', async () => {
  const { server, admin } = await club();
  const { fetch } = door(server);
  const first = [item(5, 'Alpha Robusto'), item(6, 'Bravo Corona')];
  await send(first, fetch, witness());

  const w = witness();
  const second = [item(5, 'Alpha Robusto', { price: 12000, photo: { mime: 'image/webp', bytes: webp(500, 42) } }), item(6, 'bravo corona ')];
  const summary = await send(second, fetch, w);

  assert.equal(summary.deactivated, 0);
  assert.equal(summary.created, 0);
  assert.equal(summary.updated, 2);
  assert.equal(summary.withPhoto, 2);
  assert.equal(productCount(server), 2);
  const alpha = server.club.get("SELECT id, price, reference FROM products WHERE name = 'Alpha Robusto'");
  assert.equal(alpha.price, 12000 * UM);
  assert.equal(alpha.reference, 'CIG-001');
  assert.ok((await photoOf(admin, alpha.id)).bytes.equals(webp(500, 42)));
  assert.match(w.text(), /CIG-001\s+mis à jour\s+Alpha Robusto\s+avec photo/);
  assert.match(w.text(), /CIG-002\s+mis à jour\s+bravo corona\s+avec photo/);
});

test('envoi : un mauvais code arrête tout dès le premier appel, sans nouvel essai ni produit créé, et le code ne s’affiche pas', async () => {
  const { server } = await club();
  const { fetch, calls } = door(server);
  const w = witness();

  const summary = await send([item(5, 'Alpha Robusto'), item(6, 'Bravo Corona')], fetch, w, 'mauvais-code');

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { deactivate_demo_products: true });
  assert.deepEqual(w.sleeps, []);
  assert.equal(productCount(server), 0);
  assert.equal(summary.stopped.code, 'CODE_INCORRECT');
  assert.equal(summary.created, 0);
  assert.equal(summary.remaining, 2);
  assert.match(w.text(), /Code d'import incorrect/);
  // The same command would only be refused again, and five refusals lock the address: it is not suggested.
  assert.doesNotMatch(w.text(), /relancez/i);
  assert.ok(!w.text().includes('mauvais-code'));
  assert.ok(!JSON.stringify(summary).includes('mauvais-code'));
});

test('envoi : sans le secret sur le serveur (503), il s’arrête de même au premier appel', async () => {
  const { server } = await club({ token: null });
  const { fetch, calls } = door(server);
  const w = witness();

  const summary = await send([item(5, 'Alpha Robusto')], fetch, w);

  assert.equal(calls.length, 1);
  assert.equal(summary.stopped.code, 'CODE_ABSENT');
  assert.deepEqual(w.sleeps, []);
  assert.equal(productCount(server), 0);
  assert.match(w.text(), /IMPORT_TOKEN/);
});

test('envoi : un code incorrect en cours de route arrête aussi, et rien n’est tenté après', async () => {
  const { fetch, calls } = scripted(
    [200, { deactivated: 0 }],
    done(1),
    refusal(403, 'CODE_INCORRECT', "Code d'import incorrect."),
  );
  const w = witness();
  const summary = await send([item(5, 'Alpha'), item(6, 'Bravo'), item(7, 'Charlie')], fetch, w);
  assert.equal(calls.length, 3);
  assert.equal(summary.created, 1);
  assert.equal(summary.stopped.code, 'CODE_INCORRECT');
  assert.equal(summary.stopped.name, 'Bravo');
  assert.equal(summary.remaining, 2);
  assert.deepEqual(w.sleeps, []);
});

test('envoi : après un 429, il attend 61 secondes et refait le même appel, deux fois au plus', async () => {
  const limited = refusal(429, 'TROP_DE_TENTATIVES', 'Trop de tentatives. Réessayez dans une minute.');
  const once = scripted(limited, [200, { deactivated: 0 }], done(1));
  const w = witness();
  const summary = await send([item(5, 'Alpha')], once.fetch, w);
  assert.deepEqual(w.sleeps, [61000]);
  assert.equal(once.calls.length, 3);
  assert.deepEqual(once.calls[0], { deactivate_demo_products: true });
  assert.deepEqual(once.calls[1], once.calls[0]);
  assert.equal(once.calls[2].item.name, 'Alpha');
  assert.equal(summary.created, 1);
  assert.equal(summary.stopped, null);
  assert.match(w.text(), /61 s/);

  // Still locked after two waits: it stops there instead of waiting for ever.
  const locked = scripted(limited, limited, limited);
  const w2 = witness();
  const stopped = await send([item(5, 'Alpha')], locked.fetch, w2);
  assert.deepEqual(w2.sleeps, [61000, 61000]);
  assert.equal(locked.calls.length, 3);
  assert.equal(stopped.stopped.code, 'TROP_DE_TENTATIVES');
  assert.equal(stopped.created, 0);
});

test('envoi : une erreur du serveur (5xx) ou du réseau est retentée après 2, 5 puis 10 secondes, puis il s’arrête', async () => {
  const mixed = scripted(
    refusal(500, 'ERREUR_SERVEUR', 'Erreur interne.'),
    [502, '<html>Bad gateway</html>'],
    noReply(),
    [200, { deactivated: 0 }],
    [503, 'Service Unavailable'],
    done(1),
  );
  const w = witness();
  const summary = await send([item(5, 'Alpha')], mixed.fetch, w);
  assert.deepEqual(w.sleeps, [2000, 5000, 10000, 2000]);
  assert.equal(summary.created, 1);
  assert.equal(summary.stopped, null);

  // Four failures in a row: the three waits are used up.
  const down = scripted(noReply(), noReply(), refusal(500, 'ERREUR_SERVEUR', 'Erreur interne.'), [504, 'Gateway Timeout']);
  const w2 = witness();
  const stopped = await send([item(5, 'Alpha'), item(6, 'Bravo')], down.fetch, w2);
  assert.deepEqual(w2.sleeps, [2000, 5000, 10000]);
  assert.equal(down.calls.length, 4);
  assert.ok(stopped.stopped);
  assert.equal(stopped.deactivated, null);
  assert.equal(stopped.remaining, 2);
  assert.match(w2.text(), /2 produits restent à importer/);
  assert.match(w2.text(), /relancez la même commande/);
});

test('envoi : un refus d’un seul produit (autre 4xx) est noté avec le message du serveur, et les suivants continuent', async () => {
  const { server } = await club();
  const { fetch } = door(server);
  const w = witness();

  const summary = await send([item(5, 'Alpha Robusto'), item(6, 'Prix cassé', { price: 12.5 }), item(7, 'Charlie Gordo')], fetch, w);

  assert.equal(summary.created, 2);
  assert.equal(summary.stopped, null);
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0].row, 6);
  assert.equal(summary.failures[0].name, 'Prix cassé');
  assert.equal(summary.failures[0].status, 400);
  assert.equal(summary.failures[0].code, 'INVALIDE');
  assert.match(summary.failures[0].message, /Prix de vente \(en francs\) : nombre entier attendu/);
  assert.deepEqual(server.club.all('SELECT reference FROM products ORDER BY id').map((p) => p.reference), ['CIG-001', 'CIG-002']);
  assert.match(w.text(), /Prix cassé/);
  assert.match(w.text(), /nombre entier attendu/);
  assert.match(w.text(), /1 échec/);
});

test('envoi : une réponse qui n’est pas celle du club, ou une redirection, arrête sans nouvel essai', async () => {
  const html = scripted([200, '<!doctype html><title>Autre site</title>']);
  const w = witness();
  const summary = await send([item(5, 'Alpha')], html.fetch, w);
  assert.equal(summary.stopped.code, 'REPONSE_INATTENDUE');
  assert.equal(html.calls.length, 1);
  assert.deepEqual(w.sleeps, []);

  const moved = scripted([301, '']);
  const stopped = await send([item(5, 'Alpha')], moved.fetch, witness());
  assert.equal(stopped.stopped.code, 'REDIRECTION');
  assert.equal(moved.calls.length, 1);
});

test('envoi : le premier appel (retrait des fictifs) refusé arrête tout : c’est l’installation qui est en cause, pas un produit', async () => {
  const gone = scripted(refusal(404, 'INTROUVABLE', 'Ressource inconnue.'));
  const summary = await send([item(5, 'Alpha'), item(6, 'Bravo')], gone.fetch, witness());
  assert.equal(gone.calls.length, 1);
  assert.equal(summary.stopped.code, 'INTROUVABLE');
  assert.equal(summary.remaining, 2);
});

test('envoi : un message du serveur qui répéterait le code ne l’affiche pas, et un code vide n’envoie rien', async () => {
  // In a refusal of one product, then in the refusal of the very first call.
  const product = scripted([200, { deactivated: 0 }], refusal(400, 'INVALIDE', `Fiche refusée avec le code ${TOKEN}`));
  const w = witness();
  const summary = await send([item(5, 'Alpha')], product.fetch, w);
  assert.equal(summary.failures.length, 1);
  assert.ok(!w.text().includes(TOKEN));
  assert.ok(!JSON.stringify(summary).includes(TOKEN));

  const first = scripted(refusal(400, 'INVALIDE', `Code ${TOKEN} refusé`));
  const w2 = witness();
  const stopped = await send([item(5, 'Alpha')], first.fetch, w2);
  assert.ok(stopped.stopped);
  assert.ok(!w2.text().includes(TOKEN));
  assert.ok(!JSON.stringify(stopped).includes(TOKEN));

  const never = scripted();
  for (const token of ['', '   ', null]) {
    await assert.rejects(() => send([item(5, 'Alpha')], never.fetch, witness(), token), /code d'import/i);
  }
  assert.equal(never.calls.length, 0);
});

// ---------------------------------------------------------------------------- the command line

// Three made-up cigars in a folder laid out as the owner's: the Excel file, two manifests and import/<slug>.webp.
function laidOut({ extraRows = [], extraEntries = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-test-'));
  folders.push(dir);
  const photos = path.join(dir, 'photos');
  fs.mkdirSync(path.join(photos, 'import'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'liste.xlsx'), workbook([
    ['liste fictive'], [], [],
    ['cigares ', 'prix'],
    ['alpha robusto', 11500],
    ['bravo corona', 4500],
    ['charlie gordo', 25000],
    ...extraRows,
  ]));
  const entries = [
    { input_name: 'alpha robusto', slug: 'alpha-robusto', official_name: 'Alpha Robusto 5 x 50', file: 'alpha-robusto.jpg', description_fr: 'Un robusto fictif.' },
    { input_name: 'bravo corona', slug: 'bravo-corona', official_name: null, file: null, description_fr: null },
    { input_name: 'charlie gordo', slug: 'charlie-gordo', official_name: 'Charlie Gordo', file: 'charlie-gordo.jpg', description_fr: 'Un gordo fictif.' },
    ...extraEntries,
  ];
  fs.writeFileSync(path.join(photos, 'manifest-A.json'), JSON.stringify(entries.slice(0, 2)));
  fs.writeFileSync(path.join(photos, 'manifest-B.json'), JSON.stringify(entries.slice(2)));
  fs.writeFileSync(path.join(photos, 'notes.txt'), 'pas un manifeste');
  fs.writeFileSync(path.join(photos, 'import', 'alpha-robusto.webp'), webp(2048, 1));
  fs.writeFileSync(path.join(photos, 'import', 'charlie-gordo.webp'), webp(4096, 2));
  return { dir, xlsx: path.join(dir, 'liste.xlsx'), photos };
}

// Runs the command line in this process: gives the exit code and what it printed. Unless a fetch is given, the
// network is closed, and a run that tried to use it fails the test.
async function cli(args, { env = {}, cwd, fetch, w = witness() } = {}) {
  let reached = false;
  const closed = async () => {
    reached = true;
    throw new Error('network closed');
  };
  const code = await main(args, { env, cwd, log: w.log, fetch: fetch ?? closed, sleep: w.sleep });
  assert.equal(reached, false, 'the command line reached the network');
  return { code, out: w.text(), w };
}

test('ligne de commande : sans --send, une simple vérification — une ligne par produit, le total, aucun envoi', async () => {
  const { dir, xlsx, photos } = laidOut();
  const { code, out } = await cli(['--xlsx', xlsx, '--photos', photos], { cwd: dir });

  assert.equal(code, 0, out);
  assert.match(out, /^.*Ligne\s+5\b.*Alpha Robusto 5 x 50.*11 500 FCFA.*photo 2 Ko.*description 18 caractères/m);
  assert.match(out, /^.*Ligne\s+6\b.*bravo corona.*4 500 FCFA.*sans photo.*sans description/m);
  assert.match(out, /^.*Ligne\s+7\b.*Charlie Gordo.*25 000 FCFA.*photo 4 Ko/m);
  assert.match(out, /3 produits/);
  assert.match(out, /2 avec photo/);
  assert.match(out, /1 sans photo/);
  assert.match(out, /Aucun problème/);
  assert.match(out, /Rien n'a été envoyé/);
  // The missing official name is a warning, not a problem.
  assert.match(out, /Ligne 6 « bravo corona » : pas de nom officiel/);
});

test('ligne de commande : les problèmes sont tous nommés, exit 1, et même avec --send rien n’est envoyé', async () => {
  const { dir, xlsx, photos } = laidOut({
    extraRows: [['delta gordo', 12.5], ['echo robusto', 3000]],
    extraEntries: [{ input_name: 'delta gordo', slug: 'delta-gordo', official_name: 'Delta Gordo', file: null, description_fr: null }],
  });
  const dry = await cli(['--xlsx', xlsx, '--photos', photos], { cwd: dir });
  assert.equal(dry.code, 1);
  assert.match(dry.out, /Ligne 8 « delta gordo » : prix invalide/);
  assert.match(dry.out, /Ligne 9 « echo robusto » : aucune fiche/);
  assert.match(dry.out, /2 problèmes/);
  assert.doesNotMatch(dry.out, /Aucun problème/);

  const sending = await cli(['--xlsx', xlsx, '--photos', photos, '--url', BASE, '--send'], { cwd: dir, env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(sending.code, 1);
  assert.match(sending.out, /Ligne 8 « delta gordo » : prix invalide/);
  assert.match(sending.out, /rien n'a été envoyé/i);
});

test('ligne de commande : les fichiers introuvables ou illisibles, une option inconnue et --help sont dits en français', async () => {
  const { dir, xlsx, photos } = laidOut();
  const missingXlsx = await cli(['--xlsx', path.join(dir, 'absent.xlsx'), '--photos', photos], { cwd: dir });
  assert.equal(missingXlsx.code, 1);
  assert.match(missingXlsx.out, /absent\.xlsx/);

  const missingPhotos = await cli(['--xlsx', xlsx, '--photos', path.join(dir, 'absent')], { cwd: dir });
  assert.equal(missingPhotos.code, 1);
  assert.match(missingPhotos.out, /dossier des photos/i);

  fs.writeFileSync(path.join(photos, 'manifest-C.json'), '{ pas du json');
  const broken = await cli(['--xlsx', xlsx, '--photos', photos], { cwd: dir });
  assert.equal(broken.code, 1);
  assert.match(broken.out, /manifest-C\.json/);
  fs.rmSync(path.join(photos, 'manifest-C.json'));

  const noManifest = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-test-'));
  folders.push(noManifest);
  assert.match((await cli(['--xlsx', xlsx, '--photos', noManifest], { cwd: dir })).out, /manifest-\*\.json/);

  const unknown = await cli(['--xlsx', xlsx, '--photos', photos, '--envoyer'], { cwd: dir });
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /--envoyer/);
  assert.match(unknown.out, /Usage/);

  const bare = await cli([], { cwd: dir });
  assert.equal(bare.code, 1);
  assert.match(bare.out, /--xlsx/);
  assert.match(bare.out, /--photos/);

  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /--token-file/);
  assert.match(help.out, /--send/);
});

test('ligne de commande : --send demande l’adresse du site, en https (le http n’est admis que pour la machine locale), et un code', async () => {
  const { dir, xlsx, photos } = laidOut();
  const base = ['--xlsx', xlsx, '--photos', photos, '--send'];
  const env = { IMPORT_TOKEN: TOKEN };

  const noUrl = await cli(base, { cwd: dir, env });
  assert.equal(noUrl.code, 1);
  assert.match(noUrl.out, /--url/);

  for (const url of ['http://club.example.com', 'ftp://club.example.com', 'club.example.com', 'https://nom:secret@club.example.com']) {
    const refused = await cli([...base, '--url', url], { cwd: dir, env });
    assert.equal(refused.code, 1, url);
    assert.match(refused.out, /adresse/i, url);
    assert.ok(!refused.out.includes('secret'), url);
  }

  const noCode = await cli([...base, '--url', 'https://club.example.com'], { cwd: dir });
  assert.equal(noCode.code, 1);
  assert.match(noCode.out, /IMPORT_TOKEN/);
  assert.match(noCode.out, /import-token\.local/);
  assert.match(noCode.out, /rien n'a été envoyé/i);
});

test('ligne de commande : le code vient de IMPORT_TOKEN, sinon du fichier (par défaut import-token.local, espaces et fin de ligne ôtés), jamais affiché', async () => {
  const { server } = await club({ token: 'code-du-fichier' });
  const { dir, xlsx, photos } = laidOut();
  const args = ['--xlsx', xlsx, '--photos', photos, '--url', BASE, '--send'];

  // The default file, in the folder the command runs from.
  fs.writeFileSync(path.join(dir, 'import-token.local'), '  code-du-fichier \n');
  const { fetch, calls } = door(server);
  const viaFile = await cli(args, { cwd: dir, fetch });
  assert.equal(viaFile.code, 0, viaFile.out);
  assert.equal(calls[0].headers.get('x-import-token'), 'code-du-fichier');
  assert.equal(productCount(server), 3);
  assert.ok(!viaFile.out.includes('code-du-fichier'));

  // The variable wins over the file; an empty one counts for nothing.
  const other = await club({ token: 'code-de-lenvironnement' });
  const second = door(other.server);
  const viaEnv = await cli(args, { cwd: dir, fetch: second.fetch, env: { IMPORT_TOKEN: 'code-de-lenvironnement' } });
  assert.equal(viaEnv.code, 0, viaEnv.out);
  assert.equal(second.calls[0].headers.get('x-import-token'), 'code-de-lenvironnement');
  assert.ok(!viaEnv.out.includes('code-de-lenvironnement'));
  const third = door(server);
  assert.equal((await cli(args, { cwd: dir, fetch: third.fetch, env: { IMPORT_TOKEN: '  ' } })).code, 0);
  assert.equal(third.calls[0].headers.get('x-import-token'), 'code-du-fichier');

  // Another file, by --token-file.
  fs.writeFileSync(path.join(dir, 'autre-code.txt'), 'code-du-fichier\n');
  fs.rmSync(path.join(dir, 'import-token.local'));
  const fourth = door(server);
  assert.equal((await cli([...args, '--token-file', 'autre-code.txt'], { cwd: dir, fetch: fourth.fetch })).code, 0);
  assert.equal(fourth.calls[0].headers.get('x-import-token'), 'code-du-fichier');
});

test('ligne de commande : un code vide, absent ou mal formé ne part jamais sur le réseau', async () => {
  const { dir, xlsx, photos } = laidOut();
  const args = ['--xlsx', xlsx, '--photos', photos, '--url', 'https://club.example.com', '--send'];
  fs.writeFileSync(path.join(dir, 'import-token.local'), ' \n');
  const empty = await cli(args, { cwd: dir });
  assert.equal(empty.code, 1);
  assert.match(empty.out, /vide/);

  for (const [label, content] of [['deux lignes', 'IMPORT_TOKEN=abc\nautre=def\n'], ['accent', 'cödé-secret'], ['tabulation', 'abc\tdef']]) {
    fs.writeFileSync(path.join(dir, 'import-token.local'), content);
    const bad = await cli(args, { cwd: dir });
    assert.equal(bad.code, 1, label);
    assert.match(bad.out, /une seule ligne/, label);
    assert.ok(!bad.out.includes('secret'), label);
    assert.ok(!bad.out.includes('abc'), label);
  }

  const missing = await cli([...args, '--token-file', 'nulle-part.txt'], { cwd: dir });
  assert.equal(missing.code, 1);
  assert.match(missing.out, /nulle-part\.txt/);
});

test('ligne de commande : --send va jusqu’au bout (exit 0), et s’arrête avec exit 1 sur un mauvais code', async () => {
  const { server } = await club();
  const { dir, xlsx, photos } = laidOut();
  const args = ['--xlsx', xlsx, '--photos', photos, '--url', `${BASE}/`, '--send'];

  const good = door(server);
  const run = await cli(args, { cwd: dir, env: { IMPORT_TOKEN: TOKEN }, fetch: good.fetch });
  assert.equal(run.code, 0, run.out);
  assert.equal(good.calls[0].url, `${BASE}/api/admin/catalog-import`);
  assert.deepEqual(server.club.all('SELECT name, reference FROM products ORDER BY id').map((p) => ({ ...p })), [
    { name: 'Alpha Robusto 5 x 50', reference: 'CIG-001' },
    { name: 'bravo corona', reference: 'CIG-002' },
    { name: 'Charlie Gordo', reference: 'CIG-003' },
  ]);
  assert.match(run.out, /3 créés/);
  assert.match(run.out, /0 mis à jour/);
  assert.match(run.out, /2 avec photo/);
  assert.match(run.out, /1 sans photo/);
  assert.match(run.out, /0 échec/);

  const wrong = door(server);
  const refused = await cli(args, { cwd: dir, env: { IMPORT_TOKEN: 'mauvais-code' }, fetch: wrong.fetch });
  assert.equal(refused.code, 1);
  assert.equal(wrong.calls.length, 1);
  assert.ok(!refused.out.includes('mauvais-code'));
});

test('ligne de commande : un produit refusé par le serveur donne exit 1 une fois les autres traités, avec son motif', async () => {
  const { dir, xlsx, photos } = laidOut();
  const { fetch, calls } = scripted(
    [200, { deactivated: 0 }],
    done(1),
    refusal(400, 'INVALIDE', 'Nom du produit : 80 caractères maximum.'),
    done(3),
  );
  const run = await cli(['--xlsx', xlsx, '--photos', photos, '--url', BASE, '--send'], { cwd: dir, env: { IMPORT_TOKEN: TOKEN }, fetch });
  assert.equal(run.code, 1);
  assert.equal(calls.length, 4);
  assert.match(run.out, /2 créés/);
  assert.match(run.out, /1 échec/);
  assert.match(run.out, /Ligne 6 « bravo corona » : Nom du produit : 80 caractères maximum/);
});

test('ligne de commande : lancé comme programme, il vérifie sans rien envoyer ; importé par un test, il ne lance rien', () => {
  const { dir, xlsx, photos } = laidOut();
  const run = spawnSync(process.execPath, [SCRIPT, '--xlsx', xlsx, '--photos', photos], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /3 produits/);
  assert.match(run.stdout, /11 500 FCFA/);

  const refused = spawnSync(process.execPath, [SCRIPT, '--xlsx', xlsx, '--photos', photos, '--url', 'https://club.example.com', '--send'], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /IMPORT_TOKEN/);

  const failing = spawnSync(process.execPath, [SCRIPT, '--xlsx', path.join(dir, 'absent.xlsx'), '--photos', photos], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(failing.status, 1);
});
