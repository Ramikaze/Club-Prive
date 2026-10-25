// Cash receipt, server side: check code at payment, codes for old payments, ticket settings, data reset.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Site, Client, ok, UM } from './harness.js';
import { formatTicketCode } from '../shared/ticket.js';

const SETUP_TOKEN = 'code-installation-test';
const server = new Server({ SETUP_TOKEN }, { lenientTariffs: true });
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;
let admin;
let manager;
let plan;

before(async () => {
  await server.start();
  admin = new Client(server);
  ok(await admin.post('/api/setup', { setup_token: SETUP_TOKEN, login: 'patron', name: 'Patron', password: 'mot-de-passe-patron' }));
  ok(await admin.post('/api/users', { login: 'gerant', name: 'Gérant', role: 'gerant', password: 'gerant-password-1' }));
  manager = new Client(server);
  await manager.login('gerant', 'gerant-password-1');
  plan = ok(await manager.get('/api/me')).plans.find((p) => p.code === 'MENSUELLE');
});
after(() => server.destroy());

async function collect(last) {
  const member = ok(await manager.post('/api/members', { first_name: 'Paul', last_name: last, phone: '+000 00 00 00 00' }));
  const sub = ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id }));
  return ok(await manager.post('/api/payments', { charge_ids: [sub.charge_id], method: 'Espèces' })).payment;
}

test('un encaissement reçoit un code de 12 caractères, différent d\'un paiement à l\'autre', async () => {
  const a = await collect('Un');
  const b = await collect('Deux');
  assert.match(a.ticket_code, CODE);
  assert.match(b.ticket_code, CODE);
  assert.notEqual(a.ticket_code, b.ticket_code);
});

test('les paiements existants reçoivent un code au démarrage', async () => {
  const p = await collect('Trois');
  const before = server.db.get('SELECT amount, paid_at FROM payments WHERE id = ?', p.id);
  server.db.run('UPDATE payments SET ticket_code = NULL');
  await server.restart();
  const rows = server.db.all('SELECT id, ticket_code, amount, paid_at FROM payments');
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.match(r.ticket_code, CODE);
  assert.equal(new Set(rows.map((r) => r.ticket_code)).size, rows.length);
  const after = rows.find((r) => r.id === p.id);
  assert.equal(after.amount, before.amount);
  assert.equal(after.paid_at, before.paid_at);
});

test('réglages du ticket', async () => {
  const s = ok(await admin.get('/api/me')).settings;
  assert.equal(s.ticket_header, '');
  assert.equal(s.ticket_footer, 'Merci de votre visite');
  assert.equal((await admin.put('/api/settings', { ticket_header: 'x'.repeat(201) })).status, 400);
  assert.equal((await admin.put('/api/settings', { ticket_header: 'a\nb\nc\nd\ne' })).status, 400);
  assert.equal((await admin.put('/api/settings', { ticket_footer: 'a\nb\nc' })).status, 400);
  assert.equal((await manager.put('/api/settings', { ticket_header: 'Bonjour' })).status, 403);
  const t = ok(await admin.put('/api/settings', { ticket_header: 'Ligne 1\nLigne 2', ticket_footer: 'A bientôt' })).settings;
  assert.equal(t.ticket_header, 'Ligne 1\nLigne 2');
  assert.equal(t.ticket_footer, 'A bientôt');
});

test('effacer toutes les données vide aussi les sorties de tickets', async () => {
  const p = await collect('Quatre');
  server.db.run("INSERT INTO ticket_events (payment_id, kind, copy_no, at) VALUES (?, 'impression', 1, ?)", p.id, new Date().toISOString());
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  assert.equal(server.db.get('SELECT COUNT(*) AS n FROM ticket_events').n, 0);
  assert.equal(server.db.get('SELECT COUNT(*) AS n FROM payments').n, 0);
});

// ---------------------------------------------------------------------------- the ticket API

// Each public scenario asks from its own address, so the failures of one never lock another.
const from = (ip) => ({ 'cf-connecting-ip': ip });
const PUBLIC_LEAKS = ['member_phone', 'member_name', 'member_no', 'reference', 'created_by_name', 'allocations', 'ticket_code'];

// A payment with its member, as `collect` makes, plus the charge ids so a test can refund a line.
async function collectWithCharge(last) {
  const member = ok(await manager.post('/api/members', { first_name: 'Paul', last_name: last, phone: '+000 11 11 11 11' }));
  const sub = ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id }));
  const payment = ok(await manager.post('/api/payments', { charge_ids: [sub.charge_id], method: 'Espèces' })).payment;
  return { member, payment, chargeId: sub.charge_id };
}

test('ticket du personnel : numéro, téléphone, prochaine sortie ; sorties vues par l\'administrateur seulement', async () => {
  const { payment } = await collectWithCharge('Ticket');
  const asManager = ok(await manager.get(`/api/payments/${payment.id}/ticket`));
  const t = asManager.ticket;
  assert.match(t.number, /^T-\d{6,}$/);
  assert.equal(t.member_phone, '+000 11 11 11 11');
  assert.equal(t.next_copy_no, 1);
  assert.equal(t.ticket_code, payment.ticket_code);
  assert.equal(t.status, 'valide');
  assert.equal(t.refunded_amount, 0);
  assert.deepEqual(t.refunds, []);
  assert.equal(t.header, 'Ligne 1\nLigne 2'); // the texts the settings test saved above
  assert.equal(t.footer, 'A bientôt');
  assert.equal(t.demo, ok(await manager.get('/api/me')).demo); // follows the space, as the bundle does
  assert.equal(typeof t.club_name, 'string');
  assert.equal('events' in asManager, false);
  const asAdmin = ok(await admin.get(`/api/payments/${payment.id}/ticket`));
  assert.deepEqual(asAdmin.events, []);
  assert.equal((await new Client(server).get(`/api/payments/${payment.id}/ticket`)).status, 401);
  assert.equal((await manager.get('/api/payments/999999/ticket')).status, 404);
});

let numbered; // the payment whose copies the next tests look at

test('sorties numérotées : 1, 2 (WhatsApp avec téléphone), 3 ; la prochaine est la 4', async () => {
  numbered = await collectWithCharge('Sorties');
  const id = numbered.payment.id;
  const first = ok(await manager.post(`/api/payments/${id}/ticket-events`, { kind: 'impression' }));
  assert.equal(first.copy_no, 1);
  assert.equal(first.printed_by_name, 'Gérant');
  assert.ok(first.at);
  const second = ok(await manager.post(`/api/payments/${id}/ticket-events`, { kind: 'whatsapp' }));
  assert.equal(second.copy_no, 2);
  const third = ok(await admin.post(`/api/payments/${id}/ticket-events`, { kind: 'impression' }));
  assert.equal(third.copy_no, 3);
  assert.equal(ok(await manager.get(`/api/payments/${id}/ticket`)).ticket.next_copy_no, 4);

  const events = ok(await admin.get(`/api/payments/${id}/ticket`)).events;
  assert.deepEqual(events.map((e) => [e.copy_no, e.kind]), [[1, 'impression'], [2, 'whatsapp'], [3, 'impression']]);
  assert.equal(events[1].phone, '+000 11 11 11 11');
  assert.equal(events[0].phone, null);
  assert.equal(events[0].user_name, 'Gérant');
  const audit = ok(await admin.get('/api/audit')).filter((a) => a.entity === 'payment' && a.entity_id === id);
  assert.deepEqual(audit.map((a) => a.action).sort(), ['ticket.imprimer', 'ticket.imprimer', 'ticket.whatsapp']);
  assert.deepEqual(audit.find((a) => a.action === 'ticket.whatsapp').details, { copy_no: 2 });
});

test('sorties : sorte inconnue 400, paiement inconnu 404, sans session 401', async () => {
  const id = numbered.payment.id;
  assert.equal((await manager.post(`/api/payments/${id}/ticket-events`, { kind: 'sms' })).status, 400);
  assert.equal((await manager.post(`/api/payments/${id}/ticket-events`, {})).status, 400);
  assert.equal((await manager.post('/api/payments/999999/ticket-events', { kind: 'impression' })).status, 404);
  assert.equal((await new Client(server).post(`/api/payments/${id}/ticket-events`, { kind: 'impression' })).status, 401);
  assert.equal(ok(await manager.get(`/api/payments/${id}/ticket`)).ticket.next_copy_no, 4);
});

test('vérification publique : sans session, aucune donnée personnelle', async () => {
  const visitor = new Client(server);
  const { payment } = numbered;
  const r = await visitor.call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, from('10.0.0.1'));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = r.data.ticket;
  for (const key of PUBLIC_LEAKS) assert.equal(key in t, false, key);
  assert.deepEqual(Object.keys(t).sort(), ['club_name', 'currency', 'initials', 'lines', 'method', 'number', 'paid_at', 'refunded_amount', 'status', 'timezone', 'total']);
  assert.deepEqual(t.currency, { label: 'FCFA', decimals: 0 });
  assert.equal(t.timezone, 'Africa/Brazzaville');
  assert.equal(t.initials, 'P. S.');
  assert.equal(t.status, 'valide');
  assert.equal(t.refunded_amount, 0);
  assert.equal(t.total, payment.amount);
  assert.equal(t.method, 'Espèces');
  assert.equal(t.paid_at, payment.paid_at);
  assert.deepEqual(Object.keys(t.lines[0]).sort(), ['amount', 'label', 'quantity']);
  assert.equal(t.lines[0].amount, payment.amount);
  assert.doesNotMatch(JSON.stringify(r.data), /\+000|Sorties/);
  // Lower case with dashes is the same ticket.
  const typed = formatTicketCode(payment.ticket_code).toLowerCase();
  assert.equal((await visitor.call('GET', `/api/tickets/${payment.id}/${typed}`, undefined, from('10.0.0.1'))).status, 200);
});

test('faux ticket : mauvais code et identifiant inconnu donnent la même réponse', async () => {
  const visitor = new Client(server);
  const { payment } = numbered;
  const wrongCode = await visitor.call('GET', `/api/tickets/${payment.id}/AAAA-AAAA-AAAA`, undefined, from('10.0.0.2'));
  const unknownId = await visitor.call('GET', `/api/tickets/999999/${payment.ticket_code}`, undefined, from('10.0.0.2'));
  const junkId = await visitor.call('GET', `/api/tickets/abc/${payment.ticket_code}`, undefined, from('10.0.0.2'));
  assert.equal(wrongCode.status, 404);
  assert.equal(wrongCode.data.error.code, 'TICKET_INTROUVABLE');
  assert.equal(wrongCode.data.error.message, 'Ticket introuvable.');
  assert.equal(unknownId.status, 404);
  assert.deepEqual(unknownId.data, wrongCode.data);
  assert.deepEqual(junkId.data, wrongCode.data);
});

test('paiement sans code : un code vide ou court ne l\u2019ouvre jamais, même réponse que les autres échecs', async () => {
  const visitor = new Client(server);
  const noCode = await collectWithCharge('SansCode'); // a payment of its own: the other tests keep their code
  const id = noCode.payment.id;
  const reference = await visitor.call('GET', `/api/tickets/${id}/AAAA-AAAA-AAAA`, undefined, from('10.0.1.1'));
  assert.equal(reference.status, 404);
  server.db.run('UPDATE payments SET ticket_code = NULL WHERE id = ?', id);
  try {
    for (const [ip, code] of [['10.0.1.2', '----'], ['10.0.1.4', 'AAAA-AAAA-AAAA'], ['10.0.1.5', 'AAAA-AAAA']]) {
      const r = await visitor.call('GET', `/api/tickets/${id}/${code}`, undefined, from(ip));
      assert.equal(r.status, 404, `code « ${code} »`);
      assert.deepEqual(r.data, reference.data);
    }
    // No code at all does not even reach the route (generic 404).
    assert.equal((await visitor.call('GET', `/api/tickets/${id}/`, undefined, from('10.0.1.3'))).status, 404);
    // The failure still counts for the throttle: the 6th empty attempt from one address is locked out.
    for (let i = 0; i < 5; i += 1) assert.equal((await visitor.call('GET', `/api/tickets/${id}/----`, undefined, from('10.0.1.6'))).status, 404);
    assert.equal((await visitor.call('GET', `/api/tickets/${id}/----`, undefined, from('10.0.1.6'))).status, 429);
  } finally {
    server.db.run('UPDATE payments SET ticket_code = ? WHERE id = ?', 'ZZZZZZZZZZZZ', id);
  }
});

test('limitation : 5 mauvais codes, la 6e demande répond 429 même avec le bon code', async () => {
  const visitor = new Client(server);
  const { payment } = numbered;
  const ip = from('10.0.0.3');
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await visitor.call('GET', `/api/tickets/${payment.id}/BBBB-BBBB-BBBB`, undefined, ip)).status, 404);
  }
  assert.equal((await visitor.call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, ip)).status, 429);
  // Another address is not affected.
  assert.equal((await visitor.call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, from('10.0.0.4'))).status, 200);
});

test('un succès ne remet pas le compteur à zéro', async () => {
  const visitor = new Client(server);
  const { payment } = numbered;
  const ip = from('10.0.0.5');
  for (let i = 0; i < 4; i += 1) await visitor.call('GET', `/api/tickets/${payment.id}/CCCC-CCCC-CCCC`, undefined, ip);
  assert.equal((await visitor.call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, ip)).status, 200);
  assert.equal((await visitor.call('GET', `/api/tickets/${payment.id}/CCCC-CCCC-CCCC`, undefined, ip)).status, 404); // 5th failure
  assert.equal((await visitor.call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, ip)).status, 429);
});

test('remboursement visible : statut rembourse et montant remboursé', async () => {
  const { payment, chargeId } = await collectWithCharge('Rembourse');
  ok(await admin.post(`/api/charges/${chargeId}/refund`, { reason: 'Erreur de saisie', method: 'Espèces' }));
  const visitor = new Client(server);
  const t = ok(await visitor.call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, from('10.0.0.6'))).ticket;
  assert.equal(t.status, 'rembourse');
  assert.equal(t.refunded_amount, payment.amount);
  const staff = ok(await manager.get(`/api/payments/${payment.id}/ticket`)).ticket;
  assert.equal(staff.status, 'rembourse');
  assert.equal(staff.refunded_amount, payment.amount);
  assert.equal(staff.refunds.length, 1);
  assert.equal(staff.refunds[0].amount, payment.amount);
  assert.ok(staff.refunds[0].created_at);
});

test('remboursement partiel : statut partiellement_rembourse', async () => {
  const member = ok(await manager.post('/api/members', { first_name: 'Paul', last_name: 'Partiel', phone: '+000 22 22 22 22' }));
  const first = ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id }));
  // A second line for the same member, collected together with the first.
  const secondId = server.club.tx(() => server.club.insertCharge({ id: null }, {
    account: 'cigares', kind: 'produit', member_id: member.id, label: 'Cigare test', quantity: 1, unit_price: 5 * UM,
  }));
  const payment = ok(await manager.post('/api/payments', { charge_ids: [first.charge_id, secondId], method: 'Espèces' })).payment;
  ok(await admin.post(`/api/charges/${first.charge_id}/refund`, { reason: 'Une ligne en trop', method: 'Espèces' }));
  const t = ok(await new Client(server).call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, from('10.0.0.7'))).ticket;
  assert.equal(t.status, 'partiellement_rembourse');
  assert.equal(t.lines.length, 2);
  assert.ok(t.refunded_amount > 0 && t.refunded_amount < payment.amount);
});

test('historique admin : filtres, exemplaires, réservé à l\'administrateur', async () => {
  const id = numbered.payment.id;
  const all = ok(await admin.get('/api/ticket-events')).events;
  const mine = all.filter((e) => e.payment_id === id);
  assert.equal(mine.length, 3);
  assert.ok(mine.every((e) => e.copies_total === 3));
  const e = mine[0];
  assert.match(e.number, /^T-\d{6,}$/);
  assert.equal(e.member_name, 'Paul SORTIES');
  assert.equal(e.amount, numbered.payment.amount);
  assert.ok(e.user_name && e.user_id && e.at);
  assert.deepEqual(Object.keys(e).sort(), ['amount', 'at', 'copies_total', 'copy_no', 'kind', 'member_name', 'number', 'payment_id', 'user_id', 'user_name']);

  const adminId = ok(await admin.get('/api/me')).user.id;
  const byAdmin = ok(await admin.get(`/api/ticket-events?user_id=${adminId}`)).events;
  assert.ok(byAdmin.length >= 1 && byAdmin.every((x) => x.user_id === adminId));
  assert.ok(byAdmin.some((x) => x.payment_id === id && x.copy_no === 3));
  assert.equal(byAdmin.some((x) => x.copy_no === 1 && x.payment_id === id), false);

  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const inPeriod = ok(await admin.get(`/api/ticket-events?from=${day(-1)}&to=${day(1)}`)).events;
  assert.equal(inPeriod.filter((x) => x.payment_id === id).length, 3);
  const before = ok(await admin.get('/api/ticket-events?from=2020-01-01&to=2020-01-31')).events;
  assert.deepEqual(before, []);
  assert.equal((await admin.get('/api/ticket-events?from=pas-une-date')).status, 400);

  assert.equal((await manager.get('/api/ticket-events')).status, 403);
});

test('espace démo : la vérification publique répond du vrai club, même avec l\'en-tête démo', async () => {
  const demoServer = new Server({ SETUP_TOKEN }, { demo: true });
  await demoServer.start();
  try {
    const site = new Site(server, demoServer);
    const { payment } = numbered;
    const visitor = new Client(site);
    const r = await visitor.call('GET', `/api/tickets/${payment.id}/${payment.ticket_code}`, undefined, { ...from('10.0.0.8'), 'x-club-espace': 'demo' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ticket.number, ok(await manager.get(`/api/payments/${payment.id}/ticket`)).ticket.number);
  } finally {
    demoServer.destroy();
  }
});
