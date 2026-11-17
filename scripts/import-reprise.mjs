// Digibox accounts import, run from the owner's computer (spec docs/superpowers/specs/2026-11-17-dette-reprise-design.md).
// It reads the local file drawn from the Digibox statements (reprise-digibox.local, never in the repository: the
// repository is public), checks it, then asks the site's temporary import door (POST /api/admin/accounts-import,
// worker/importAccounts.js) for a dry run, or sends it for real.
//
//   node scripts/import-reprise.mjs --data reprise-digibox.local                          checks, sends nothing
//   node scripts/import-reprise.mjs --data reprise-digibox.local --url <site> --dry-run   the door's plan, writes nothing
//   node scripts/import-reprise.mjs --data reprise-digibox.local --url <site> --send      imports
//
// The door's code (the Worker's IMPORT_TOKEN secret) is read as for the catalogue import (scripts/import-catalogue.mjs):
// the IMPORT_TOKEN variable or a file, never the command line, never printed. The import can be run again: the server
// never doubles a client, a debt or a supplier. Exit code 0 when all went well, 1 on any problem or conflict.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importCode, siteAddress } from './import-catalogue.mjs';

const DOOR = '/api/admin/accounts-import';
const SITE = 'https://club-prive.ramikaze.workers.dev';
const REQUEST_TIMEOUT_MS = 120000;
const CAISSES = { cigares: 'Cigare', alcool: 'Champagne et autres boissons' };

const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fcfa = (n) => `${grouped(n)} FCFA`;
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const positive = (v) => Number.isInteger(v) && v > 0;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// What the server answers for each line, in words; a conflict leaves the line alone and is for the owner to decide.
const ACTION = {
  creer: 'créer',
  creer_avec_dette: 'créer avec sa dette',
  existe: 'existe déjà, rien à faire',
  existe_dette_ajoutee: 'existe déjà, dette ajoutée',
  existe_solde_ajoute: 'existe déjà, solde ajouté',
  deja_repris: 'déjà repris, rien à faire',
  conflit_doit_deja: 'CONFLIT : doit déjà quelque chose dans l’application, dette non entrée',
  conflit_membre: 'CONFLIT : un membre porte ce nom, rien n’est fait',
  conflit_inactif: 'CONFLIT : sa fiche est désactivée, dette non entrée',
  conflit_homonyme: 'CONFLIT : une fiche proche existe déjà (même téléphone, ou même nom sans prénom), rien n’est fait',
  conflit_operations: 'CONFLIT : a déjà des opérations dans l’application, solde non entré',
};
const isConflict = (action) => action.startsWith('conflit_');

// The file, checked before anything is sent. Gives { body, clients, suppliers, total, problems }: `body` is what the
// door receives (only the fields it knows).
export function checkData(data) {
  const problems = [];
  if (!isObject(data)) return { problems: ['Le fichier ne contient pas une liste de clients et de fournisseurs (JSON).'] };
  const clients = Array.isArray(data.clients) ? data.clients : [];
  const suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  if (!Array.isArray(data.clients)) problems.push('Le fichier n’a pas de liste « clients ».');
  clients.forEach((c, i) => {
    if (!isObject(c) || blank(c.last_name)) problems.push(`Client n° ${i + 1} : nom manquant.`);
    else if (c.debt !== undefined && !positive(c.debt)) problems.push(`Client n° ${i + 1} (${c.last_name}) : la dette doit être un nombre entier de francs, plus grand que 0.`);
  });
  suppliers.forEach((s, i) => {
    if (!isObject(s) || blank(s.name)) problems.push(`Fournisseur n° ${i + 1} : nom manquant.`);
    else if (!CAISSES[s.account]) problems.push(`Fournisseur n° ${i + 1} (${s.name}) : caisse « cigares » ou « alcool » attendue.`);
    else if (s.carried_over !== undefined && !positive(s.carried_over)) problems.push(`Fournisseur n° ${i + 1} (${s.name}) : le solde reporté doit être un nombre entier de francs, plus grand que 0.`);
  });
  const total = clients.reduce((n, c) => n + (isObject(c) && positive(c.debt) ? c.debt : 0), 0);
  if (data.expected_total_clients !== undefined && data.expected_total_clients !== total) {
    problems.push(`Le total des dettes du fichier (${fcfa(total)}) n’est pas le total attendu (${fcfa(data.expected_total_clients)}).`);
  }
  const pick = (o, keys) => (isObject(o) ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : o);
  const body = {
    clients: clients.map((c) => pick(c, ['first_name', 'last_name', 'phone', 'email', 'notes', 'debt', 'account'])),
    suppliers: suppliers.map((s) => pick(s, ['name', 'account', 'country', 'currency', 'contact', 'notes', 'carried_over'])),
  };
  return { body, clients, suppliers, total, problems };
}

function preview({ clients, suppliers, total }, log) {
  for (const c of clients.filter(isObject)) {
    const name = [c.first_name, c.last_name].filter((x) => !blank(x)).join(' ') || '(sans nom)';
    log(`  ${name}${c.phone ? ` · ${c.phone}` : ' · sans téléphone'}${c.debt ? ` · dette ${fcfa(c.debt)}` : ''}`);
  }
  for (const s of suppliers.filter(isObject)) {
    log(`  Fournisseur « ${s.name} » · caisse ${CAISSES[s.account] ?? s.account}${s.carried_over ? ` · solde reporté ${fcfa(s.carried_over)}` : ''}`);
  }
  const withDebt = clients.filter((c) => isObject(c) && c.debt).length;
  log('');
  log(`${clients.length} clients, dont ${withDebt} avec une dette : ${fcfa(total)}.`);
  const owed = suppliers.reduce((n, s) => n + (isObject(s) && positive(s.carried_over) ? s.carried_over : 0), 0);
  log(`${suppliers.length} fournisseurs, soldes reportés : ${fcfa(owed)}.`);
}

// One call to the door; the code never appears in what is said back.
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

function report(answer, log) {
  const lines = [
    ...answer.clients.map((c) => ({ conflict: isConflict(c.action), text: `${c.name}${c.member_no ? ` (${c.member_no})` : ''} — ${ACTION[c.action] ?? c.action}${c.debt ? ` (${fcfa(c.debt)})` : ''}` })),
    ...answer.suppliers.map((s) => ({ conflict: isConflict(s.action), text: `Fournisseur « ${s.name} » — ${ACTION[s.action] ?? s.action}${s.carried_over ? ` (${fcfa(s.carried_over)})` : ''}` })),
  ];
  // Conflicts first: they are what the owner has to decide.
  for (const l of [...lines.filter((x) => x.conflict), ...lines.filter((x) => !x.conflict)]) log(`  ${l.text}`);
  log('');
  log(`Dettes ${answer.dry_run ? 'qui seraient entrées' : 'entrées'} : ${fcfa(answer.total_debt)}.`);
  return lines.filter((x) => x.conflict).length;
}

const USAGE = `Usage : node scripts/import-reprise.mjs --data <fichier> [--url <adresse>] [--token-file <fichier>] [--dry-run | --send]
  --data <fichier>        le fichier des comptes à reprendre (JSON), par exemple reprise-digibox.local
  --url <adresse>         l'adresse du site, par exemple ${SITE}
  --token-file <fichier>  le fichier qui contient le code d'import (par défaut import-token.local) ; la variable IMPORT_TOKEN passe avant
  --dry-run               demande au site ce qu'il ferait, sans rien écrire
  --send                  envoie pour de bon`;

// The command line, with what it needs from outside handed in so that a test can stand in for it. Gives the exit code.
export async function main(argv, { env = process.env, cwd = process.cwd(), log = console.log, fetch = globalThis.fetch } = {}) {
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: {
        data: { type: 'string' }, url: { type: 'string' }, 'token-file': { type: 'string' },
        'dry-run': { type: 'boolean' }, send: { type: 'boolean' },
      },
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
  if (checked.body) preview(checked, log);
  if (args.send && args['dry-run']) problems.push('Choisissez --dry-run ou --send, pas les deux.');

  let target = null;
  if (args.send || args['dry-run']) {
    const site = args.url ? siteAddress(args.url) : { problem: `Il faut l'adresse du site avec --url (exemple : --url ${SITE}).` };
    const code = importCode({ env, cwd, tokenFile: args['token-file'] });
    problems.push(...[site.problem, code.problem].filter(Boolean));
    if (!site.problem && !code.problem) target = { baseUrl: site.baseUrl, token: code.token, origin: code.origin };
  }
  if (problems.length > 0) {
    log('');
    log(`${problems.length} problème${problems.length > 1 ? 's' : ''} à corriger :`);
    for (const p of problems) log(`  - ${p}`);
    log("Rien n'a été envoyé.");
    return 1;
  }
  log('');
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
    const message = answer.data?.error?.message ?? 'réponse inattendue';
    log(`Refusé par le site (${answer.status}) : ${message}`);
    if (answer.data?.error?.code === 'CODE_ABSENT') log("Le code d'import n'est pas activé sur le site : npx wrangler secret put IMPORT_TOKEN.");
    log("Rien n'a été écrit.");
    return 1;
  }
  const conflicts = report(answer.data, log);
  log(dryRun ? "Essai à blanc : rien n'a été écrit." : 'Import terminé.');
  if (conflicts > 0) {
    log(`${conflicts} conflit${conflicts > 1 ? 's' : ''} : ${conflicts > 1 ? 'ces lignes sont laissées' : 'cette ligne est laissée'} de côté, à décider avec le propriétaire.`);
    return 1;
  }
  return 0;
}

// Runs only when the file is started as a program, not when a test imports it.
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
