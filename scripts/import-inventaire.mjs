// Inventory import, run from the owner's computer: it reads the local count drawn from the owner's inventory sheet
// (inventaire.local, never in the repository: the repository is public), checks it, then asks the site's temporary
// door (POST /api/admin/stock-import, worker/importStock.js) for a dry run, or sends it for real. The server sets each
// product's stock to the quantity counted by an « ajustement » carrying the inventory's reason.
//
//   node scripts/import-inventaire.mjs --data inventaire.local                          checks, sends nothing
//   node scripts/import-inventaire.mjs --data inventaire.local --url <site> --dry-run   the door's plan, writes nothing
//   node scripts/import-inventaire.mjs --data inventaire.local --url <site> --send      imports
//
// The door's code (IMPORT_TOKEN) is read as for the other imports (scripts/import-catalogue.mjs): the IMPORT_TOKEN
// variable or a file, never the command line, never printed. Run again, it moves nothing. Exit code 0 when all went
// well, 1 on any problem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importCode, siteAddress } from './import-catalogue.mjs';

const DOOR = '/api/admin/stock-import';
const SITE = 'https://club-prive.ramikaze.workers.dev';
const REQUEST_TIMEOUT_MS = 120000;
const ACTION = { creer: 'à créer', ajuste: 'ajusté', inchange: 'inchangé' };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v) => Number.isInteger(v) && v >= 0;

// The count, checked before anything is sent. Gives { body, total, problems }: `body` is what the door receives (only
// the fields it knows: a line's `source`, the sheet's own wording, stays here).
export function checkData(data) {
  const problems = [];
  if (!isObject(data) || !Array.isArray(data.items)) return { problems: ['Le fichier ne contient pas de liste « items » (JSON).'] };
  if (typeof data.reason !== 'string' || data.reason.trim().length < 3) problems.push('Le motif de l’inventaire (« reason ») manque.');
  data.items.forEach((item, i) => {
    const where = `Ligne ${i + 1}${item?.source ? ` (${item.source})` : ''}`;
    if (!isObject(item)) problems.push(`${where} : ligne invalide.`);
    else if (!whole(item.count)) problems.push(`${where} : la quantité doit être un nombre entier, 0 ou plus.`);
    else if ((item.reference === undefined) === (item.create === undefined)) problems.push(`${where} : une référence ou un produit à créer.`);
  });
  const total = data.items.reduce((n, item) => n + (isObject(item) && whole(item.count) ? item.count : 0), 0);
  if (data.expected_total !== undefined && data.expected_total !== total) {
    problems.push(`Le total des quantités (${total}) n’est pas le total attendu (${data.expected_total}).`);
  }
  const body = {
    reason: data.reason,
    items: data.items.map((item) => (isObject(item)
      ? Object.fromEntries(['reference', 'rename', 'create', 'count'].filter((k) => item[k] !== undefined).map((k) => [k, item[k]]))
      : item)),
  };
  return { body, total, problems };
}

async function callDoor({ baseUrl, token, body, fetch }) {
  const res = await fetch(`${baseUrl}${DOOR}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-import-token': token },
    body: JSON.stringify(body),
    redirect: 'manual', // a redirect is not followed: the code would go along to wherever it leads
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const USAGE = `Usage : node scripts/import-inventaire.mjs --data <fichier> [--url <adresse>] [--token-file <fichier>] [--dry-run | --send]
  --data <fichier>        le fichier de l'inventaire (JSON), par exemple inventaire.local
  --url <adresse>         l'adresse du site, par exemple ${SITE}
  --token-file <fichier>  le fichier qui contient le code d'import ; la variable IMPORT_TOKEN passe avant
  --dry-run               demande au site ce qu'il ferait, sans rien écrire
  --send                  envoie pour de bon`;

export async function main(argv, { env = process.env, cwd = process.cwd(), log = console.log, fetch = globalThis.fetch } = {}) {
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: { data: { type: 'string' }, url: { type: 'string' }, 'token-file': { type: 'string' }, 'dry-run': { type: 'boolean' }, send: { type: 'boolean' } },
      strict: true,
    }));
  } catch {
    log(USAGE);
    return 1;
  }
  if (!args.data) {
    log(USAGE);
    return 1;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.resolve(cwd, args.data), 'utf8'));
  } catch (err) {
    log(err.code === 'ENOENT' ? `Fichier introuvable : ${args.data}` : `Le fichier ${args.data} n'est pas un JSON lisible.`);
    return 1;
  }
  const checked = checkData(data);
  const problems = [...checked.problems];
  if (checked.body) log(`${checked.body.items.length} lignes, ${checked.total} pièces. Motif : ${checked.body.reason ?? '—'}`);
  if (args.send && args['dry-run']) problems.push('Choisissez --dry-run ou --send, pas les deux.');
  let target = null;
  if (args.send || args['dry-run']) {
    const site = args.url ? siteAddress(args.url) : { problem: `Il faut l'adresse du site avec --url (exemple : --url ${SITE}).` };
    const code = importCode({ env, cwd, tokenFile: args['token-file'] });
    problems.push(...[site.problem, code.problem].filter(Boolean));
    if (!site.problem && !code.problem) target = { baseUrl: site.baseUrl, token: code.token, origin: code.origin };
  }
  if (problems.length > 0) {
    log(`${problems.length} problème${problems.length > 1 ? 's' : ''} à corriger :`);
    for (const p of problems) log(`  - ${p}`);
    log("Rien n'a été envoyé.");
    return 1;
  }
  if (!target) {
    log("Aucun problème. Rien n'a été envoyé (simple vérification) : ajoutez --dry-run ou --send, avec --url <adresse du site>.");
    return 0;
  }
  const dryRun = !args.send;
  log(`${dryRun ? 'Essai à blanc' : 'Import'} vers ${target.baseUrl} ; code d'import lu ${target.origin}.`);
  let answer;
  try {
    answer = await callDoor({ baseUrl: target.baseUrl, token: target.token, body: { ...checked.body, dry_run: dryRun }, fetch });
  } catch (err) {
    log(`Le site ne répond pas : ${String(err.message).split(target.token).join('***')}`);
    return 1;
  }
  if (answer.status < 200 || answer.status >= 300 || !isObject(answer.data)) {
    log(`Refusé par le site (${answer.status}) : ${answer.data?.error?.message ?? 'réponse inattendue'}`);
    if (answer.data?.error?.code === 'CODE_ABSENT') log("Le code d'import n'est pas activé sur le site : npx wrangler secret put IMPORT_TOKEN.");
    log("Rien n'a été écrit.");
    return 1;
  }
  for (const i of answer.data.items) {
    const renamed = i.renamed_from ? ` (était « ${i.renamed_from} »)` : '';
    log(`  ${i.name} (${i.reference ?? 'nouveau'}) : ${i.before} → ${i.after} · ${ACTION[i.action] ?? i.action}${renamed}`);
  }
  const moving = answer.data.items.filter((i) => i.action !== 'inchange').length;
  log(`${moving} stock${moving > 1 ? 's' : ''} à ajuster ou produit${moving > 1 ? 's' : ''} à créer${dryRun ? '' : ' : fait'}.`);
  log(dryRun ? "Essai à blanc : rien n'a été écrit." : 'Inventaire importé.');
  return 0;
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
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
