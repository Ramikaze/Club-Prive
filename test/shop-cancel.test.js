// Boutique cancellation: whole-sale refund by the original method, stock and card back, rights, and tickets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let ger;
let cig;
let cha;
let today;
let CIG;
let BTL;

const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
const sale = (who, body) => who.post('/api/shop/sales', body);
const cancel = (who, id, reason = 'Erreur de produit') => who.post(`/api/shop/sales/${id}/cancel`, { reason });
let n = 0;
const newMember = async () => ok(await ger.post('/api/members', { first_name: 'jean', last_name: `membre${++n}`, phone: `00 00 04 ${String(n).padStart(2, '0')}` }));
const events = (paymentId) => server.club.get('SELECT COUNT(*) AS n FROM ticket_events WHERE payment_id = ?', paymentId).n;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'cancel-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'cancel-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'cancel-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'cancel-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  today = (await admin.login('admin', 'cancel-admin-password')).biz_today;
  await ger.login('ger', 'cancel-ger-password');
  await cig.login('cig', 'cancel-cig-password');
  await cha.login('cha', 'cancel-cha-password');
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 10 })).id;
  BTL = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Bouteille test', reference: 'BTL', price: 50000 * UM, initial_stock: 5 })).id;
});
after(() => server.destroy());

test('l’associé du rayon annule : stock, argent et carte reviennent', async () => {
  const m = await newMember();
  ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: 20000 * UM, method: 'Espèces' }));
  const r = ok(await sale(ger, { account: 'alcool', buyer: { kind: 'membre', member_id: m.id },
    lines: [{ product_id: BTL, quantity: 1 }], card: true, method: 'Espèces' }));
  assert.equal(stockOf(BTL), 4);
  assert.equal(server.club.walletBalance(m.id), 0);
  const out = ok(await cancel(cha, r.sale.id));
  assert.ok(out.sale.cancelled_at);
  assert.equal(out.sale.cancel_reason, 'Erreur de produit');
  assert.equal(stockOf(BTL), 5);
  assert.equal(server.club.walletBalance(m.id), 20000 * UM);
  const refunds = server.club.all('SELECT * FROM refunds WHERE payment_id = ?', r.payment.id);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].card_amount, 20000 * UM);
  assert.equal(refunds[0].amount, 50000 * UM);
  assert.equal(refunds[0].method, 'Espèces');
  assert.equal(refunds[0].restocked, 1);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'boutique.vente.annuler'"));
  const t = ok(await ger.get(`/api/payments/${r.payment.id}/ticket`)).ticket;
  assert.equal(t.status, 'annule');
  assert.equal(t.client_line, `Jean MEMBRE${n} (${m.member_no})`.replace(/^Jean MEMBRE\d+/, `${t.member_first_name} ${t.member_last_name}`));
  const pub = ok(await new Client(server).get(`/api/tickets/${r.payment.id}/${r.payment.ticket_code}`, { 'cf-connecting-ip': '10.1.1.1' })).ticket;
  assert.equal(pub.status, 'annule');
  const j = ok(await admin.get(`/api/finance/journal?from=${today}`));
  assert.equal(j.refunds[0].shop_sale_id, r.sale.id);
});

test('ni le gérant ni l’autre associé n’annulent', async () => {
  const r = ok(await sale(ger, { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: BTL, quantity: 1 }], method: 'Espèces' }));
  refused(await cancel(ger, r.sale.id), 403);
  refused(await cancel(cig, r.sale.id), 403);
  assert.equal(stockOf(BTL), 4);
  assert.equal(server.club.get('SELECT cancelled_at FROM shop_sales WHERE id = ?', r.sale.id).cancelled_at, null);
  ok(await admin.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Contrôle admin' }));
  assert.equal(stockOf(BTL), 5);
});

test('une vente s’annule une seule fois et jamais ligne par ligne', async () => {
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 2 }], method: 'Espèces' }));
  const chargeId = r.sale.lines[0].charge_id;
  refused(await cig.post(`/api/charges/${chargeId}/refund`, { reason: 'Test', method: 'Espèces', restock: true }), 409, 'VENTE_BOUTIQUE');
  refused(await cig.post(`/api/charges/${chargeId}/cancel`, { reason: 'Test' }), 409, 'VENTE_BOUTIQUE');
  refused(await cig.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'x' }), 400);
  ok(await cancel(cig, r.sale.id));
  refused(await cancel(cig, r.sale.id), 409, 'DEJA_ANNULEE');
  assert.equal(stockOf(CIG), 10);
});

test('le ticket d’un client journalier ne porte aucune donnée personnelle', async () => {
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  const t = ok(await ger.get(`/api/payments/${r.payment.id}/ticket`)).ticket;
  assert.equal(t.client_line, 'Client journalier');
  assert.equal(t.member_phone, '');
  assert.equal(t.member_no, null);
  assert.equal(t.member_id, null);
  assert.equal(t.buyer_kind, 'journalier');
  assert.equal(t.shop_account, 'cigares');
  assert.equal(JSON.stringify(t).includes('JOURNALIER'), false);
  const pub = ok(await new Client(server).get(`/api/tickets/${r.payment.id}/${r.payment.ticket_code}`, { 'cf-connecting-ip': '10.1.1.2' })).ticket;
  assert.equal(pub.member_name, undefined);
  assert.equal(pub.member_no, undefined);
  ok(await cancel(cig, r.sale.id));
});

test('pas d’envoi WhatsApp pour un client journalier', async () => {
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  const id = r.payment.id;
  refused(await ger.post(`/api/payments/${id}/ticket-events`, { kind: 'whatsapp' }), 409, 'CLIENT_JOURNALIER');
  assert.equal(events(id), 0);
  const audits = server.club.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket.whatsapp'").n;
  assert.equal(audits, 0);
  assert.equal(ok(await ger.post(`/api/payments/${id}/ticket-events`, { kind: 'impression' })).copy_no, 1);

  const m = await newMember();
  const r2 = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'membre', member_id: m.id }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  ok(await ger.post(`/api/payments/${r2.payment.id}/ticket-events`, { kind: 'whatsapp' }));
  const t2 = ok(await ger.get(`/api/payments/${r2.payment.id}/ticket`)).ticket;
  assert.equal(t2.client_line, `${t2.member_first_name} ${t2.member_last_name} (${m.member_no})`);
});
