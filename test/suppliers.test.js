// Supplier accounts (spec docs/superpowers/specs/2026-11-07-comptes-fournisseurs-design.md): what the club owes each
// supplier, in FCFA, with an amount in EUR/USD for information only. A credit purchase moves no money; a payment is an
// expense of the supplier's caisse, never more than the club owes nor than the caisse holds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths } from '../shared/time.js';
import { Server, Client, ok, UM, fundCaisse } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let cig;
let cha;
let ger;
let today;
let categories;
let casa;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
const sheet = async (id) => ok(await admin.get(`/api/suppliers/${id}`));
const purchase = (who, id, body) => who.post(`/api/suppliers/${id}/purchases`, body);
const pay = (who, body) => who.post('/api/ledger/entries', { kind: 'depense', method: 'Espèces', ...body });
const categoryId = (code) => categories.find((c) => c.code === code).id;
const caisses = async () => ok(await admin.get('/api/caisses'));
const tilesAddUp = (b) => assert.equal(
  b.fund.amount + b.cards + b.caisses.reservations.balance + b.caisses.alcool.balance + b.caisses.cigares.balance, b.till,
);

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'fournisseurs-admin-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'fournisseurs-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'fournisseurs-cha-password', 'alcool');
  await server.addUser('ger', 'Gérant', 'gerant', 'fournisseurs-ger-password');
  admin = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  ger = new Client(server);
  today = (await admin.login('admin', 'fournisseurs-admin-password')).biz_today;
  await cig.login('cig', 'fournisseurs-cig-password');
  await cha.login('cha', 'fournisseurs-cha-password');
  await ger.login('ger', 'fournisseurs-ger-password');
  categories = ok(await admin.get('/api/ledger/categories'));
});
after(() => server.destroy());

test('création : l’administrateur et les associés créent un fournisseur, pas le gérant', async () => {
  casa = ok(await cha.post('/api/suppliers', { name: 'Casa Habanos', account: 'cigares', country: 'Espagne', currency: 'EUR' }));
  assert.equal(casa.name, 'Casa Habanos');
  assert.equal(casa.account, 'cigares');
  assert.equal(casa.account_label, 'Cigare');
  assert.equal(casa.country, 'Espagne');
  assert.equal(casa.currency, 'EUR');
  assert.equal(casa.due, 0);
  assert.equal(casa.active, true);
  assert.equal(casa.has_operations, false);
  refused(await ger.post('/api/suppliers', { name: 'Autre', account: 'cigares' }), 403);
  refused(await admin.post('/api/suppliers', { name: 'casa habanos', account: 'alcool' }), 409, 'FOURNISSEUR_EXISTANT');
  refused(await admin.post('/api/suppliers', { name: 'Réservations SA', account: 'reservations' }), 400);
  refused(await admin.post('/api/suppliers', { name: 'Sans devise', account: 'alcool', currency: 'GBP' }), 400);
  refused(await admin.post('/api/suppliers', { name: '', account: 'alcool' }), 400);
});

test('un achat à crédit ne bouge ni les caisses ni le solde en caisse', async () => {
  const before = await caisses();
  ok(await purchase(cig, casa.id, { kind: 'report', amount: 300000 * UM }));
  const s = ok(await purchase(cha, casa.id, {
    kind: 'achat', amount: 200000 * UM, foreign_amount: 30500, foreign_currency: 'EUR', reference: 'F-12',
  }));
  assert.deepEqual(await caisses(), before);
  assert.equal(s.totals.due, 500000 * UM);
  assert.equal(s.totals.purchases, 500000 * UM);
  assert.equal(s.totals.paid, 0);
  assert.deepEqual(s.lines.map((l) => [l.kind, l.due, l.paid, l.balance]), [
    ['report', 300000 * UM, 0, 300000 * UM],
    ['achat', 200000 * UM, 0, 500000 * UM],
  ]);
  assert.equal(s.lines[0].kind_label, 'Solde reporté');
  assert.equal(s.lines[0].label, 'Solde reporté');
  const achat = s.lines[1];
  assert.equal(achat.kind_label, 'Achat');
  assert.equal(achat.foreign_amount, 30500);
  assert.equal(achat.foreign_currency, 'EUR');
  assert.equal(achat.reference, 'F-12');
  assert.equal(achat.date, today);
  assert.equal(achat.status, 'active');
  assert.equal(achat.created_by_name, 'Associé champagne');
  assert.equal(s.supplier.due, 500000 * UM);
});

test('le montant en devise va avec sa devise', async () => {
  refused(await purchase(admin, casa.id, { kind: 'achat', amount: 1000 * UM, foreign_amount: 1500 }), 400);
  refused(await purchase(admin, casa.id, { kind: 'achat', amount: 1000 * UM, foreign_amount: 1500, foreign_currency: 'GBP' }), 400);
  refused(await purchase(admin, casa.id, { kind: 'achat', amount: 1000 * UM, foreign_currency: 'USD' }), 400);
  refused(await purchase(admin, casa.id, { kind: 'cadeau', amount: 1000 * UM }), 400);
  refused(await purchase(admin, casa.id, { kind: 'achat', amount: 0 }), 400);
  refused(await purchase(ger, casa.id, { kind: 'achat', amount: 1000 * UM }), 403);
  refused(await purchase(admin, 99999, { kind: 'achat', amount: 1000 * UM }), 404);
  assert.equal((await sheet(casa.id)).totals.due, 500000 * UM);
});

test('achat : date future refusée, mois clôturé refusé, jour fermé accepté', async () => {
  const other = ok(await admin.post('/api/suppliers', { name: 'Dates SARL', account: 'alcool' }));
  refused(await purchase(admin, other.id, { kind: 'achat', amount: 1000 * UM, biz_date: addDays(today, 1) }), 400);
  const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1);
  server.club.run("INSERT INTO closed_periods (month, closed_at, summary) VALUES (?, ?, '{}')", lastMonth.slice(0, 7), new Date().toISOString());
  refused(await purchase(admin, other.id, { kind: 'achat', amount: 1000 * UM, biz_date: lastMonth }), 409, 'PERIODE_CLOTUREE');
  server.club.run('DELETE FROM closed_periods');
  server.club.run("INSERT INTO day_closings (biz_day, closed_at, summary) VALUES (?, ?, '{}')", today, new Date().toISOString());
  ok(await purchase(admin, other.id, { kind: 'achat', amount: 1000 * UM, biz_date: today }));
  server.club.run('DELETE FROM day_closings');
  ok(await purchase(admin, other.id, { kind: 'report', amount: 2000 * UM, biz_date: addDays(today, -40) }));
  // The statement follows the dates, not the order of entry.
  const s = await sheet(other.id);
  assert.deepEqual(s.lines.map((l) => [l.kind, l.balance]), [['report', 2000 * UM], ['achat', 3000 * UM]]);
});

test('annuler un achat', async () => {
  const other = ok(await admin.post('/api/suppliers', { name: 'Annulations SARL', account: 'alcool' }));
  const s0 = ok(await purchase(admin, other.id, { kind: 'achat', amount: 5000 * UM }));
  ok(await purchase(admin, other.id, { kind: 'achat', amount: 7000 * UM }));
  const id = s0.lines[0].purchase_id;
  refused(await admin.post(`/api/suppliers/purchases/${id}/cancel`, { reason: 'x' }), 400);
  refused(await ger.post(`/api/suppliers/purchases/${id}/cancel`, { reason: 'Erreur de saisie' }), 403);
  const s = ok(await cig.post(`/api/suppliers/purchases/${id}/cancel`, { reason: 'Erreur de saisie' }));
  assert.equal(s.totals.due, 7000 * UM);
  const line = s.lines.find((l) => l.purchase_id === id);
  assert.equal(line.status, 'annulee');
  assert.equal(line.balance, null);
  assert.equal(line.cancel_reason, 'Erreur de saisie');
  assert.equal(line.cancelled_by_name, 'Associé cigares');
  assert.equal(s.lines.find((l) => l.purchase_id !== id).balance, 7000 * UM);
  refused(await admin.post(`/api/suppliers/purchases/${id}/cancel`, { reason: 'Encore' }), 409, 'DEJA_ANNULEE');
});

test('la caisse d’un fournisseur ne change plus après une opération ; désactivation seulement à zéro', async () => {
  refused(await admin.put(`/api/suppliers/${casa.id}`, { account: 'alcool' }), 409, 'CAISSE_VERROUILLEE');
  refused(await admin.put(`/api/suppliers/${casa.id}`, { active: false }), 409, 'DETTE_EN_COURS');
  const renamed = ok(await cig.put(`/api/suppliers/${casa.id}`, { name: 'Casa Habanos SL', contact: '+34 600 000 000', notes: 'Livraison par DHL' }));
  assert.equal(renamed.name, 'Casa Habanos SL');
  assert.equal(renamed.contact, '+34 600 000 000');
  assert.equal(renamed.notes, 'Livraison par DHL');
  assert.equal(renamed.account, 'cigares');
  assert.equal(renamed.country, 'Espagne');
  const fresh = ok(await admin.post('/api/suppliers', { name: 'Nouveau SARL', account: 'cigares' }));
  const moved = ok(await admin.put(`/api/suppliers/${fresh.id}`, { account: 'alcool', currency: 'USD' }));
  assert.equal(moved.account, 'alcool');
  assert.equal(moved.currency, 'USD');
  refused(await admin.put(`/api/suppliers/${fresh.id}`, { name: 'Casa Habanos SL' }), 409, 'FOURNISSEUR_EXISTANT');
  const off = ok(await admin.put(`/api/suppliers/${fresh.id}`, { active: false }));
  assert.equal(off.active, false);
  refused(await purchase(admin, fresh.id, { kind: 'achat', amount: 1000 * UM }), 409, 'FOURNISSEUR_INACTIF');
  refused(await ger.put(`/api/suppliers/${fresh.id}`, { active: true }), 403);
  assert.equal(ok(await admin.put(`/api/suppliers/${fresh.id}`, { active: true })).active, true);
});

test('liste : ce que le club doit, par caisse', async () => {
  const list = ok(await admin.get('/api/suppliers'));
  const sum = (account) => list.suppliers.filter((s) => s.account === account).reduce((t, s) => t + s.due, 0);
  assert.equal(list.totals.cigares, sum('cigares'));
  assert.equal(list.totals.alcool, sum('alcool'));
  assert.equal(list.totals.cigares, 500000 * UM);
  const c = list.suppliers.find((s) => s.id === casa.id);
  assert.equal(c.due, 500000 * UM);
  assert.equal(c.has_operations, true);
  assert.equal(c.last_date, today);
  refused(await ger.get('/api/suppliers'), 403);
  refused(await ger.get(`/api/suppliers/${casa.id}`), 403);
  refused(await admin.get('/api/suppliers/99999'), 404);
});

test('payer en partie : la dette et la caisse du fournisseur baissent ensemble', async () => {
  await fundCaisse(admin, 'cigares', 1000000 * UM);
  const before = await caisses();
  const entry = ok(await pay(cha, {
    category_id: categoryId('achat_cigares'), supplier_id: casa.id, amount: 200000 * UM, foreign_amount: 30000, foreign_currency: 'EUR',
  }));
  assert.equal(entry.supplier_id, casa.id);
  assert.equal(entry.supplier_name, 'Casa Habanos SL');
  assert.equal(entry.label, 'Paiement — Casa Habanos SL');
  assert.equal(entry.account, 'cigares');
  assert.equal(entry.foreign_amount, 30000);
  assert.equal(entry.foreign_currency, 'EUR');
  const s = await sheet(casa.id);
  assert.equal(s.totals.due, 300000 * UM);
  assert.equal(s.totals.paid, 200000 * UM);
  const last = s.lines.at(-1);
  assert.equal(last.kind, 'paiement');
  assert.equal(last.kind_label, 'Paiement');
  assert.equal(last.paid, 200000 * UM);
  assert.equal(last.due, 0);
  assert.equal(last.method, 'Espèces');
  assert.equal(last.entry_id, entry.id);
  assert.equal(last.foreign_amount, 30000);
  assert.equal(last.balance, 300000 * UM);
  const after = await caisses();
  assert.equal(after.caisses.cigares.purchases, before.caisses.cigares.purchases + 200000 * UM);
  assert.equal(after.caisses.cigares.balance, before.caisses.cigares.balance - 200000 * UM);
  tilesAddUp(after);
  const listed = ok(await admin.get(`/api/ledger/entries?from=${today}`)).entries.find((e) => e.id === entry.id);
  assert.equal(listed.supplier_name, 'Casa Habanos SL');
  const audit = server.club.get("SELECT details FROM audit_log WHERE action = 'operation.creer' AND entity_id = ?", entry.id);
  assert.equal(JSON.parse(audit.details).fournisseur, 'Casa Habanos SL');
});

test('jamais plus que ce que le club doit', async () => {
  const n = server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n;
  refused(await pay(admin, { category_id: categoryId('achat_cigares'), supplier_id: casa.id, amount: 300001 * UM }), 409, 'DEPASSE_DU');
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n, n);
});

test('jamais plus que ce que contient la caisse', async () => {
  const big = ok(await admin.post('/api/suppliers', { name: 'Grosse dette SA', account: 'alcool' }));
  ok(await purchase(admin, big.id, { kind: 'report', amount: 50000000 * UM }));
  refused(await pay(admin, { category_id: categoryId('achat_champagne'), supplier_id: big.id, amount: 40000000 * UM }), 409, 'CAISSE_INSUFFISANTE');
});

test('seulement depuis la caisse du fournisseur', async () => {
  const loyer = categories.find((c) => c.kind === 'depense' && c.name === 'Loyer').id;
  refused(await pay(admin, { category_id: categoryId('achat_champagne'), supplier_id: casa.id, amount: 1000 * UM }), 400);
  refused(await pay(admin, { category_id: loyer, supplier_id: casa.id, amount: 1000 * UM }), 400);
  refused(await admin.post('/api/ledger/entries', {
    kind: 'recette', category_id: categoryId('apport'), supplier_id: casa.id, amount: 1000 * UM, method: 'Espèces',
  }), 400);
  refused(await pay(admin, { category_id: categoryId('achat_cigares'), supplier_id: 99999, amount: 1000 * UM }), 404);
});

test('le gérant ne paie pas un fournisseur suivi', async () => {
  refused(await pay(ger, { category_id: categoryId('achat_cigares'), supplier_id: casa.id, amount: 4000 * UM }), 403);
});

test('devise sans fournisseur refusée', async () => {
  refused(await pay(admin, { category_id: categoryId('achat_cigares'), amount: 1000 * UM, foreign_amount: 1500, foreign_currency: 'EUR' }), 400);
});

test('annuler un paiement rend la dette ; annuler un achat dépassé par les paiements est refusé', async () => {
  // Casa owes 300 000 of 500 000 (report 300 000 + achat 200 000, paid 200 000); 200 000 more makes 400 000 paid.
  const second = ok(await pay(cig, { category_id: categoryId('achat_cigares'), supplier_id: casa.id, amount: 200000 * UM }));
  let s = await sheet(casa.id);
  assert.equal(s.totals.due, 100000 * UM);
  const achat = s.lines.find((l) => l.kind === 'achat');
  refused(await admin.post(`/api/suppliers/purchases/${achat.purchase_id}/cancel`, { reason: 'Facture en double' }), 409, 'PAIEMENTS_SUPERIEURS');
  const before = await caisses();
  ok(await admin.post(`/api/ledger/entries/${second.id}/cancel`, { reason: 'Erreur de saisie' }));
  s = await sheet(casa.id);
  assert.equal(s.totals.due, 300000 * UM);
  const cancelled = s.lines.find((l) => l.entry_id === second.id);
  assert.equal(cancelled.status, 'annulee');
  assert.equal(cancelled.balance, null);
  assert.equal(cancelled.cancel_reason, 'Erreur de saisie');
  assert.equal((await caisses()).caisses.cigares.balance, before.caisses.cigares.balance + 200000 * UM);
  s = ok(await admin.post(`/api/suppliers/purchases/${achat.purchase_id}/cancel`, { reason: 'Facture en double' }));
  assert.equal(s.totals.due, 100000 * UM);
});

test('un fournisseur payé puis désactivé garde sa dette si un paiement est annulé', async () => {
  const sup = ok(await admin.post('/api/suppliers', { name: 'Réactivé SARL', account: 'cigares' }));
  ok(await purchase(admin, sup.id, { kind: 'achat', amount: 10000 * UM }));
  const p = ok(await pay(admin, { category_id: categoryId('achat_cigares'), supplier_id: sup.id, amount: 10000 * UM }));
  assert.equal(ok(await admin.put(`/api/suppliers/${sup.id}`, { active: false })).active, false);
  ok(await admin.post(`/api/ledger/entries/${p.id}/cancel`, { reason: 'Virement rejeté' }));
  const listed = ok(await admin.get('/api/suppliers')).suppliers.find((s) => s.id === sup.id);
  assert.equal(listed.active, false);
  assert.equal(listed.due, 10000 * UM);
  assert.equal(ok(await admin.put(`/api/suppliers/${sup.id}`, { active: true })).active, true);
});

test('les fournisseurs sont au journal des opérations', async () => {
  const actions = new Set(server.club.all("SELECT action FROM audit_log WHERE action LIKE 'fournisseur.%'").map((r) => r.action));
  for (const a of ['fournisseur.creer', 'fournisseur.modifier', 'fournisseur.achat', 'fournisseur.achat_annuler']) assert.ok(actions.has(a), a);
  const created = server.club.get("SELECT user_id, details FROM audit_log WHERE action = 'fournisseur.creer' AND entity_id = ?", casa.id);
  assert.equal(created.user_id, server.club.get("SELECT id FROM users WHERE login = 'cha'").id);
  assert.equal(JSON.parse(created.details).nom, 'Casa Habanos');
});

test('la catégorie de dépense « Transport » existe et paie depuis la caisse choisie', async () => {
  const transport = categories.find((c) => c.kind === 'depense' && c.name === 'Transport');
  assert.ok(transport, 'catégorie Transport absente');
  assert.equal(transport.active, true);
  const e = ok(await pay(admin, { category_id: transport.id, account: 'cigares', amount: 5000 * UM, label: 'Fret cigares' }));
  assert.equal(e.account, 'cigares');
  // Added once on a database that already had its categories; deactivated by an administrator, it stays so.
  ok(await admin.put(`/api/ledger/categories/${transport.id}`, { active: false }));
  await server.restart();
  const again = server.club.get("SELECT active FROM categories WHERE kind = 'depense' AND name = 'Transport'");
  assert.equal(again.active, 0);
  assert.equal(server.club.get("SELECT COUNT(*) AS n FROM categories WHERE kind = 'depense' AND name = 'Transport'").n, 1);
});

test('effacer toutes les données efface aussi les fournisseurs', async () => {
  server.club.tx(() => server.club.wipeData({ id: null }, 'EFFACER'));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM suppliers').n, 0);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM supplier_purchases').n, 0);
});
