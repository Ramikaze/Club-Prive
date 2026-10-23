// Catalogue import, run from the owner's computer. It reads the club's cigar list (an Excel sheet) and the folder of
// photos prepared for it, checks the two against each other, then sends the products one by one to the temporary
// import door of the site (POST /api/admin/catalog-import, worker/api.js).
//
//   node scripts/import-catalogue.mjs --xlsx <file.xlsx> --photos <folder>                      checks, sends nothing
//   node scripts/import-catalogue.mjs --xlsx <file.xlsx> --photos <folder> --url <site> --send
//
// The door's code (the Worker's IMPORT_TOKEN secret) comes from the IMPORT_TOKEN variable or from a file, never
// from the command line, where other programs can read it. It is not printed, not put in an address and not
// written down. The import can be run again as often as needed: the server updates the product that already
// bears a name instead of creating a second one. The exit code is 0 when all went well, 1 otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import XLSX from 'xlsx';
import { PHOTO_MAX_BYTES } from '../worker/photos.js';

const DOOR = '/api/admin/catalog-import';
const SITE = 'https://club-prive.ramikaze.workers.dev';
const SHEET = 'Feuil1';
// What the door takes (importCatalogItem in worker/club.js): the script refuses at home what the server would refuse.
const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const DESCRIPTION_LONG = 250; // longer is still taken, but the owner is told
const PRICE_MAX = 1000000000;
// Five wrong codes from one address lock the door for a minute (checkSecret in worker/api.js).
const LOCKED_WAIT_MS = 61000;
const LOCKED_RETRIES = 2;
const BACKOFF_MS = [2000, 5000, 10000];
const REQUEST_TIMEOUT_MS = 120000;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // a photo is import/<slug>.webp: no path can hide in a slug

// The way the server tells two names apart: capitals, spaces around and the way an accent is written do not count.
const sameName = (value) => String(value ?? '').trim().normalize('NFC').toLowerCase();
const blank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const count = (n, one, many) => `${n} ${n > 1 ? many : one}`; // 0 and 1 are singular in French
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fcfa = (n) => `${grouped(n)} FCFA`;
const ko = (bytes) => `${grouped(Math.ceil(bytes / 1024))} Ko`;
const listOf = (numbers) => (numbers.length < 2 ? numbers.join('') : `${numbers.slice(0, -1).join(', ')} et ${numbers.at(-1)}`);
const shown = (value) => {
  if (blank(value)) return 'vide';
  return typeof value === 'string' ? `« ${value} »` : String(value).replace('.', ',');
};
const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
const isWebp = (bytes) => bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';

// ---------------------------------------------------------------- the Excel sheet

// The sheet Feuil1 (else the first one) holds a title, blank rows, a header row with the columns « cigares » and
// « prix », then one row per cigar. Gives { row, name, price } for each row after the header that is not blank, `row`
// being the line number Excel shows. A row filled in half stays in the list, so that the checks name it.
export function readCatalogue(xlsx) {
  let book;
  try {
    book = XLSX.read(xlsx, { type: 'buffer' });
  } catch (err) {
    throw new Error(`Le fichier Excel ne peut pas être lu (${err.message}).`);
  }
  const sheetName = book.SheetNames.includes(SHEET) ? SHEET : book.SheetNames[0];
  const sheet = book.Sheets[sheetName];
  if (!sheet) throw new Error('Le fichier Excel ne contient aucune feuille.');
  const lines = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const firstLine = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0;
  const heading = (cell) => String(cell ?? '').trim().toLowerCase();
  const at = lines.findIndex((line) => line.some((cell) => heading(cell) === 'cigares') && line.some((cell) => heading(cell) === 'prix'));
  if (at < 0) {
    throw new Error(`En-tête introuvable dans la feuille « ${sheetName} » : une ligne avec les colonnes « cigares » et « prix » est attendue.`);
  }
  const nameColumn = lines[at].findIndex((cell) => heading(cell) === 'cigares');
  const priceColumn = lines[at].findIndex((cell) => heading(cell) === 'prix');
  const rows = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const [name, price] = [lines[i][nameColumn], lines[i][priceColumn]];
    if (blank(name) && blank(price)) continue;
    rows.push({ row: firstLine + i + 1, name: blank(name) ? '' : String(name).trim(), price: blank(price) ? '' : price });
  }
  return rows;
}

// ---------------------------------------------------------------- checking the sheet against the manifests

// The picture of an entry that has one: import/<slug>.webp, which must be a WebP file of a size the server takes.
// Gives { photo } or { problem }.
function pictureOf(entry, readPhoto) {
  if (typeof entry.slug !== 'string' || !SLUG.test(entry.slug)) {
    return { problem: "identifiant de photo invalide (le « slug » de la fiche : lettres, chiffres et tirets)." };
  }
  const where = `import/${entry.slug}.webp`;
  let bytes;
  try {
    bytes = readPhoto(entry.slug);
  } catch (err) {
    return { problem: `photo illisible (${err.message}).` };
  }
  if (bytes === null || bytes === undefined) return { problem: `photo introuvable (${where}).` };
  if (bytes.length > PHOTO_MAX_BYTES) return { problem: `photo trop lourde (${grouped(bytes.length)} octets, ${grouped(PHOTO_MAX_BYTES)} au plus).` };
  if (!isWebp(bytes)) return { problem: `la photo ${where} n'est pas une image WebP.` };
  return { photo: { mime: 'image/webp', bytes } };
}

// Pairs each row of the sheet with its entry in the photo manifests (by name) and checks everything the server would
// check, plus what only a look at the two lists shows: a row without entry, an entry without row, two products of
// one name. `manifests`: the entries of every manifest file (a list of lists is flattened). `readPhoto(slug)` gives the
// picture of import/<slug>.webp as a Buffer, or null when it is not there.
// Gives the products to send (a row with any problem is left out, and the caller sends nothing while there is a
// problem), the problems, and the warnings, which do not stop anything. Each is a sentence for the owner.
export function buildImport({ rows, manifests, readPhoto }) {
  const problems = [];
  const warnings = [];
  const items = [];
  const entries = manifests.flat();
  const readable = entries.filter((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
  if (readable.length < entries.length) problems.push("Une fiche des manifestes n'est pas un objet JSON.");
  if (rows.length === 0) problems.push('Le fichier Excel ne contient aucun cigare.');

  const byName = new Map();
  for (const entry of readable) {
    const key = sameName(entry.input_name);
    byName.set(key, [...(byName.get(key) ?? []), entry]);
  }
  const used = new Set();
  const named = []; // every row whose product name is settled, to find the names given twice

  for (const raw of rows) {
    const { row, price } = raw;
    const excelName = String(raw.name ?? '').trim();
    const here = excelName ? `Ligne ${row} « ${excelName} »` : `Ligne ${row}`;
    let wrong = false;
    const fail = (text) => {
      wrong = true;
      problems.push(`${here} : ${text}`);
    };
    const warn = (text) => warnings.push(`${here} : ${text}`);

    if (!excelName) fail('le nom du cigare manque dans le fichier Excel.');
    const found = excelName ? byName.get(sameName(excelName)) ?? [] : [];
    for (const entry of found) used.add(entry);
    if (excelName && found.length === 0) fail('aucune fiche dans les manifestes (manifest-*.json).');
    if (found.length > 1) fail(`${found.length} fiches portent ce nom dans les manifestes (${found.map((e) => e.slug).join(', ')}) : une seule est attendue.`);

    if (typeof price !== 'number' || !Number.isInteger(price) || price < 1 || price > PRICE_MAX) {
      fail(`prix invalide (${shown(price)}) : un nombre entier de francs, de 1 à ${grouped(PRICE_MAX)}, est attendu.`);
    }
    if (found.length !== 1) continue;

    const entry = found[0];
    // The product bears the official name of the entry; an entry that has none (a cigar not identified) keeps the
    // owner's own name from the sheet.
    const official = typeof entry.official_name === 'string' ? entry.official_name.trim().normalize('NFC') : '';
    const name = official || excelName.normalize('NFC');
    if (!official) warn('pas de nom officiel dans la fiche, le nom du fichier Excel est utilisé.');
    if (name.length > NAME_MAX) fail(`nom trop long (${name.length} caractères, ${NAME_MAX} au plus).`);
    named.push({ row, name });

    const description = typeof entry.description_fr === 'string' ? entry.description_fr.trim().normalize('NFC') : '';
    if (description.length > DESCRIPTION_MAX) fail(`description trop longue (${description.length} caractères, ${DESCRIPTION_MAX} au plus).`);
    else if (description.length > DESCRIPTION_LONG) warn(`description longue (${description.length} caractères ; ${DESCRIPTION_MAX} au plus).`);

    // An entry without `file` is a cigar the owner has no picture for: a product like another, without photo.
    let photo = null;
    if (!blank(entry.file)) {
      const picture = pictureOf(entry, readPhoto);
      if (picture.problem) fail(picture.problem);
      else photo = picture.photo;
    }
    if (!wrong) items.push({ row, slug: entry.slug, name, price, description: description || null, photo });
  }

  for (const entry of readable) {
    if (!used.has(entry)) problems.push(`Fiche « ${entry.input_name} » (${entry.slug}) : aucune ligne du fichier Excel ne l'utilise.`);
  }
  const byProduct = new Map();
  for (const { row, name } of named) {
    const key = sameName(name);
    byProduct.set(key, [...(byProduct.get(key) ?? []), { row, name }]);
  }
  for (const group of byProduct.values()) {
    if (group.length > 1) {
      const rowsOf = listOf(group.map((p) => p.row));
      problems.push(`Nom en double « ${group[0].name} » : lignes ${rowsOf}. Deux produits ne peuvent pas porter le même nom : le second écraserait le premier.`);
    }
  }
  return { items, problems, warnings };
}

// ---------------------------------------------------------------- sending to the door

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// The JSON body of the call for one product. A product without description or photo leaves the key out, so that the
// server keeps what the product already has. The picture goes as the strict base64 the server reads: no prefix, no line break.
const productBody = ({ name, price, description, photo }) => ({
  item: {
    name,
    price,
    category: 'cigare',
    ...(description ? { description } : {}),
    ...(photo ? { photo: { mime: photo.mime, data: Buffer.from(photo.bytes).toString('base64') } } : {}),
  },
});

async function readAnswer(res) {
  let data = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* not JSON: a proxy's page, an interrupted answer */ }
  const error = data?.error && typeof data.error === 'object' ? data.error : null;
  return {
    status: res.status,
    data,
    code: typeof error?.code === 'string' ? error.code : null,
    message: typeof error?.message === 'string' ? error.message : null,
  };
}

const reason = (err) => (err?.name === 'TimeoutError' ? 'délai dépassé' : err?.cause?.code ?? err?.code ?? err?.message ?? 'erreur inconnue');

// Sends the products to the door, the fictitious ones' retirement first. `items`: what buildImport gave. `fetch`
// and `sleep` can be replaced, so that a test neither reaches the network nor waits. Prints a line per product
// through `log` and the totals at the end, and gives the summary:
//   { deactivated, created, updated, withPhoto, withoutPhoto, failures: [{ row, name, status, code, message }],
//     stopped: null | { code, message, row?, name? }, remaining }
// `stopped` tells that the run could not go on (wrong code, server down...); `remaining` counts the products that
// were then left untouched. A product the server refuses is a failure, and the next one goes on.
export async function runImport({ items, baseUrl, token, fetch = globalThis.fetch, log = console.log, sleep = pause }) {
  if (typeof token !== 'string' || token.trim() === '') throw new Error("Le code d'import est vide : rien n'a été envoyé.");
  const url = new URL(DOOR, baseUrl).href;
  // What the server or the network says is shown, but never with the code in it.
  const hide = (text) => String(text ?? '').split(token).join('***');
  const headers = { 'content-type': 'application/json', 'x-import-token': token };

  // One call and the retries its answers call for. Gives { data } when it went through, { refused } when the server
  // turned down this very call, { stop } when the run cannot go on. Retrying a call is safe: the import is an upsert.
  async function call(body) {
    const payload = JSON.stringify(body);
    let locked = 0;
    let failed = 0;
    const retryLater = async (why) => {
      if (failed >= BACKOFF_MS.length) return false;
      const wait = BACKOFF_MS[failed];
      failed += 1;
      log(`  ${why} : nouvel essai dans ${wait / 1000} s…`);
      await sleep(wait);
      return true;
    };
    for (;;) {
      let res;
      try {
        // A redirect is not followed: the code would go along to wherever it leads.
        res = await fetch(url, { method: 'POST', headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (err) {
        const why = `Pas de réponse du serveur (${hide(reason(err))})`;
        if (await retryLater(why)) continue;
        return { stop: { code: 'RESEAU', message: `${why}, après plusieurs essais.` } };
      }
      const { status, data, code, message } = await readAnswer(res);
      if (status >= 200 && status < 300) {
        if (data !== null && typeof data === 'object' && !Array.isArray(data)) return { data };
        return { stop: { code: 'REPONSE_INATTENDUE', message: "La réponse n'est pas celle du club (ce n'est pas du JSON) : vérifiez l'adresse (--url)." } };
      }
      if (status >= 300 && status < 400) {
        return { stop: { code: 'REDIRECTION', message: `Le serveur renvoie vers une autre adresse (${status}) : vérifiez l'adresse (--url).` } };
      }
      // A wrong code is never tried again: five of them lock the address.
      if ((status === 403 && code === 'CODE_INCORRECT') || (status === 503 && code === 'CODE_ABSENT')) {
        return { stop: { code, message: hide(message) } };
      }
      if (status === 429) {
        if (locked < LOCKED_RETRIES) {
          locked += 1;
          log(`  Trop de tentatives : pause de ${LOCKED_WAIT_MS / 1000} s avant de réessayer…`);
          await sleep(LOCKED_WAIT_MS);
          continue;
        }
        return { stop: { code: code ?? 'TROP_DE_TENTATIVES', message: hide(message ?? "Trop de tentatives : l'adresse est bloquée pour le moment.") } };
      }
      if (status >= 500) {
        if (await retryLater(`Le serveur a répondu ${status}`)) continue;
        return { stop: { code: code ?? 'SERVEUR', message: hide(message ?? `Le serveur répond ${status} et ne s'en remet pas.`) } };
      }
      return { refused: { status, code, message: hide(message ?? `Réponse ${status} du serveur.`) } };
    }
  }

  const summary = { deactivated: null, created: 0, updated: 0, withPhoto: 0, withoutPhoto: 0, failures: [], stopped: null, remaining: items.length };
  const unexpected = { code: 'REPONSE_INATTENDUE', message: "La réponse du serveur n'a pas la forme attendue : vérifiez l'adresse (--url)." };

  // The last lines, whichever way the run ended.
  const conclude = () => {
    summary.remaining = items.length - summary.created - summary.updated - summary.failures.length;
    const { created, updated, failures, stopped } = summary;
    log('');
    if (stopped) {
      const step = summary.deactivated === null ? 'retrait des produits fictifs' : `ligne ${stopped.row} « ${stopped.name} »`;
      log(`ARRÊT (${step}) : ${stopped.message}`);
      if (stopped.code === 'CODE_INCORRECT') log("Vérifiez le code d'import. Cinq codes faux de suite bloquent l'adresse pendant une minute.");
      if (stopped.code === 'CODE_ABSENT') log("Le code d'import n'est pas (ou plus) activé sur le site : npx wrangler secret put IMPORT_TOKEN.");
    }
    const photos = `${summary.withPhoto} avec photo, ${summary.withoutPhoto} sans photo`;
    log(`Bilan : ${count(created, 'créé', 'créés')}, ${updated} mis à jour, ${photos}, ${count(failures.length, 'échec', 'échecs')}.`);
    for (const f of failures) log(`  - Ligne ${f.row} « ${f.name} » : ${f.message}`);
    if (summary.remaining > 0) {
      log(`${count(summary.remaining, 'produit reste', 'produits restent')} à importer.`);
      // After a wrong code, the same command would only be refused again, and five refusals lock the address.
      if (stopped?.code !== 'CODE_INCORRECT' && stopped?.code !== 'CODE_ABSENT') {
        log('Une fois le problème réglé, relancez la même commande : elle met à jour ce qui existe déjà sans le doubler.');
      }
    }
    return summary;
  };

  log('Retrait des produits fictifs de la vente…');
  const first = await call({ deactivate_demo_products: true });
  if (!first.data || !Number.isInteger(first.data.deactivated)) {
    // The very first call failing says the setup is wrong, not a product: nothing else is tried.
    const { code, message } = first.stop ?? first.refused ?? unexpected;
    summary.stopped = { code: code ?? 'REFUSE', message };
    return conclude();
  }
  summary.deactivated = first.data.deactivated;
  log(summary.deactivated === 0
    ? 'Aucun produit fictif à retirer.'
    : `${count(summary.deactivated, 'produit fictif retiré', 'produits fictifs retirés')} de la vente.`);

  const width = String(items.length).length;
  for (const [index, item] of items.entries()) {
    const position = `[${String(index + 1).padStart(width)}/${items.length}]`;
    const result = await call(productBody(item));
    if (result.refused) {
      const failure = { row: item.row, name: item.name, ...result.refused };
      summary.failures.push(failure);
      log(`${position} ÉCHEC    ${item.name} : ${failure.message}`);
      continue;
    }
    const answer = result.data;
    if (!result.data || !['created', 'updated'].includes(answer.status) || typeof answer.reference !== 'string') {
      summary.stopped = { ...(result.stop ?? unexpected), row: item.row, name: item.name };
      break;
    }
    summary[answer.status] += 1;
    summary[answer.photo ? 'withPhoto' : 'withoutPhoto'] += 1;
    const verb = answer.status === 'created' ? 'créé' : 'mis à jour';
    log(`${position} ${answer.reference.padEnd(8)} ${verb.padEnd(10)} ${item.name}  ${answer.photo ? 'avec photo' : 'sans photo'}`);
  }
  return conclude();
}

// ---------------------------------------------------------------- the command line

const USAGE = `Usage : node scripts/import-catalogue.mjs --xlsx <fichier.xlsx> --photos <dossier> [--url <adresse>] [--token-file <fichier>] [--send]

  --xlsx <fichier>        le fichier Excel du catalogue (feuille Feuil1, colonnes « cigares » et « prix »)
  --photos <dossier>      le dossier des photos : les manifest-*.json et import/<slug>.webp
  --send                  envoie vraiment le catalogue au site ; sans cette option, simple vérification, rien n'est envoyé
  --url <adresse>         l'adresse du site, avec --send : ${SITE}, ou http://localhost:8787 pour l'essai local
  --token-file <fichier>  le fichier qui contient le code d'import (par défaut import-token.local, dans le dossier courant) ;
                          la variable IMPORT_TOKEN, si elle existe, passe avant
  -h, --help              affiche cette aide`;

function loadManifests(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    throw new Error(`Dossier des photos introuvable : ${dir}`);
  }
  const files = names.filter((name) => /^manifest-.+\.json$/.test(name)).sort();
  if (files.length === 0) throw new Error(`Aucun fichier manifest-*.json dans le dossier des photos : ${dir}`);
  const entries = files.flatMap((file) => {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`${file} est illisible (${err.message}).`);
    }
    if (!Array.isArray(list)) throw new Error(`${file} doit contenir une liste de fiches.`);
    return list;
  });
  return { entries, files };
}

// The site's address: https anywhere, http for this very computer only, since a code sent over http travels in the open.
function siteAddress(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { problem: `L'adresse donnée avec --url n'est pas valide (exemple : ${SITE}).` };
  }
  if (url.username || url.password) return { problem: "L'adresse donnée avec --url ne doit contenir ni identifiant ni mot de passe." };
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return { baseUrl: url.origin };
  return { problem: "L'adresse donnée avec --url doit commencer par https:// (http:// n'est admis que pour localhost) : sinon le code circulerait en clair." };
}

// The door's code: the IMPORT_TOKEN variable if it holds anything, else the content of the token file (trimmed). It
// travels in an HTTP header, so it has to be one line of plain characters; it is refused otherwise, before any call
// is made (a code that arrives garbled counts as a wrong one, and five wrong ones lock the address).
function importCode({ env, cwd, tokenFile }) {
  const fromEnv = String(env.IMPORT_TOKEN ?? '').trim();
  const file = path.resolve(cwd, tokenFile ?? 'import-token.local');
  let token = fromEnv;
  if (!token) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { problem: `Code d'import introuvable : donnez-le par la variable IMPORT_TOKEN, ou écrivez-le seul dans le fichier ${file}.` };
      }
      return { problem: `Le fichier du code d'import ne peut pas être lu (${file}).` };
    }
    token = content.trim();
    if (!token) return { problem: `Le fichier du code d'import est vide (${file}).` };
  }
  if (!/^[\x20-\x7e]+$/.test(token)) {
    return { problem: "Le code d'import doit tenir sur une seule ligne, en caractères simples (lettres sans accent, chiffres, signes)." };
  }
  return { token };
}

function usageError(err) {
  const quoted = /'([^']+)'/.exec(err.message)?.[1] ?? '';
  if (err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return `option inconnue : ${quoted}`;
  if (err.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') return `l'option ${quoted.split(' ')[0]} demande une valeur`;
  return 'commande incomprise';
}

// One line per product for the check: its row, name, price, photo and description.
function preview(items) {
  if (items.length === 0) return [];
  const nameWidth = Math.max(...items.map((i) => i.name.length));
  const priceWidth = Math.max(...items.map((i) => fcfa(i.price).length));
  return items.map((i) => [
    `Ligne ${String(i.row).padStart(3)}`,
    i.name.padEnd(nameWidth),
    fcfa(i.price).padStart(priceWidth),
    (i.photo ? `photo ${ko(i.photo.bytes.length)}` : 'sans photo').padEnd(12),
    i.description ? `description ${i.description.length} caractères` : 'sans description',
  ].join(' · '));
}

// The command line, with what it needs from outside handed in so that a test can stand in for it. Gives the exit code.
export async function main(argv, { env = process.env, cwd = process.cwd(), log = console.log, fetch = globalThis.fetch, sleep } = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        xlsx: { type: 'string' }, photos: { type: 'string' }, url: { type: 'string' }, 'token-file': { type: 'string' },
        send: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (err) {
    log(`Erreur : ${usageError(err)}`);
    log(USAGE);
    return 1;
  }
  if (args.help) {
    log(USAGE);
    return 0;
  }
  if (!args.xlsx || !args.photos) {
    log('Erreur : --xlsx et --photos sont obligatoires.');
    log(USAGE);
    return 1;
  }

  const xlsxPath = path.resolve(cwd, args.xlsx);
  const photosDir = path.resolve(cwd, args.photos);
  let rows;
  let manifests;
  try {
    let book;
    try {
      book = fs.readFileSync(xlsxPath);
    } catch {
      throw new Error(`Fichier Excel introuvable ou illisible : ${xlsxPath}`);
    }
    rows = readCatalogue(book);
    manifests = loadManifests(photosDir);
  } catch (err) {
    log(`Erreur : ${err.message}`);
    return 1;
  }
  const readPhoto = (slug) => {
    try {
      return fs.readFileSync(path.join(photosDir, 'import', `${slug}.webp`));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  };
  const { items, problems, warnings } = buildImport({ rows, manifests: manifests.entries, readPhoto });
  const read = `Fichier Excel : ${count(rows.length, 'cigare', 'cigares')}.`;
  log(`${read} Photos : ${count(manifests.entries.length, 'fiche', 'fiches')} dans ${count(manifests.files.length, 'manifeste', 'manifestes')}.`);

  const withPhoto = items.filter((i) => i.photo).length;
  const weight = items.reduce((sum, i) => sum + (i.photo?.bytes.length ?? 0), 0);
  const totals = `${count(items.length, 'produit', 'produits')} : ${withPhoto} avec photo (${ko(weight)} en tout), ${items.length - withPhoto} sans photo`;

  // What sending needs besides the data: the site's address and the code. Their problems join the data's.
  let target = null;
  if (args.send) {
    const site = args.url ? siteAddress(args.url) : { problem: `--send demande l'adresse du site avec --url (exemple : --url ${SITE}).` };
    const code = importCode({ env, cwd, tokenFile: args['token-file'] });
    problems.push(...[site.problem, code.problem].filter(Boolean));
    if (!site.problem && !code.problem) target = { baseUrl: site.baseUrl, token: code.token };
  } else {
    for (const line of preview(items)) log(line);
    log('');
    log(`${totals}.`);
  }
  if (warnings.length > 0) {
    log('');
    log(`${count(warnings.length, 'avertissement', 'avertissements')} (rien de bloquant) :`);
    for (const warning of warnings) log(`  - ${warning}`);
  }
  if (problems.length > 0) {
    log('');
    log(`${count(problems.length, 'problème à corriger', 'problèmes à corriger')} :`);
    for (const problem of problems) log(`  - ${problem}`);
    log("Rien n'a été envoyé.");
    return 1;
  }

  log('');
  if (!args.send) {
    log("Aucun problème. Rien n'a été envoyé (simple vérification) : pour envoyer, ajoutez --send et --url <adresse du site>.");
    return 0;
  }

  log(`Envoi de ${totals}, vers ${target.baseUrl}`);
  let summary;
  try {
    summary = await runImport({ items, baseUrl: target.baseUrl, token: target.token, fetch, log, sleep });
  } catch (err) {
    log(`Erreur : ${String(err.message).split(target.token).join('***')}`);
    return 1;
  }
  return summary.stopped || summary.failures.length > 0 ? 1 : 0;
}

// Runs only when the file is started as a program, not when a test imports it. The file on disk is compared too,
// for the path that is the same file written another way (through a link, an accent in the other Unicode form).
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  if (import.meta.url === pathToFileURL(entry).href) return true;
  try {
    const self = fs.statSync(fileURLToPath(import.meta.url));
    const started = fs.statSync(entry);
    return self.dev === started.dev && self.ino === started.ino;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`Erreur inattendue : ${err.message}`);
    process.exitCode = 1;
  }
}
