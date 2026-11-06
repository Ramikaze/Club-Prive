// Boutique counter sale: stock, card, rights per rayon, idempotency, refusals that leave nothing behind, exports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let ger;
let cig;
let today;
let CIG;
let BTL;
let CIG2;

const count = (table) => server.club.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const counts = () => [count('shop_sales'), count('charges'), count('payments')];
const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
const sale = (who, body, headers) => who.post('/api/shop/sales', body, headers);
let n = 0;
const newMember = async () => ok(await ger.post('/api/members', { first_name: 'jean', last_name: `membre${++n}`, phone: `00 00 02 ${String(n).padStart(2, '0')}` }));
const newClient = async () => ok(await ger.post('/api/clients', { first_name: 'awa', last_name: `client${++n}`, phone: `00 00 03 ${String(n).padStart(2, '0')}` }));
const restock = (id, qty) => server.club.tx(() => server.club.moveStock(null, id, qty, 'ajustement', { reason: 'test' }));

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'sale-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'sale-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'sale-cig-password', 'cigares');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  await admin.login('admin', 'sale-admin-password');
  today = (await ger.login('ger', 'sale-ger-password')).biz_today;
  await cig.login('cig', 'sale-cig-password');
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 3 })).id;
  BTL = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Bouteille test', reference: 'BTL', price: 50000 * UM, initial_stock: 2 })).id;
  CIG2 = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test 2', reference: 'CIG2', price: 7000 * UM, initial_stock: 1 })).id;
});
after(() => server.destroy());

test('vente à un client journalier : stock baissé, ticket sans données personnelles', async () => {
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 2 }], method: 'Espèces' }));
  assert.equal(r.sale.amount, 10000 * UM);
  assert.equal(r.sale.buyer_kind, 'journalier');
  assert.equal(r.sale.member_no, '');
  assert.equal(r.sale.member_name, 'Client journalier');
  assert.equal(r.sale.payment_id, r.payment.id);
  assert.match(r.sale.ticket_number, /^T-\d{6,}$/);
  assert.equal(r.sale.lines.length, 1);
  assert.equal(r.sale.lines[0].quantity, 2);
  assert.equal(r.sale.lines[0].status, 'payee');
  assert.equal(r.payment.shop_sale_id, r.sale.id);
  assert.equal(stockOf(CIG), 1);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'boutique.vente'"));
  restock(CIG, 2);
});

test('un produit listé deux fois est une seule ligne', async () => {
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' },
    lines: [{ product_id: CIG, quantity: 1 }, { product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  assert.equal(r.sale.lines.length, 1);
  assert.equal(r.sale.lines[0].quantity, 2);
  restock(CIG, 2);
});

test('la carte du membre paie ce qu’elle peut, le reste en espèces', async () => {
  const m = await newMember();
  ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: 20000 * UM, method: 'Espèces' }));
  const r = ok(await sale(ger, { account: 'alcool', buyer: { kind: 'membre', member_id: m.id },
    lines: [{ product_id: BTL, quantity: 1 }], card: true, method: 'MTN MoMo' }));
  assert.equal(r.payment.card_amount, 20000 * UM);
  assert.equal(r.payment.method, 'MTN MoMo');
  assert.equal(r.sale.card_amount, 20000 * UM);
  assert.equal(r.sale.member_no, m.member_no);
  assert.equal(server.club.walletBalance(m.id), 0);
  restock(BTL, 1);
});

test('un associé ne vend pas dans l’autre rayon', async () => {
  const before = counts();
  refused(await sale(cig, { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: BTL, quantity: 1 }], method: 'Espèces' }),
    403, 'INTERDIT');
  refused(await sale(cig, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: BTL, quantity: 1 }], method: 'Espèces' }),
    400, 'RAYON');
  assert.deepEqual(counts(), before);
  ok(await sale(cig, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  restock(CIG, 1);
});

test('vente refusée sans trace quand le stock manque', async () => {
  const before = counts();
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 4 }], method: 'Espèces' }),
    409, 'STOCK_INSUFFISANT');
  // The first line would succeed alone: its charge and stock move must be rolled back with the failing second one.
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }, { product_id: CIG2, quantity: 2 }], method: 'Espèces' }),
    409, 'STOCK_INSUFFISANT');
  assert.deepEqual(counts(), before);
  assert.equal(stockOf(CIG), 3);
  assert.equal(stockOf(CIG2), 1);
});

test('double envoi : une seule vente', async () => {
  const body = { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' };
  const headers = { 'idempotency-key': 'boutique-test-0001' };
  const a = ok(await sale(ger, body, headers));
  const b = ok(await sale(ger, body, headers));
  assert.equal(b.payment.id, a.payment.id);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM shop_sales WHERE id = ?', a.sale.id).n, 1);
  assert.equal(stockOf(CIG), 2);
  restock(CIG, 1);
});

test('acheteur désactivé ou mauvais type refusé', async () => {
  const lines = [{ product_id: CIG, quantity: 1 }];
  const m = await newMember();
  ok(await admin.post(`/api/members/${m.id}/deactivate`, { reason: 'test de vente' }));
  const c = await newClient();
  ok(await admin.post(`/api/members/${c.id}/deactivate`, { reason: 'test de vente' }));
  const live = await newClient();
  const before = counts();
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'membre', member_id: m.id }, lines, method: 'Espèces' }), 409, 'MEMBRE_DESACTIVE');
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'client', member_id: c.id }, lines, method: 'Espèces' }), 409, 'MEMBRE_DESACTIVE');
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'membre', member_id: live.id }, lines, method: 'Espèces' }), 400);
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines, card: true, method: 'Espèces' }), 400);
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'client', member_id: live.id }, lines, card: true, method: 'Espèces' }), 400);
  assert.deepEqual(counts(), before);
  assert.equal(stockOf(CIG), 3);
});

test('export des encaissements : client journalier sans donnée personnelle', async () => {
  const day = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  const c = await newClient();
  const reg = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  for (const kind of ['encaissements', 'lignes']) {
    const sheet = ok(await admin.get(`/api/export/${kind}?from=${today}&to=${today}&format=json`));
    const iNo = sheet.header.indexOf('N° membre');
    const iName = sheet.header.indexOf('Membre');
    const iId = sheet.header.indexOf(kind === 'lignes' ? 'N° ligne' : 'N° encaissement');
    const idOf = (s) => (kind === 'lignes' ? s.lines[0].charge_id : s.payment_id);
    const dayRow = sheet.rows.find((r) => r[iId] === idOf(day.sale));
    const regRow = sheet.rows.find((r) => r[iId] === idOf(reg.sale));
    assert.equal(dayRow[iNo], '');
    assert.equal(dayRow[iName], 'Client journalier');
    assert.equal(regRow[iNo], c.member_no);
    assert.match(regRow[iNo], /^C-/);
    assert.equal(regRow[iName], `${c.first_name} ${c.last_name}`);
    assert.ok(!JSON.stringify(sheet.rows).includes('J-0000'));
    assert.ok(!JSON.stringify(sheet.rows).includes('JOURNALIER'));
  }
  const csv = await admin.get(`/api/export/encaissements?from=${today}&to=${today}`);
  assert.equal(csv.status, 200);
});

test('journée fermée : la vente est refusée', async () => {
  const lines = [{ product_id: CIG, quantity: 1 }];
  const state = ok(await ger.get(`/api/day-closing?day=${today}`));
  const counts_ = {};
  for (const a of state.accounts) if (a.to_count) counts_[a.method] = a.expected;
  ok(await ger.post('/api/day-closing', { day: today, checked: [], unchecked_reason: 'test de fermeture', counts: counts_ }));
  const before = counts();
  refused(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines, method: 'Espèces' }), 409, 'JOURNEE_FERMEE');
  assert.deepEqual(counts(), before);
});
