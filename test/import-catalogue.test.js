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

test('lecture Excel : les numéros de ligne restent ceux d’Excel quand la feuille ne commence pas en A1', () => {
  // The first cell in use is B3, as in a file whose title and first rows were cleared: Excel saves the range of the
  // cells in use (B3:C6) and still counts the lines from its row 1. (`origin` alone leaves the range starting at A1.)
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['cigares', 'prix'], ['alpha', 2000], [], ['bravo', 3000]], { origin: 'B3' });
  sheet['!ref'] = 'B3:C6';
  XLSX.utils.book_append_sheet(book, sheet, 'Feuil1');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  assert.equal(XLSX.read(buffer, { type: 'buffer' }).Sheets.Feuil1['!ref'], 'B3:C6', 'the sheet really starts at B3');
  assert.deepEqual(readCatalogue(buffer), [
    { row: 4, name: 'alpha', price: 2000 },
    { row: 6, name: 'bravo', price: 3000 },
  ]);
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
  assert.match(alike.problems[0], /Nom en double « Edition limitée 2025 » : ligne 5 « alpha » et ligne 6 « bravo »\./);

  // The same cigar twice in the sheet.
  const twice = check({
    rows: [{ row: 5, name: 'alpha', price: 1000 }, { row: 6, name: 'bravo', price: 2000 }, { row: 8, name: 'Alpha ', price: 1000 }],
    manifests: [entry('alpha'), entry('bravo')],
    photos: { alpha: webp(), bravo: webp() },
  });
  assert.equal(twice.problems.length, 1, twice.problems.join('\n'));
  assert.match(twice.problems[0], /Nom en double « alpha officiel » : ligne 5 « alpha » et ligne 8 « Alpha »\./);

  const thrice = check({
    rows: [5, 6, 9].map((row) => ({ row, name: 'alpha', price: 1000 })),
    manifests: [entry('alpha')],
    photos: { alpha: webp() },
  });
  assert.match(thrice.problems.join('\n'), /ligne 5 « alpha », ligne 6 « alpha » et ligne 9 « alpha »\./);
});

test('préparation : un nom en double nomme chaque ligne d’Excel avec son nom, et dit quoi faire', () => {
  // Two cigars of the sheet, two fiches, one official name: the owner has to know which rows, and what to change.
  const two = check({
    rows: [{ row: 46, name: 'ALPHA RB', price: 8000 }, { row: 47, name: 'ALPHA ED. 2025', price: 9000 }],
    manifests: [
      entry('ALPHA RB', { official_name: 'Alpha Robusto' }),
      entry('ALPHA ED. 2025', { official_name: 'Alpha Robusto' }),
    ],
    photos: { 'alpha-rb': webp(), 'alpha-ed-2025': webp() },
  });
  assert.deepEqual(two.problems, [
    "Nom en double « Alpha Robusto » : ligne 46 « ALPHA RB » et ligne 47 « ALPHA ED. 2025 ». Deux produits ne peuvent pas porter le même nom : "
    + "le second écraserait le premier. Donnez à l'une des deux fiches son propre nom officiel, ou supprimez l'une des deux lignes du fichier Excel.",
  ]);
  assert.deepEqual(two.items, [
    { row: 46, slug: 'alpha-rb', name: 'Alpha Robusto', price: 8000, description: 'Une description.', photo: { mime: 'image/webp', bytes: webp() } },
    { row: 47, slug: 'alpha-ed-2025', name: 'Alpha Robusto', price: 9000, description: 'Une description.', photo: { mime: 'image/webp', bytes: webp() } },
  ]);

  // Three fiches: the same two ways out, for all but one of them.
  const three = check({
    rows: [{ row: 5, name: 'a1', price: 1000 }, { row: 6, name: 'a2', price: 1000 }, { row: 9, name: 'a3', price: 1000 }],
    manifests: ['a1', 'a2', 'a3'].map((name) => entry(name, { official_name: 'Nom commun' })),
    photos: { a1: webp(), a2: webp(), a3: webp() },
  });
  assert.equal(three.problems.length, 1, three.problems.join('\n'));
  assert.match(three.problems[0], /ligne 5 « a1 », ligne 6 « a2 » et ligne 9 « a3 »\./);
  assert.match(three.problems[0], /Donnez à chaque fiche sauf une son propre nom officiel, ou supprimez du fichier Excel les lignes en trop\.$/);

  // One fiche used by both rows: another official name is out of the question, only a row can go.
  const same = check({
    rows: [{ row: 5, name: 'alpha', price: 1000 }, { row: 8, name: 'ALPHA', price: 1000 }],
    manifests: [entry('alpha')],
    photos: { alpha: webp() },
  });
  assert.equal(same.problems.length, 1, same.problems.join('\n'));
  assert.match(same.problems[0], /ligne 5 « alpha » et ligne 8 « ALPHA »\./);
  assert.match(same.problems[0], /Ces lignes utilisent la même fiche : supprimez du fichier Excel les lignes en trop\.$/);
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
    // The message names every character the identifier may hold (dots and underscores are taken as well).
    assert.match(problems[0], /lettres, chiffres, tirets, points ou tirets bas, en commençant par une lettre ou un chiffre/, slug);
    assert.deepEqual(items, []);
  }
  assert.deepEqual(asked, []);

  // What the message promises is accepted.
  const ok = check({
    rows: [{ row: 5, name: 'alpha', price: 1000 }],
    manifests: [entry('alpha', { slug: 'alpha_1.2-b' })],
    photos: { 'alpha_1.2-b': webp() },
  });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.items[0].slug, 'alpha_1.2-b');
});

test('préparation : une fiche de manifeste qui n’est pas un objet JSON est signalée, sans arrêter la lecture des autres', () => {
  for (const bad of [null, 'texte', 42, true, [1, 2]]) {
    const { problems, items } = check({
      rows: [{ row: 5, name: 'alpha', price: 1000 }],
      manifests: [[bad, entry('alpha')]],
      photos: { alpha: webp() },
    });
    assert.deepEqual(problems, ["Une fiche des manifestes n'est pas un objet JSON."], JSON.stringify(bad));
    assert.equal(items.length, 1, JSON.stringify(bad));
  }
  // Alone in its manifest, it must not make the check fail with an error of its own.
  assert.match(check({ rows: [{ row: 5, name: 'alpha', price: 1000 }], manifests: [[null]] }).problems.join('\n'), /n'est pas un objet JSON/);
});

test('préparation : les noms et la description sont mis en forme Unicode NFC, comme le serveur les range', () => {
  // The same words written two ways: the capital E and the e with its accent as one character, or as a letter followed by
  // the combining acute accent (U+0301), which is how a Mac may write them.
  const composed = '\u00c9dition Sp\u00e9ciale';
  const decomposed = 'E\u0301dition Spe\u0301ciale';
  assert.notEqual(decomposed, composed);
  assert.notEqual(decomposed.length, composed.length);
  assert.equal(decomposed.normalize('NFC'), composed);

  // The official name and the description.
  const official = oneRow({ official_name: decomposed, description_fr: `Une e\u0301toile. ${decomposed}` });
  assert.deepEqual(official.problems, []);
  assert.equal(official.items[0].name, composed);
  assert.equal(official.items[0].name.length, composed.length);
  assert.equal(official.items[0].description, `Une \u00e9toile. ${composed}`);

  // No official name: the sheet's own name is the product's, in NFC as well, and found whichever way it was typed.
  const sheetName = check({
    rows: [{ row: 5, name: decomposed, price: 1000 }],
    manifests: [entry(composed, { slug: 'edition-speciale', official_name: null, file: null })],
  });
  assert.deepEqual(sheetName.problems, []);
  assert.equal(sheetName.items[0].name, composed);
  assert.equal(sheetName.warnings.length, 1);
});

test('préparation : une fiche sans nom ni identifiant est dite telle quelle, jamais « undefined »', () => {
  const { problems } = check({
    rows: [{ row: 5, name: 'alpha', price: 1000 }],
    manifests: [[entry('alpha'), { slug: 'sans-nom', official_name: 'Zéro' }, { input_name: 'zulu' }, { input_name: '  ', slug: 'blanc' }]],
    photos: { alpha: webp() },
  });
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.match(problems[0], /^Fiche sans nom \(sans-nom\) : le nom du cigare \(« input_name »\) manque/);
  assert.match(problems[1], /^Fiche « zulu » \(sans identifiant\) : aucune ligne du fichier Excel ne l'utilise\.$/);
  assert.match(problems[2], /^Fiche sans nom \(blanc\) : le nom du cigare/);
  assert.doesNotMatch(problems.join('\n'), /undefined/);

  // Two fiches of one name, one of them without identifier.
  const twin = check({
    rows: [{ row: 5, name: 'charlie', price: 1000 }],
    manifests: [[entry('charlie'), { input_name: 'charlie' }]],
    photos: { charlie: webp() },
  });
  assert.match(twin.problems.join('\n'), /Ligne 5 « charlie » : 2 fiches portent ce nom dans les manifestes \(charlie, sans identifiant\)/);
  assert.doesNotMatch(twin.problems.join('\n'), /undefined/);
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

// A `fetch` that answers from a script, one answer per call: [status, body], a function that makes the Response, or an
// Error to throw.
function scripted(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const answer = answers.shift();
    assert.ok(answer, 'the script made a call nobody planned');
    if (answer instanceof Error) throw answer;
    if (typeof answer === 'function') return answer();
    const [status, body] = answer;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}
const done = (n, extra = {}) => [200, { id: n, reference: `CIG-${String(n).padStart(3, '0')}`, status: 'created', photo: true, ...extra }];
const refusal = (status, code, message) => [status, { error: { code, message, details: null } }];
// A network failure as Node's fetch reports it: a TypeError « fetch failed », the system's code on its `cause`.
const netError = (code, detail = `connect ${code} 127.0.0.1:443`) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(detail), { code }) });
const noReply = () => netError('ECONNREFUSED');
// The 200 whose body breaks off halfway, as a connection that drops does.
const cutShort = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }), { status: 200 });

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

test('envoi : un 403 autre que CODE_INCORRECT, ou un 409 CATEGORIE_DIFFERENTE, est l’échec de ce produit seul : ni nouvel essai, ni pause, et le suivant part', async () => {
  const cases = [
    ['403 INTERDIT', refusal(403, 'INTERDIT', 'Accès interdit à cette fiche.'), { status: 403, code: 'INTERDIT', message: 'Accès interdit à cette fiche.' }],
    [
      '409 CATEGORIE_DIFFERENTE',
      refusal(409, 'CATEGORIE_DIFFERENTE', "Le produit « Bravo » existe déjà (catégorie bouteille) ; la fiche importée le range en cigare. Rien n'a été modifié."),
      { status: 409, code: 'CATEGORIE_DIFFERENTE', message: "Le produit « Bravo » existe déjà (catégorie bouteille) ; la fiche importée le range en cigare. Rien n'a été modifié." },
    ],
  ];
  for (const [label, answer, expected] of cases) {
    const { fetch, calls } = scripted([200, { deactivated: 0 }], done(1), answer, done(3));
    const w = witness();
    const summary = await send([item(5, 'Alpha'), item(6, 'Bravo'), item(7, 'Charlie')], fetch, w);

    assert.equal(calls.length, 4, label); // the retirement and three products, none sent twice
    assert.equal(calls[3].item.name, 'Charlie', label);
    assert.deepEqual(w.sleeps, [], label);
    assert.equal(summary.stopped, null, label);
    assert.equal(summary.created, 2, label);
    assert.equal(summary.remaining, 0, label);
    assert.deepEqual(summary.failures, [{ row: 6, name: 'Bravo', ...expected }], label);
    assert.match(w.text(), /1 échec/, label);
    assert.match(w.text(), /Ligne 6 « Bravo » : /, label);
  }
});

test('envoi : un nom qui n’existe que dans l’autre catégorie est refusé par le serveur (409), rien n’est écrit, et le produit suivant part', async () => {
  const { server } = await club();
  const actor = server.club.userRow(server.club.userByLogin('proprietaire').id);
  server.club.tx(() => server.club.createProduct(actor, { category: 'bouteille', name: 'Alpha Robusto', reference: 'BOU-001', price: 5000 * UM }));
  const bottle = () => ({ ...server.club.get("SELECT category, name, reference, price, active, description FROM products WHERE reference = 'BOU-001'") });
  const before = bottle();
  const { fetch, calls } = door(server);
  const w = witness();

  const summary = await send([item(5, 'Alpha Robusto'), item(6, 'Bravo Corona')], fetch, w);

  assert.equal(calls.length, 3);
  assert.deepEqual(w.sleeps, []);
  assert.equal(summary.stopped, null);
  assert.equal(summary.created, 1);
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0].row, 5);
  assert.equal(summary.failures[0].status, 409);
  assert.equal(summary.failures[0].code, 'CATEGORIE_DIFFERENTE');
  assert.match(summary.failures[0].message, /existe déjà \(catégorie bouteille\)/);
  // The refused call wrote nothing: the bottle is as it was, no cigar of that name was made, and the next one is CIG-001.
  assert.deepEqual(bottle(), before);
  assert.equal(server.club.get("SELECT COUNT(*) AS n FROM products WHERE lower(name) = 'alpha robusto'").n, 1);
  assert.equal(server.club.get("SELECT reference FROM products WHERE name = 'Bravo Corona'").reference, 'CIG-001');
  assert.match(w.text(), /ÉCHEC\s+Alpha Robusto : /);
});

test('envoi : le code ne s’affiche dans aucun message d’arrêt : ni sur le réseau, ni sur une erreur 5xx, ni sur un 429', async () => {
  // The calls that fail, each with a reason that repeats the code: the first try and every retry the run allows itself.
  const stops = [
    ['réseau', 'RESEAU', () => [1, 2, 3, 4].map(() => new Error(`échec avec le code ${TOKEN}`))],
    ['5xx', 'ERREUR_SERVEUR', () => [1, 2, 3, 4].map(() => refusal(500, 'ERREUR_SERVEUR', `Erreur interne du code ${TOKEN}`))],
    ['429', 'TROP_DE_TENTATIVES', () => [1, 2, 3].map(() => refusal(429, 'TROP_DE_TENTATIVES', `Adresse bloquée pour le code ${TOKEN}`))],
  ];
  for (const [label, code, failing] of stops) {
    // At the very first call, then in the middle of the products.
    for (const [where, before] of [['premier appel', []], ['en cours de route', [[200, { deactivated: 0 }], done(1)]]]) {
      const answers = [...before, ...failing()];
      const { fetch, calls } = scripted(...answers);
      const w = witness();
      const summary = await send([item(5, 'Alpha'), item(6, 'Bravo')], fetch, w);
      const what = `${label}, ${where}`;
      assert.equal(calls.length, answers.length, what);
      assert.equal(summary.stopped.code, code, what);
      // The reason is still told, with the code struck out.
      assert.match(summary.stopped.message, /le code \*\*\*|du code \*\*\*/, what);
      assert.ok(!w.text().includes(TOKEN), `${what} : ${w.text()}`);
      assert.ok(!JSON.stringify(summary).includes(TOKEN), what);
    }
  }
});

test('envoi : chaque appel part avec une limite de temps, et un appel qui reste sans réponse est retenté comme une panne de réseau', { timeout: 15000 }, async () => {
  // The limit travels with the call as a signal still running a moment later (the real one lasts two minutes).
  const signals = [];
  const slowButSure = async (url, init) => {
    signals.push(init.signal);
    await new Promise((resolve) => { setTimeout(resolve, 40); });
    return new Response(JSON.stringify({ deactivated: 0 }), { status: 200 });
  };
  await send([], slowButSure, witness());
  assert.equal(signals.length, 1);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.equal(signals[0].aborted, false);

  // A server that never answers: the limit ends the wait, and the call is tried again like any network failure.
  const silent = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const w = witness();
  const summary = await runImport({ items: [item(5, 'Alpha')], baseUrl: BASE, token: TOKEN, fetch: silent, log: w.log, sleep: w.sleep, timeoutMs: 20 });
  assert.deepEqual(w.sleeps, [2000, 5000, 10000]);
  assert.equal(summary.stopped.code, 'RESEAU');
  assert.match(w.text(), /Le serveur met trop de temps à répondre \(TimeoutError\)/);
});

test('envoi : une panne de réseau est dite en français, le code technique entre parenthèses ; un certificat refusé ou « fetch failed » donne l’astuce du VPN', async () => {
  const vpn = 'Un VPN (NordVPN par exemple) en est souvent la cause : déconnectez-le puis relancez la commande.';
  const certificate = (code) => [`certificat ${code}`, netError(code), `Le certificat de sécurité du site n'est pas accepté (${code})`, true];
  const slow = (code) => [`délai ${code}`, netError(code), `Le serveur met trop de temps à répondre (${code})`, false];
  const unknownAddress = (code) => [`adresse ${code}`, netError(code), `Adresse inconnue, vérifiez --url et la connexion internet (${code})`, false];
  const cases = [
    ['connexion refusée', noReply(), 'Le serveur ne répond pas à cette adresse (ECONNREFUSED)', false],
    unknownAddress('ENOTFOUND'),
    unknownAddress('EAI_AGAIN'),
    ['délai de la requête', new DOMException('The operation was aborted due to timeout', 'TimeoutError'), 'Le serveur met trop de temps à répondre (TimeoutError)', false],
    slow('ETIMEDOUT'),
    slow('UND_ERR_CONNECT_TIMEOUT'),
    certificate('CERT_HAS_EXPIRED'),
    certificate('DEPTH_ZERO_SELF_SIGNED_CERT'),
    certificate('SELF_SIGNED_CERT_IN_CHAIN'),
    certificate('UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
    certificate('ERR_TLS_CERT_ALTNAME_INVALID'),
    ['fetch failed sans précision', new TypeError('fetch failed'), 'La connexion a échoué (fetch failed)', true],
    ['fetch failed, autre code', netError('ECONNRESET'), 'La connexion a échoué (ECONNRESET)', true],
    ['autre erreur', new Error('boum'), 'Pas de réponse du serveur (boum)', false],
  ];
  for (const [label, error, said, withVpn] of cases) {
    const { fetch, calls } = scripted(error, error, error, error);
    const w = witness();
    const summary = await send([item(5, 'Alpha')], fetch, w);

    assert.equal(calls.length, 4, label);
    assert.deepEqual(w.sleeps, [2000, 5000, 10000], label);
    assert.equal(summary.stopped.code, 'RESEAU', label);
    assert.equal(summary.stopped.message, `${said}, après plusieurs essais.`, label);
    // Each wait tells the same thing in a few words; the stop gives the way out once.
    assert.deepEqual(w.lines.filter((line) => line.includes('nouvel essai')), [2, 5, 10].map((s) => `  ${said} : nouvel essai dans ${s} s…`), label);
    const stop = w.lines.indexOf(`ARRÊT (retrait des produits fictifs) : ${said}, après plusieurs essais.`);
    assert.notEqual(stop, -1, `${label} : ${w.text()}`);
    if (withVpn) {
      assert.equal(summary.stopped.hint, vpn, label);
      assert.equal(w.lines[stop + 1], vpn, label);
    } else {
      assert.equal(summary.stopped.hint, undefined, label);
      assert.doesNotMatch(w.text(), /VPN/, label);
    }
  }

  // In the middle of the products the stop says the same, with the row it stopped at.
  const midway = scripted([200, { deactivated: 0 }], done(1), ...[1, 2, 3, 4].map(() => netError('CERT_HAS_EXPIRED')));
  const w = witness();
  const summary = await send([item(5, 'Alpha'), item(6, 'Bravo')], midway.fetch, w);
  assert.equal(summary.created, 1);
  assert.equal(summary.stopped.row, 6);
  assert.equal(summary.stopped.hint, vpn);
  assert.match(w.text(), /ARRÊT \(ligne 6 « Bravo »\) : Le certificat de sécurité du site n'est pas accepté \(CERT_HAS_EXPIRED\), après plusieurs essais\./);
  assert.ok(w.lines.includes(vpn));
});

test('envoi : une réponse 200 coupée en route est retentée comme une panne de réseau, au lieu d’être prise pour une mauvaise adresse', async () => {
  const flaky = scripted(cutShort, [200, { deactivated: 0 }], cutShort, done(1));
  const w = witness();
  const summary = await send([item(5, 'Alpha')], flaky.fetch, w);
  assert.equal(flaky.calls.length, 4);
  assert.deepEqual(w.sleeps, [2000, 2000]);
  assert.equal(summary.created, 1);
  assert.equal(summary.stopped, null);
  assert.match(w.text(), /Pas de réponse du serveur \(terminated\) : nouvel essai dans 2 s…/);

  // Always cut: it ends as a network failure, not as « not the club's answer ».
  const broken = scripted(cutShort, cutShort, cutShort, cutShort);
  const w2 = witness();
  const stopped = await send([item(5, 'Alpha')], broken.fetch, w2);
  assert.equal(stopped.stopped.code, 'RESEAU');
  assert.deepEqual(w2.sleeps, [2000, 5000, 10000]);
  assert.doesNotMatch(w2.text(), /vérifiez l'adresse/);
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

  // A name under .localhost goes through the resolver, which may send it anywhere: only the machine itself is « local ».
  for (const url of ['http://club.example.com', 'ftp://club.example.com', 'club.example.com', 'https://nom:secret@club.example.com', 'http://club.localhost:8787']) {
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

test('ligne de commande : le http reste admis pour localhost, 127.0.0.1 et [::1], les trois adresses de la machine elle-même', async () => {
  const { dir, xlsx, photos } = laidOut();
  for (const url of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
    const { fetch, calls } = scripted([200, { deactivated: 0 }], done(1), done(2), done(3));
    const run = await cli(['--xlsx', xlsx, '--photos', photos, '--url', url, '--send'], { cwd: dir, env: { IMPORT_TOKEN: TOKEN }, fetch });
    assert.equal(run.code, 0, `${url} : ${run.out}`);
    assert.equal(calls.length, 4, url);
    assert.ok(run.out.includes(`vers ${url}`), url);
  }
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

test('ligne de commande : --send dit où le code a été lu, sans jamais l’afficher ; si la variable et le fichier existent tous deux, la variable passe avant', async () => {
  const { server } = await club({ token: 'code-du-fichier' });
  const { dir, xlsx, photos } = laidOut();
  const args = ['--xlsx', xlsx, '--photos', photos, '--url', BASE, '--send'];
  const file = path.join(dir, 'import-token.local');
  const run = async (extra, options) => {
    const result = await cli([...args, ...extra], { cwd: dir, fetch: door(server).fetch, ...options });
    assert.equal(result.code, 0, result.out);
    assert.ok(!result.out.includes('code-du-fichier'));
    return result.out;
  };

  // The file alone, the default one then another named on the command line.
  fs.writeFileSync(file, 'code-du-fichier\n');
  const viaFile = await run([]);
  assert.match(viaFile, /^Code d'import lu dans le fichier import-token\.local\.$/m);
  assert.doesNotMatch(viaFile, /variable/);
  fs.writeFileSync(path.join(dir, 'autre-code.txt'), 'code-du-fichier\n');
  assert.match(await run(['--token-file', 'autre-code.txt']), /^Code d'import lu dans le fichier autre-code\.txt\.$/m);

  // Both exist: the variable is the one read, and the line says it wins over the file.
  const both = await run([], { env: { IMPORT_TOKEN: 'code-du-fichier' } });
  assert.match(both, /^Code d'import lu dans la variable IMPORT_TOKEN \(le fichier import-token\.local existe aussi, mais la variable passe avant\)\.$/m);
  assert.match(await run(['--token-file', 'autre-code.txt'], { env: { IMPORT_TOKEN: 'code-du-fichier' } }), /\(le fichier autre-code\.txt existe aussi, mais la variable passe avant\)/);
  // An empty variable counts for nothing: the file is what is read.
  assert.match(await run([], { env: { IMPORT_TOKEN: '  ' } }), /^Code d'import lu dans le fichier import-token\.local\.$/m);

  // The variable alone.
  fs.rmSync(file);
  const viaEnv = await run([], { env: { IMPORT_TOKEN: 'code-du-fichier' } });
  assert.match(viaEnv, /^Code d'import lu dans la variable IMPORT_TOKEN\.$/m);
  assert.doesNotMatch(viaEnv, /existe aussi|passe avant/);

  // A run that is only a check reads no code, and says nothing of one.
  const dry = await cli(['--xlsx', xlsx, '--photos', photos], { cwd: dir, env: { IMPORT_TOKEN: 'code-du-fichier' } });
  assert.doesNotMatch(dry.out, /Code d'import lu/);
});

test('ligne de commande : un code refusé, on rappelle d’où il a été lu (une variable périmée passe avant le fichier à jour)', async () => {
  const { server } = await club({ token: 'code-du-fichier' });
  const { dir, xlsx, photos } = laidOut();
  const args = ['--xlsx', xlsx, '--photos', photos, '--url', BASE, '--send'];
  fs.writeFileSync(path.join(dir, 'import-token.local'), 'code-du-fichier\n');

  const stale = door(server);
  const viaEnv = await cli(args, { cwd: dir, env: { IMPORT_TOKEN: 'code-perime' }, fetch: stale.fetch });
  assert.equal(viaEnv.code, 1);
  assert.equal(stale.calls.length, 1);
  assert.match(viaEnv.out, /Code d'import incorrect/);
  assert.match(viaEnv.out, /^Rappel : le code refusé a été lu dans la variable IMPORT_TOKEN \(le fichier import-token\.local existe aussi, mais la variable passe avant\)\.$/m);
  for (const secret of ['code-perime', 'code-du-fichier']) assert.ok(!viaEnv.out.includes(secret), secret);

  // From the file this time: the server is changed under it.
  const other = await club({ token: 'autre-code' });
  const viaFile = await cli(args, { cwd: dir, fetch: door(other.server).fetch });
  assert.equal(viaFile.code, 1);
  assert.match(viaFile.out, /^Rappel : le code refusé a été lu dans le fichier import-token\.local\.$/m);
  assert.ok(!viaFile.out.includes('code-du-fichier'));

  // A run that works has nothing to recall.
  const fine = await cli(args, { cwd: dir, fetch: door(server).fetch });
  assert.equal(fine.code, 0, fine.out);
  assert.doesNotMatch(fine.out, /Rappel/);
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
