// The « Dette reprise » of a regular client (spec docs/superpowers/specs/2026-11-17-dette-reprise-design.md): a debt
// from before the app, entered by the administrator or an associé, paid by the usual settlement (oldest debt first,
// each franc in the caisse chosen for it), never counted as a sale of the day it is entered.
// Every name and amount here is made up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, postSale } from './harness.js';
import { clientStatementWhatsAppText } from '../shared/wallet.js';

const server = new Server({});
let admin;
let ger;
let cha;
let CHP;

const tiles = (b) => b.fund.amount + b.cards + b.caisses.reservations.balance + b.caisses.alcool.balance + b.caisses.cigares.balance;
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
let n = 0;
const newClient = async () => ok(await ger.post('/api/clients', { first_name: 'awa', last_name: `reprise${++n}`, phone: `00 00 08 ${String(n).padStart(2, '0')}` }));
const carryover = (who, client, body) => who.post(`/api/clients/${client.id}/carryovers`, body);
const DIGIBOX = { amount: 150000 * UM, account: 'cigares', note: 'Reprise Digibox' };
const account = async (client) => ok(await ger.get(`/api/clients/${client.id}/account`));
const caisses = async () => ok(await admin.get('/api/caisses'));
const centralRule = async (what) => {
  const b = await caisses();
  assert.equal(tiles(b), b.till, `règle centrale (${what})`);
  return b;
};
const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'reprise-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'reprise-ger-password');
  await server.addUser('cha', 'Associé champagne', 'associe', 'reprise-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cha = new Client(server);
  await admin.login('admin', 'reprise-admin-password');
  await ger.login('ger', 'reprise-ger-password');
  await cha.login('cha', 'reprise-cha-password');
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne reprise', reference: 'CHR', price: 20000 * UM, initial_stock: 20 })).id;
  ok(await admin.post('/api/treasury/fund', { amounts: { 'Espèces': 100000 * UM } }));
});
after(() => server.destroy());

test('dette reprise : seuls l’administrateur et les associés l’ajoutent', async () => {
  const c = await newClient();
  refused(await carryover(ger, c, DIGIBOX), 403);
  const acc = ok(await carryover(cha, c, DIGIBOX));
  assert.equal(acc.owed, 150000 * UM);
  assert.equal(acc.credit_limit, 0);
  assert.equal(acc.movements.length, 1);
  const [move] = acc.movements;
  assert.equal(move.kind, 'reprise');
  assert.equal(move.label, 'Dette reprise — Reprise Digibox');
  assert.equal(move.due, 150000 * UM);
  assert.equal(move.balance, 150000 * UM);
  assert.equal(move.status, 'due');
  assert.equal(move.settled, 0);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'client.dette_reprise'"));
  assert.equal((await account(c)).owed, 150000 * UM);
});

test('dette reprise : refus', async () => {
  const c = await newClient();
  refused(await carryover(admin, c, { ...DIGIBOX, amount: 0 }), 400);
  refused(await carryover(admin, c, { ...DIGIBOX, account: 'reservations' }), 400);
  refused(await carryover(admin, c, { ...DIGIBOX, note: '' }), 400);
  const m = ok(await ger.post('/api/members', { first_name: 'jean', last_name: 'reprise', phone: '00 00 08 99' }));
  refused(await carryover(admin, m, DIGIBOX), 409, 'PAS_CLIENT');
  const off = await newClient();
  ok(await admin.post(`/api/members/${off.id}/deactivate`, { reason: 'Départ' }));
  refused(await carryover(admin, off, DIGIBOX), 409);
  assert.equal((await account(c)).owed, 0);
});

test('dette reprise : annulation', async () => {
  const c = await newClient();
  const acc = ok(await carryover(admin, c, DIGIBOX));
  const chargeId = acc.movements[0].charge_id;
  refused(await ger.post(`/api/clients/carryovers/${chargeId}/cancel`, { reason: 'Erreur de saisie' }), 403);
  refused(await admin.post(`/api/clients/carryovers/${chargeId}/cancel`, {}), 400);
  const after = ok(await cha.post(`/api/clients/carryovers/${chargeId}/cancel`, { reason: 'Erreur de saisie' }));
  assert.equal(after.owed, 0);
  assert.deepEqual(after.movements.map((x) => x.kind), ['reprise', 'annulation_reprise']);
  const undo = after.movements[1];
  assert.equal(undo.paid, 150000 * UM);
  assert.equal(undo.detail, 'Erreur de saisie');
  assert.equal(undo.balance, 0);
  assert.equal(after.movements[0].status, 'annulee');
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'client.dette_reprise_annulee'"));
  refused(await admin.post(`/api/clients/carryovers/${chargeId}/cancel`, { reason: 'Encore' }), 409);
});

test('règlement : la dette reprise est payée en premier, chaque part dans sa caisse', async () => {
  const c = await newClient();
  ok(await cha.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 200000 * UM }));
  // A credit sale of champagne first, then the old cigar debt: the old debt is still paid first.
  const sale = ok(await postSale(cha, {
    account: 'alcool', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: CHP, quantity: 1 }], credit: true,
  }));
  ok(await carryover(admin, c, { amount: 50000 * UM, account: 'cigares', note: 'Reprise Digibox' }));
  const before0 = await centralRule('avant');
  const r = ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 60000 * UM, method: 'Espèces' }));
  assert.equal(r.payment.by_account.cigares, 50000 * UM);
  assert.equal(r.payment.by_account.alcool, 10000 * UM);
  assert.equal(r.account.owed, 10000 * UM);
  const reprise = server.club.get('SELECT status, settled, amount FROM charges WHERE member_id = ? AND carryover = 1', c.id);
  assert.deepEqual([reprise.status, reprise.settled], ['payee', 50000 * UM]);
  const line = server.club.get('SELECT status, settled FROM charges WHERE shop_sale_id = ?', sale.sale.id);
  assert.deepEqual([line.status, line.settled], ['due', 10000 * UM]);
  const b = await centralRule('règlement');
  assert.equal(b.caisses.cigares.balance, before0.caisses.cigares.balance + 50000 * UM);
  assert.equal(b.caisses.alcool.balance, before0.caisses.alcool.balance + 10000 * UM);
  const t = ok(await ger.get(`/api/payments/${r.payment.id}/ticket`)).ticket;
  assert.equal(t.amount, 60000 * UM);
  assert.ok(JSON.stringify(t).includes('Dette reprise — Reprise Digibox'));
  // Paid in full: the reprise can no longer be cancelled.
  const chargeId = server.club.get('SELECT id FROM charges WHERE member_id = ? AND carryover = 1', c.id).id;
  refused(await admin.post(`/api/clients/carryovers/${chargeId}/cancel`, { reason: 'Erreur' }), 409, 'DEJA_REGLEE');

  // The settlement cancelled: the debt comes back, the cigar caisse gives the money back, no stock moves.
  const stock = stockOf(CHP);
  const acc = ok(await cha.post(`/api/payments/${r.payment.id}/cancel-settlement`, { reason: 'Erreur de montant' })).account;
  assert.equal(acc.owed, 70000 * UM);
  assert.equal(stockOf(CHP), stock);
  const b2 = await centralRule('annulation du règlement');
  assert.equal(b2.caisses.cigares.balance, before0.caisses.cigares.balance);
  assert.equal(b2.caisses.alcool.balance, before0.caisses.alcool.balance);
  ok(await admin.post(`/api/clients/carryovers/${chargeId}/cancel`, { reason: 'Erreur' }));
  assert.equal((await account(c)).owed, 20000 * UM);
});

test('dette reprise : un règlement partiel la laisse due et bloque son annulation', async () => {
  const c = await newClient();
  const acc = ok(await carryover(admin, c, { amount: 40000 * UM, account: 'cigares', note: 'Reprise Digibox' }));
  ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 15000 * UM, method: 'Espèces' }));
  const left = await account(c);
  assert.equal(left.owed, 25000 * UM);
  refused(await admin.post(`/api/clients/carryovers/${acc.movements[0].charge_id}/cancel`, { reason: 'Erreur' }), 409, 'DEJA_REGLEE');
});

test('plafond : la dette reprise compte', async () => {
  const c = await newClient();
  ok(await cha.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 60000 * UM }));
  ok(await carryover(admin, c, { amount: 50000 * UM, account: 'cigares', note: 'Reprise Digibox' }));
  refused(await postSale(cha, {
    account: 'alcool', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: CHP, quantity: 1 }], credit: true,
  }), 409, 'PLAFOND_CREDIT');
});

test('la dette reprise n’est pas une vente du jour', async () => {
  const today = ok(await admin.get('/api/me')).biz_today ?? (await admin.login('admin', 'reprise-admin-password')).biz_today;
  const c = await newClient();
  const cig = (s) => s.accounts.find((a) => a.account === 'cigares');
  const billedCount = (bl) => Object.values(bl.columns ?? bl).reduce((k, col) => k + (col.count ?? 0), 0);
  const sum0 = ok(await admin.get(`/api/finance/summary?from=${today}`));
  const bill0 = ok(await admin.get(`/api/finance/billed?from=${today}`));
  const dash0 = ok(await admin.get('/api/dashboard'));
  const open0 = ok(await admin.get('/api/finance/open'));
  ok(await carryover(admin, c, { amount: 80000 * UM, account: 'cigares', note: 'Reprise Digibox' }));
  const sum1 = ok(await admin.get(`/api/finance/summary?from=${today}`));
  assert.equal(cig(sum1).billed, cig(sum0).billed);
  assert.equal(cig(sum1).outstanding, cig(sum0).outstanding);
  assert.equal(cig(sum1).lines, cig(sum0).lines);
  assert.equal(billedCount(ok(await admin.get(`/api/finance/billed?from=${today}`))), billedCount(bill0));
  const dash1 = ok(await admin.get('/api/dashboard'));
  assert.equal(dash1.outstanding_total, dash0.outstanding_total);
  assert.equal(dash1.credit_total, dash0.credit_total + 80000 * UM);
  assert.deepEqual(ok(await admin.get('/api/finance/open')), open0);
  const purchases = ok(await admin.get(`/api/members/${c.id}/purchases`));
  assert.equal((purchases.lines ?? purchases).length, 0);
  const listed = ok(await admin.get(`/api/clients?q=${encodeURIComponent(c.last_name)}`));
  assert.equal((listed.clients ?? listed).find((x) => x.id === c.id).owed, 80000 * UM);
  // Settled: the money counts that day, as Boutique money of the cigar account.
  ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 30000 * UM, method: 'Espèces' }));
  const sum2 = ok(await admin.get(`/api/finance/summary?from=${today}`));
  assert.equal(cig(sum2).collected - cig(sum1).collected, 30000 * UM);
  assert.equal(cig(sum2).boutique.collected - cig(sum1).boutique.collected, 30000 * UM);
  assert.equal(cig(sum2).billed, cig(sum0).billed);
});

test('les routes générales des lignes refusent une dette reprise', async () => {
  const c = await newClient();
  const acc = ok(await carryover(admin, c, { amount: 40000 * UM, account: 'cigares', note: 'Reprise Digibox' }));
  const chargeId = acc.movements[0].charge_id;
  refused(await ger.post(`/api/charges/${chargeId}/cancel`, { reason: 'Erreur de saisie' }), 409, 'DETTE_REPRISE');
  ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 40000 * UM, method: 'Espèces' }));
  refused(await admin.post(`/api/charges/${chargeId}/refund`, { reason: 'Erreur', method: 'Espèces' }), 409, 'DETTE_REPRISE');
  const line = server.club.get('SELECT status, settled FROM charges WHERE id = ?', chargeId);
  assert.deepEqual([line.status, line.settled], ['payee', 40000 * UM]);
});

test('relevé du compte client : le nom et le téléphone pour la page A4', async () => {
  const c = await newClient();
  const acc = await account(c);
  assert.equal(acc.phone, c.phone);
  assert.equal(acc.name, `${c.first_name} ${c.last_name}`);
  // A file without a first name gets no leading space.
  const societe = ok(await ger.post('/api/clients', { last_name: 'société relevé' }));
  assert.equal((await account(societe)).name, 'SOCIÉTÉ RELEVÉ');
});

test('message WhatsApp du relevé client : neutre, daté, signé', () => {
  const text = clientStatementWhatsAppText({ clubName: 'Limen', day: '2026-11-17' });
  assert.equal(text, [
    'Bonjour,',
    'Voici le relevé de votre compte client au 17/11/2026.',
    'Relevé (ci-dessous)',
    'Merci de votre confiance. L’équipe Limen',
  ].join('\n'));
});
