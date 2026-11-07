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
  // The sale's own cancellation, for the sheet and the member's file (the payment row itself is not cancelled).
  assert.equal(t.cancelled_at, null);
  assert.equal(t.shop_cancelled_at, out.sale.cancelled_at);
  assert.equal(t.shop_cancel_reason, 'Erreur de produit');
  const listed = ok(await ger.get(`/api/members/${m.id}`)).payments.find((p) => p.id === r.payment.id);
  assert.equal(listed.shop_cancelled_at, out.sale.cancelled_at);
  assert.equal(listed.shop_cancel_reason, 'Erreur de produit');
  assert.equal(t.client_line, `Jean MEMBRE${n} (${m.member_no})`.replace(/^Jean MEMBRE\d+/, `${t.member_first_name} ${t.member_last_name}`));
  const pub = ok(await new Client(server).get(`/api/tickets/${r.payment.id}/${r.payment.ticket_code}`, { 'cf-connecting-ip': '10.1.1.1' })).ticket;
  assert.equal(pub.status, 'annule');
  const j = ok(await admin.get(`/api/finance/journal?from=${today}`));
  assert.equal(j.refunds[0].shop_sale_id, r.sale.id);
});

test('le gérant n’annule pas ; l’autre associé annule en l’absence du premier', async () => {
  const r = ok(await sale(ger, { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: BTL, quantity: 1 }], method: 'Espèces' }));
  refused(await cancel(ger, r.sale.id), 403);
  assert.equal(stockOf(BTL), 4);
  assert.equal(server.club.get('SELECT cancelled_at FROM shop_sales WHERE id = ?', r.sale.id).cancelled_at, null);
  // The champagne associé is away: the cigars associé cancels his sale (spec, decision 8), and the journal says who.
  ok(await cancel(cig, r.sale.id));
  assert.equal(stockOf(BTL), 5);
  const by = server.club.get("SELECT user_id FROM audit_log WHERE action = 'boutique.vente.annuler' ORDER BY id DESC LIMIT 1").user_id;
  assert.equal(by, server.club.get("SELECT id FROM users WHERE login = 'cig'").id);
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
  assert.equal(t2.shop_cancelled_at, null);
});

test('le nom de la fiche cachée n’apparaît ni au grand livre, ni à l’historique des tickets, ni au journal', async () => {
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  ok(await ger.post(`/api/payments/${r.payment.id}/ticket-events`, { kind: 'impression' }));
  ok(await cig.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Erreur de caisse' }));
  const book = ok(await admin.get(`/api/ledger/book?from=${today}&to=${today}`));
  const rows = book.rows.filter((x) => x.ref === `ENC-${r.payment.id}` || /^RMB-/.test(x.ref ?? ''));
  assert.ok(rows.some((x) => x.ref === `ENC-${r.payment.id}`));
  assert.ok(rows.some((x) => x.type === 'remboursement' && x.detail.startsWith('Client journalier')));
  assert.ok(!JSON.stringify(book).includes('JOURNALIER'));
  const sheet = ok(await admin.get(`/api/export/grand-livre?from=${today}&to=${today}&format=json`));
  assert.ok(!JSON.stringify(sheet.rows).includes('JOURNALIER'));
  assert.ok(JSON.stringify(sheet.rows).includes('Client journalier'));
  const history = ok(await cig.get(`/api/ticket-events?from=${today}&to=${today}`));
  assert.equal(history.events.find((e) => e.payment_id === r.payment.id).member_name, 'Client journalier');
  // The employee filter of « Historique des tickets »: an associé cannot read /api/users, the history names the staff.
  assert.deepEqual(history.employees.map((u) => u.name).sort(), ['Associé champagne', 'Associé cigares', 'Gérant', 'Propriétaire']);
  assert.deepEqual(Object.keys(history.employees[0]).sort(), ['id', 'name']);
  // The Journal does not link the hidden row: it is marked as the day client.
  const audit = ok(await admin.get('/api/audit')).find((a) => a.action === 'paiement.enregistrer' && a.details?.payment_id === r.payment.id);
  assert.equal(audit.entity, 'member');
  assert.equal(audit.member_kind, 'journalier');
  const pub = ok(await new Client(server).get(`/api/tickets/${r.payment.id}/${r.payment.ticket_code}`, { 'cf-connecting-ip': '10.1.1.3' })).ticket;
  assert.equal(pub.initials, '');
});

test('un client régulier passé en membre garde son type d’acheteur sur la vente et sur son annulation', async () => {
  const c = ok(await ger.post('/api/clients', { first_name: 'awa', last_name: `client${++n}`, phone: `00 00 04 ${String(n).padStart(2, '0')}` }));
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  ok(await ger.post(`/api/clients/${c.id}/convert`, {}));
  ok(await cig.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Erreur de produit' }));
  const j = ok(await admin.get(`/api/finance/journal?from=${today}`));
  assert.equal(j.payments.find((p) => p.id === r.payment.id).buyer_kind, 'client');
  const refunds = j.refunds.filter((x) => x.shop_sale_id === r.sale.id);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].buyer_kind, 'client');
});

test('annulation d’une vente de deux lignes payée en partie par carte : chaque part revient par son chemin', async () => {
  const BIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Coffret test', reference: 'BIG', price: 50000 * UM, initial_stock: 2 })).id;
  const m = await newMember();
  ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: 20000 * UM, method: 'Espèces' }));
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'membre', member_id: m.id },
    lines: [{ product_id: CIG, quantity: 1 }, { product_id: BIG, quantity: 1 }], card: true, method: 'MTN MoMo' }));
  assert.equal(r.payment.amount, 55000 * UM);
  assert.equal(r.payment.card_amount, 20000 * UM);
  assert.equal(server.club.walletBalance(m.id), 0);
  ok(await cig.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Client parti' }));
  const refunds = server.club.all('SELECT amount, card_amount, method FROM refunds WHERE payment_id = ? ORDER BY id', r.payment.id).map((x) => ({ ...x }));
  assert.deepEqual(refunds, [
    { amount: 5000 * UM, card_amount: 5000 * UM, method: 'MTN MoMo' },
    { amount: 50000 * UM, card_amount: 15000 * UM, method: 'MTN MoMo' },
  ]);
  assert.equal(server.club.walletBalance(m.id), 20000 * UM);
  assert.equal(stockOf(BIG), 2);
  // What left the till by MoMo is the sale less its card part.
  const j = ok(await admin.get(`/api/finance/journal?from=${today}`));
  const out = j.refunds.filter((x) => x.shop_sale_id === r.sale.id).reduce((s, x) => s + x.amount - x.card_amount, 0);
  assert.equal(out, 35000 * UM);
});

test('journée fermée : l’annulation est refusée et rien ne bouge', async () => {
  const m = await newMember();
  ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: 2000 * UM, method: 'Espèces' }));
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'membre', member_id: m.id },
    lines: [{ product_id: CIG, quantity: 1 }], card: true, method: 'Espèces' }));
  const state = ok(await ger.get(`/api/day-closing?day=${today}`));
  const counts = {};
  for (const a of state.accounts) if (a.to_count) counts[a.method] = a.expected;
  ok(await ger.post('/api/day-closing', { day: today, checked: [], unchecked_reason: 'test de fermeture', counts }));
  const stock = stockOf(CIG);
  const refundsBefore = server.club.get('SELECT COUNT(*) AS n FROM refunds').n;
  const out = await cig.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Trop tard' });
  refused(out, 409, 'JOURNEE_FERMEE');
  assert.match(out.data.error.message, /administrateur ou un associé/);
  assert.equal(server.club.get('SELECT cancelled_at FROM shop_sales WHERE id = ?', r.sale.id).cancelled_at, null);
  assert.equal(stockOf(CIG), stock);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM refunds').n, refundsBefore);
  assert.equal(server.club.walletBalance(m.id), 0);
  assert.equal(ok(await ger.get(`/api/payments/${r.payment.id}/ticket`)).ticket.status, 'valide');
});
