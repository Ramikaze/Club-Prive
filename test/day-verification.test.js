// The verification of the daily till (« Vérification de la caisse journalière »): a day closing carries who verified
// it and when, and the club notes the first business day of the feature. Days closed before that day stay as they were.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../shared/time.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true, dayVerification: true });
let admin;
let cig;
let ger;
let today;
let yesterday;
let twoAgo;
let bootSince;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
// The clock at noon of a business day.
const noon = (srv, day) => Date.parse(srv.club.dayStartIso(day)) + 12 * 3600 * 1000;

// A club with its three users, logged in; `today` is the real business day.
async function club() {
  const srv = new Server({}, { lenientTariffs: true, dayVerification: true });
  await srv.start();
  await srv.addUser('admin', 'Propriétaire', 'admin', 'verif-admin-password');
  await srv.addUser('cig', 'Associé cigares', 'associe', 'verif-cig-password', 'cigares');
  await srv.addUser('ger', 'Gérant', 'gerant', 'verif-ger-password');
  const c = { srv, admin: new Client(srv), cig: new Client(srv), ger: new Client(srv) };
  c.today = (await c.admin.login('admin', 'verif-admin-password')).biz_today;
  await c.cig.login('cig', 'verif-cig-password');
  await c.ger.login('ger', 'verif-ger-password');
  c.yesterday = addDays(c.today, -1);
  c.twoAgo = addDays(c.today, -2);
  return c;
}
// The cash fund two days ago; a cigar sale of `amount` at `at` (ms), by the gérant. Returns the product id.
async function fundAndSell(c, amount, at) {
  c.srv.club.at = noon(c.srv, c.twoAgo);
  ok(await c.admin.post('/api/treasury/fund', { amounts: { 'Espèces': 0 } }));
  c.cigar = ok(await c.admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 50000 * UM, initial_stock: 20 })).id;
  c.srv.club.run("UPDATE meta SET value = ? WHERE key = 'day_verification_since'", c.twoAgo);
  await sell(c, amount / 50000, at);
}
async function sell(c, quantity, at) {
  c.srv.club.at = at;
  ok(await c.ger.post('/api/shop/sales', { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: c.cigar, quantity }], method: 'Espèces' }));
  c.srv.club.at = null;
}

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'verif-admin-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'verif-cig-password', 'cigares');
  await server.addUser('ger', 'Gérant', 'gerant', 'verif-ger-password');
  admin = new Client(server);
  cig = new Client(server);
  ger = new Client(server);
  today = (await admin.login('admin', 'verif-admin-password')).biz_today;
  await cig.login('cig', 'verif-cig-password');
  await ger.login('ger', 'verif-ger-password');
  yesterday = addDays(today, -1);
  twoAgo = addDays(today, -2);
  // The scenario the next tests share: the fund two days ago, 100 000 of cigars sold yesterday and the day closed by
  // the gérant (not verified), 50 000 sold today, today left open.
  bootSince = server.club.get("SELECT value FROM meta WHERE key = 'day_verification_since'").value;
  const c = { srv: server, admin, cig, ger, today, yesterday, twoAgo };
  await fundAndSell(c, 100000, noon(server, yesterday));
  ok(await ger.post('/api/day-closing', { day: yesterday, checked: [], unchecked_reason: 'Essai', counts: { 'Espèces': 100000 * UM } }));
  await sell(c, 1, noon(server, today));
});
after(() => server.destroy());

test('V23 : la fermeture porte la vérification, et le jour de mise en service est noté', () => {
  const cols = server.club.all('PRAGMA table_info(day_closings)').map((c) => c.name);
  assert.ok(cols.includes('verified_at') && cols.includes('verified_by'));
  assert.equal(bootSince, today);
});

test('le solde validé exclut les journées non vérifiées ; validé + en attente = total', async () => {
  const b = ok(await admin.get('/api/caisses'));
  assert.equal(b.caisses.cigares.balance, 0);
  assert.equal(b.caisses.cigares.sold, 0);
  assert.equal(b.caisses.cigares.pending, 150000 * UM);
  assert.equal(b.pending_total, 150000 * UM);
  assert.equal(b.till_validated + b.pending_total, b.till);
  assert.deepEqual(b.pending_days.map((d) => [d.day, d.closed]), [[yesterday, true], [today, false]]);
  assert.equal(b.pending_days[0].closed_by_name, 'Gérant');
  assert.equal(b.pending_days[0].net.cigares, 100000 * UM);
  assert.equal(b.pending_days[1].total, 50000 * UM);
  assert.equal(b.verified_through, addDays(yesterday, -1));
  assert.equal(b.caisses.reservations.pending, 0);
});

test('prendre des bénéfices sur de l’argent en attente est refusé (CAISSE_INSUFFISANTE)', async () => {
  const before = server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n;
  const r = await cig.post('/api/caisses/retrait', { account: 'cigares', amount: 1000 * UM, method: 'Espèces' });
  refused(r, 409, 'CAISSE_INSUFFISANTE');
  assert.match(r.data.error.message, /l’argent en attente de vérification ne se dépense pas/);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n, before);
});

test('un paiement après minuit, avant le début du jour d’activité, compte pour la veille', async () => {
  const c = await club();
  try {
    // 30 minutes before the next business day starts: after midnight, still the evening of `yesterday`.
    await fundAndSell(c, 100000, Date.parse(c.srv.club.dayStartIso(c.today)) - 30 * 60 * 1000);
    const b = ok(await c.admin.get('/api/caisses'));
    assert.deepEqual(b.pending_days.map((d) => d.day), [c.yesterday]);
    assert.equal(b.caisses.cigares.pending, 100000 * UM);
    assert.equal(b.caisses.cigares.balance, 0);
  } finally { c.srv.destroy(); }
});

test('une dépense du gérant sur de l’argent en attente est refusée', async () => {
  const c = await club();
  try {
    await fundAndSell(c, 100000, noon(c.srv, c.yesterday));
    const cat = ok(await c.admin.get('/api/ledger/categories')).find((x) => x.code === 'achat_cigares').id;
    // The full balance (100 000, pending) would cover it; the available money (0) does not.
    const r = await c.ger.post('/api/ledger/entries', { kind: 'depense', category_id: cat, amount: 3000 * UM, method: 'Espèces' });
    refused(r, 409, 'CAISSE_INSUFFISANTE');
    // Once the money is validated, the same expense goes through.
    c.srv.club.run("UPDATE meta SET value = ? WHERE key = 'day_verification_since'", c.today);
    ok(await c.ger.post('/api/ledger/entries', { kind: 'depense', category_id: cat, amount: 3000 * UM, method: 'Espèces' }));
  } finally { c.srv.destroy(); }
});

test('un manque de caisse à la fermeture passe sur le solde complet', async () => {
  const c = await club();
  try {
    await fundAndSell(c, 100000, noon(c.srv, c.yesterday));
    // Réservation de séance holds nothing; the gap is covered by the full balance of its caisse, pending included:
    // the day's own sale is in Cigare, so put 5 000 pending in Réservation de séance via an apport on the day.
    const apport = ok(await c.admin.get('/api/ledger/categories')).find((x) => x.code === 'apport').id;
    c.srv.club.at = noon(c.srv, c.today);
    ok(await c.admin.post('/api/ledger/entries', { kind: 'recette', category_id: apport, account: 'reservations', amount: 5000 * UM, method: 'Espèces' }));
    c.srv.club.at = null;
    const res = ok(await c.ger.post('/api/day-closing', {
      day: c.today, checked: [], unchecked_reason: 'Essai', counts: { 'Espèces': 3000 * UM + 100000 * UM }, gap_reason: 'Monnaie en moins',
    }));
    assert.equal(res.closed.summary.accounts[0].gap, -2000 * UM);
    const b = ok(await c.admin.get('/api/caisses'));
    assert.equal(b.caisses.reservations.pending, 3000 * UM);
  } finally { c.srv.destroy(); }
});

test('sans fond de caisse : pending_days vide, rien ne casse', async () => {
  const c = await club();
  try {
    // Fund dated in the future: the tracking has not started (started: false), yet the money guard still works.
    c.srv.club.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('opening_balances', ?, ?)",
      JSON.stringify({ date: addDays(c.today, 3), amounts: { 'Espèces': 0 } }), new Date().toISOString());
    c.srv.club.cachedSettings = null;
    const b = ok(await c.admin.get('/api/caisses'));
    assert.equal(b.started, false);
    for (const k of ['reservations', 'alcool', 'cigares']) assert.equal(b.caisses[k].pending, 0);
    assert.deepEqual(b.pending_days, []);
    assert.equal(b.pending_total, 0);
    assert.equal(b.till_validated, 0);
    assert.equal(b.verified_through, c.today);
    const cat = ok(await c.admin.get('/api/ledger/categories')).find((x) => x.code === 'achat_cigares').id;
    refused(await c.ger.post('/api/ledger/entries', { kind: 'depense', category_id: cat, amount: 3000 * UM, method: 'Espèces' }), 409, 'CAISSE_INSUFFISANTE');
    refused(await c.admin.post('/api/caisses/retrait', { account: 'cigares', amount: 1000 * UM, method: 'Espèces' }), 409, 'CAISSE_INSUFFISANTE');
  } finally { c.srv.destroy(); }
});

test('les journées avant la mise en service comptent comme vérifiées', async () => {
  const c = await club();
  try {
    await fundAndSell(c, 100000, noon(c.srv, c.yesterday));
    c.srv.club.run("UPDATE meta SET value = ? WHERE key = 'day_verification_since'", c.today);
    const b = ok(await c.admin.get('/api/caisses'));
    assert.deepEqual(b.pending_days, []);
    assert.equal(b.caisses.cigares.balance, 100000 * UM);
    assert.equal(b.caisses.cigares.pending, 0);
    assert.equal(b.till_validated, b.till);
  } finally { c.srv.destroy(); }
});

test('le gérant ne peut pas vérifier (403)', async () => {
  refused(await ger.post(`/api/day-closing/${yesterday}/verify`, {}), 403);
});

test('une journée ouverte ne se vérifie pas (NON_FERMEE)', async () => {
  const r = await admin.post(`/api/day-closing/${today}/verify`, {});
  refused(r, 409, 'NON_FERMEE');
  assert.equal(r.data.error.message, 'La caisse de cette journée n’est pas encore fermée.');
});

test('les journées se vérifient dans l’ordre (JOURNEE_PRECEDENTE)', async () => {
  const c = await club();
  try {
    await fundAndSell(c, 100000, noon(c.srv, c.twoAgo));
    await sell(c, 2, noon(c.srv, c.yesterday));
    ok(await c.ger.post('/api/day-closing', { day: c.twoAgo, checked: [], unchecked_reason: 'Essai', counts: { 'Espèces': 100000 * UM } }));
    ok(await c.ger.post('/api/day-closing', { day: c.yesterday, checked: [], unchecked_reason: 'Essai', counts: { 'Espèces': 200000 * UM } }));
    const [y, m, d] = c.twoAgo.split('-');
    const r = await c.admin.post(`/api/day-closing/${c.yesterday}/verify`, {});
    refused(r, 409, 'JOURNEE_PRECEDENTE');
    assert.equal(r.data.error.message, `Vérifiez d’abord la caisse du ${d}/${m}/${y}.`);
    ok(await c.admin.post(`/api/day-closing/${c.twoAgo}/verify`, {}));
    ok(await c.admin.post(`/api/day-closing/${c.yesterday}/verify`, {}));
  } finally { c.srv.destroy(); }
});

test('vérifier fait passer l’argent dans le solde validé, tracé dans le journal', async () => {
  const before = ok(await admin.get(`/api/day-closing?day=${yesterday}`));
  assert.equal(before.net.cigares, 100000 * UM);
  assert.equal(before.closed.verified, null);
  const v = ok(await cig.post(`/api/day-closing/${yesterday}/verify`, {}));
  assert.equal(v.closed.verified.verified_by_name, 'Associé cigares');
  assert.ok(v.closed.verified.verified_at);
  const b = ok(await admin.get('/api/caisses'));
  assert.equal(b.caisses.cigares.balance, 100000 * UM);
  assert.equal(b.caisses.cigares.pending, 50000 * UM);
  assert.equal(b.verified_through, yesterday);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'caisse.verifier'"));
  const again = await admin.post(`/api/day-closing/${yesterday}/verify`, {});
  refused(again, 409, 'DEJA_VERIFIEE');
  assert.equal(again.data.error.message, 'La caisse de cette journée est déjà vérifiée.');
});

test('rouvrir une journée vérifiée remet son argent en attente', async () => {
  ok(await admin.post(`/api/day-closing/${yesterday}/reopen`, { reason: 'Erreur de saisie' }));
  let b = ok(await admin.get('/api/caisses'));
  assert.equal(b.caisses.cigares.balance, 0);
  assert.equal(b.caisses.cigares.pending, 150000 * UM);
  assert.equal(b.verified_through, addDays(yesterday, -1));
  const log = server.club.get("SELECT details FROM audit_log WHERE action = 'caisse.rouvrir' ORDER BY id DESC");
  assert.ok(JSON.parse(log.details).verifiee_le);
  // Close and verify again: the shared state ends with yesterday closed and verified, today open.
  ok(await ger.post('/api/day-closing', { day: yesterday, checked: [], unchecked_reason: 'Essai', counts: { 'Espèces': 100000 * UM } }));
  ok(await admin.post(`/api/day-closing/${yesterday}/verify`, {}));
  b = ok(await admin.get('/api/caisses'));
  assert.equal(b.caisses.cigares.balance, 100000 * UM);
  assert.equal(b.caisses.cigares.pending, 50000 * UM);
});

test('l’Accueil signale les caisses à vérifier aux administrateurs seulement', async () => {
  const c = await club();
  try {
    await fundAndSell(c, 100000, noon(c.srv, c.yesterday));
    ok(await c.ger.post('/api/day-closing', { day: c.yesterday, checked: [], unchecked_reason: 'Essai', counts: { 'Espèces': 100000 * UM } }));
    assert.deepEqual(ok(await c.admin.get('/api/dashboard')).days_to_verify, [c.yesterday]);
    assert.deepEqual(ok(await c.cig.get('/api/dashboard')).days_to_verify, [c.yesterday]);
    assert.deepEqual(ok(await c.ger.get('/api/dashboard')).days_to_verify, []);
    ok(await c.admin.post(`/api/day-closing/${c.yesterday}/verify`, {}));
    assert.deepEqual(ok(await c.admin.get('/api/dashboard')).days_to_verify, []);
  } finally { c.srv.destroy(); }
});
