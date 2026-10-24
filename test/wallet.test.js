// Member card, CFA credit: recharges at the till, the administrator's cancellation, the balance that never goes
// below zero and follows the member, the treasury (cash in at the recharge, never revenue), the members' credit
// frozen in the monthly closing, the V15 migration and the data reset.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, localToUtcMs } from '../shared/time.js';
import { CARD_METHOD } from '../shared/rules.js';
import { nodeDb } from '../worker/db-node.js';
import { MIGRATIONS } from '../worker/schema.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let manager;
let today;
let gerant; // the manager's user row, the actor of direct calls to the business layer

const newMember = async (first_name) => ok(await manager.post('/api/members', { first_name, last_name: 'Carte', phone: '+000 00 00 00 00' }));
const recharge = (memberId, body) => manager.post(`/api/members/${memberId}/wallet/recharge`, body);
const balance = (memberId) => server.club.walletBalance(memberId);
const treasury = async () => ok(await admin.get(`/api/treasury?from=${today}&to=${today}`));
const cash = (t) => t.accounts.find((a) => a.method === 'Espèces') ?? { in: 0, out: 0 };
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'wallet-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'wallet-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'wallet-admin-password');
  today = (await manager.login('gerant', 'wallet-manager-password')).biz_today;
  gerant = server.club.userByLogin('gerant');
});
after(() => server.destroy());

let alice; // recharged 100 000 FCFA in the first test

test('recharge : le gérant crédite la carte, un encaissement « recharge » sans ligne, avec ticket et journal', async () => {
  alice = await newMember('Alice');
  assert.deepEqual(ok(await manager.get(`/api/members/${alice.id}`)).wallet, { balance: 0, last_recharge: null, movements: [] });
  const r = ok(await recharge(alice.id, { amount: 100000 * UM, method: 'Espèces', reference: 'Reçu 12' }));
  assert.equal(r.wallet.balance, 100000 * UM);
  assert.equal(r.payment.kind, 'recharge');
  assert.equal(r.payment.amount, 100000 * UM);
  assert.equal(r.payment.card_amount, 0);
  assert.equal(r.payment.method, 'Espèces');
  assert.equal(r.payment.cancelled_at, null);
  assert.match(r.payment.ticket_code, /^[A-Z0-9]+$/);
  assert.deepEqual(r.payment.allocations, []);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM payment_allocations WHERE payment_id = ?', r.payment.id).n, 0);
  assert.equal(r.wallet.last_recharge.amount, 100000 * UM);
  assert.equal(r.wallet.movements.length, 1);
  const [move] = r.wallet.movements;
  assert.equal(move.kind, 'recharge');
  assert.equal(move.amount, 100000 * UM);
  assert.equal(move.balance_after, 100000 * UM);
  assert.equal(move.by_name, 'Gérant');
  assert.equal(move.payment_id, r.payment.id);

  const detail = ok(await manager.get(`/api/members/${alice.id}`));
  assert.equal(detail.wallet.balance, 100000 * UM);
  assert.equal(detail.payments.find((p) => p.id === r.payment.id).kind, 'recharge');
  const entry = ok(await admin.get('/api/audit')).find((a) => a.action === 'carte.recharger');
  assert.equal(entry.entity_id, alice.id);
  assert.equal(entry.details.montant, 100000 * UM);

  for (const amount of [0, -5000 * UM, 1.5, 'abc', null]) {
    refused(await recharge(alice.id, { amount, method: 'Espèces' }), 400);
  }
  refused(await recharge(alice.id, { amount: 1000 * UM, method: CARD_METHOD }), 400);
  refused(await recharge(alice.id, { amount: 1000 * UM, method: 'Coffre inconnu' }), 400);
  refused(await recharge(alice.id, { amount: 1000 * UM }), 400);
  const gone = await newMember('Bertrand');
  ok(await manager.post(`/api/members/${gone.id}/deactivate`, { reason: 'Parti du club' }));
  refused(await recharge(gone.id, { amount: 1000 * UM, method: 'Espèces' }), 409, 'MEMBRE_DESACTIVE');
  assert.equal(balance(alice.id), 100000 * UM);
});

test('trésorerie : la recharge entre en caisse le jour même, sans être une recette', async () => {
  const member = await newMember('Chloé');
  const before = await treasury();
  const sales = ok(await admin.get(`/api/finance/summary?from=${today}`));
  ok(await recharge(member.id, { amount: 20000 * UM, method: 'Espèces' }));
  const afterwards = await treasury();
  assert.equal(cash(afterwards).in, cash(before).in + 20000 * UM);
  assert.equal(afterwards.total.closing, before.total.closing + 20000 * UM);
  const salesAfter = ok(await admin.get(`/api/finance/summary?from=${today}`));
  assert.equal(salesAfter.total.collected, sales.total.collected);
  assert.equal(afterwards.result.revenue, before.result.revenue);
  // The general ledger agrees with the treasury.
  const book = ok(await admin.get(`/api/ledger/book?from=${today}&to=${today}`));
  assert.equal(book.closing, afterwards.total.closing);
});

test('annulation : réservée à un administrateur, avec motif, sortie de caisse le jour de l’annulation', async () => {
  const member = await newMember('Damien');
  const { payment } = ok(await recharge(member.id, { amount: 30000 * UM, method: 'Espèces' }));
  const before = await treasury();
  refused(await manager.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Erreur de saisie' }), 403);
  refused(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, {}), 400);
  const r = ok(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Erreur de saisie' }));
  assert.equal(r.wallet.balance, 0);
  assert.equal(r.wallet.movements[0].kind, 'annulation_recharge');
  assert.equal(r.wallet.movements[0].amount, -30000 * UM);
  assert.equal(r.wallet.movements[0].balance_after, 0);
  assert.equal(r.wallet.movements[0].reason, 'Erreur de saisie');
  assert.equal(r.wallet.last_recharge, null); // a cancelled recharge is not the last one
  const afterwards = await treasury();
  assert.equal(cash(afterwards).out, cash(before).out + 30000 * UM);
  assert.equal(cash(afterwards).in, cash(before).in);
  const book = ok(await admin.get(`/api/ledger/book?from=${today}&to=${today}`));
  assert.equal(book.closing, afterwards.total.closing);
  const p = ok(await manager.get(`/api/members/${member.id}`)).payments.find((x) => x.id === payment.id);
  assert.ok(p.cancelled_at);
  assert.equal(p.cancel_reason, 'Erreur de saisie');
  refused(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Encore' }), 409, 'DEJA_ANNULEE');
  assert.ok(ok(await admin.get('/api/audit')).some((a) => a.action === 'carte.annuler_recharge'));
});

test('jamais négatif : un débit au-delà du solde est refusé, une recharge dépensée ne s’annule pas', async () => {
  const member = await newMember('Émile');
  const { payment } = ok(await recharge(member.id, { amount: 10000 * UM, method: 'Espèces' }));
  server.club.tx(() => server.club.walletMove(gerant, member.id, 'paiement', -6000 * UM, { reason: 'Cigare' }));
  assert.throws(
    () => server.club.tx(() => server.club.walletMove(gerant, member.id, 'paiement', -6000 * UM, { reason: 'Cigare' })),
    (err) => err.code === 'SOLDE_INSUFFISANT',
  );
  assert.equal(balance(member.id), 4000 * UM);
  refused(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Erreur de saisie' }), 409, 'SOLDE_INSUFFISANT');
  assert.equal(balance(member.id), 4000 * UM);
  assert.equal(server.club.get('SELECT cancelled_at FROM payments WHERE id = ?', payment.id).cancelled_at, null);
});

test('le solde suit le membre : une carte remplacée garde le crédit', async () => {
  const before = ok(await manager.get(`/api/members/${alice.id}`)).wallet;
  const first = ok(await manager.post(`/api/members/${alice.id}/cards`, { kind: 'physique' }));
  ok(await manager.post(`/api/cards/${first.card_id}/deactivate`, { reason: 'Carte perdue' }));
  ok(await manager.post(`/api/members/${alice.id}/cards`, { kind: 'physique' }));
  const afterwards = ok(await manager.get(`/api/members/${alice.id}`)).wallet;
  assert.deepEqual(afterwards, before);
  assert.equal(afterwards.balance, 100000 * UM);
});

test('mois clôturé : une recharge tombant dans un mois clôturé est refusée', async () => {
  server.club.run("INSERT INTO closed_periods (month, closed_at, summary) VALUES (?, ?, '{}')", today.slice(0, 7), new Date().toISOString());
  try {
    refused(await recharge(alice.id, { amount: 1000 * UM, method: 'Espèces' }), 409, 'PERIODE_CLOTUREE');
  } finally {
    server.club.run('DELETE FROM closed_periods WHERE month = ?', today.slice(0, 7));
  }
  assert.equal(balance(alice.id), 100000 * UM);
});

test('réglage : « Carte membre » ne peut pas être un moyen de paiement configuré', async () => {
  refused(await admin.put('/api/settings', { payment_methods: ['Espèces', CARD_METHOD] }), 400);
  refused(await admin.put('/api/settings', { payment_methods: ['Espèces', 'carte MEMBRE'] }), 400);
});

test('crédits des membres : le total dû en consommations, en trésorerie et figé à la clôture', async () => {
  const liabilityBefore = (await treasury()).wallet_liability;
  assert.equal(liabilityBefore, server.club.walletLiability());
  // The two members are recharged in the middle of last month, so that its closing has something to freeze.
  const lastMonth = addMonths(`${today.slice(0, 8)}01`, -1);
  const mid = addDays(lastMonth, 14);
  const first = await newMember('Fanny');
  const second = await newMember('Gilles');
  server.club.at = localToUtcMs(mid, '12:00', server.club.settings().timezone);
  try {
    ok(await recharge(first.id, { amount: 100000 * UM, method: 'Espèces' }));
    ok(await recharge(second.id, { amount: 30000 * UM, method: 'MTN MoMo' }));
    server.club.tx(() => server.club.walletMove(gerant, first.id, 'paiement', -20000 * UM, { reason: 'Consommations' }));
  } finally {
    server.club.at = null;
  }
  assert.equal((await treasury()).wallet_liability, liabilityBefore + 110000 * UM);
  const closings = ok(await admin.post('/api/closings', { month: lastMonth.slice(0, 7) }));
  const closed = closings.closed.find((c) => c.month === lastMonth.slice(0, 7));
  assert.equal(closed.summary.wallet_liability, 110000 * UM);
  // A later recharge does not change the frozen figure.
  ok(await recharge(first.id, { amount: 5000 * UM, method: 'Espèces' }));
  const again = ok(await admin.get('/api/closings')).closed.find((c) => c.month === lastMonth.slice(0, 7));
  assert.equal(again.summary.wallet_liability, 110000 * UM);
  assert.equal((await treasury()).wallet_liability, liabilityBefore + 115000 * UM);
});

// A database at version 14 holding the harness's own records: built with the first 14 migrations, then filled
// with every row of a database made through the API (the V14 columns of each table).
function v14Copy(sourceFile, file) {
  const db = nodeDb(file);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(0, 14)) for (const statement of statements) db.exec(statement);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '14')");
  });
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`ATTACH DATABASE '${sourceFile.replaceAll("'", "''")}' AS src`);
  const tables = db.all("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'meta'");
  db.transaction(() => {
    for (const { name } of tables) {
      const columns = db.all(`PRAGMA main.table_info(${name})`).map((c) => `"${c.name}"`).join(', ');
      db.exec(`INSERT INTO main."${name}" (${columns}) SELECT ${columns} FROM src."${name}"`);
    }
  });
  db.exec('DETACH DATABASE src');
  db.close();
}

test('migration sans perte : V15 garde réservations, crédits et lignes, et rend l’abonnement facultatif', async () => {
  const source = new Server({}, { lenientTariffs: true });
  const old = new Server({});
  try {
    await source.start();
    await source.addUser('gerant', 'Gérant', 'gerant', 'wallet-manager-password');
    const g = new Client(source);
    const bundle = await g.login('gerant', 'wallet-manager-password');
    const day = addDays(bundle.biz_today, 1);
    const member = ok(await g.post('/api/members', { first_name: 'Hugo', last_name: 'Migration', phone: '+000 00 00 00 00' }));
    const plan = bundle.plans.find((p) => p.code === 'MENSUELLE');
    const sub = ok(await g.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id, start_date: bundle.biz_today }));
    ok(await g.post('/api/payments', { charge_ids: [sub.charge_id], method: 'Espèces' }));
    const room = bundle.rooms[0];
    // 3 hours: 2 hours of credit engaged, 1 paid hour with its deposit taken now.
    ok(await g.post('/api/reservations', {
      member_id: member.id, room_id: room.id, date: day, start_time: '15:00', duration_min: 180, party_size: 3, deposit_method: 'Espèces',
    }));
    const snapshot = (db, table) => db.all(`SELECT * FROM ${table} ORDER BY id`);
    const tables = ['reservations', 'credit_movements', 'charges', 'payments', 'payment_allocations'];
    const expected = Object.fromEntries(tables.map((t) => [t, snapshot(source.db, t)]));
    assert.equal(expected.reservations.length, 1);
    assert.ok(expected.reservations[0].deposit_amount > 0);
    assert.equal(expected.reservations[0].party_size, 3);
    assert.ok(expected.credit_movements.some((m) => m.kind === 'engagement'));
    assert.ok(expected.charges.length >= 3);

    v14Copy(source.file, old.file);
    const v14 = nodeDb(old.file);
    assert.equal(v14.all('PRAGMA table_info(reservations)').find((c) => c.name === 'subscription_id').notnull, 1);
    v14.close();

    await old.start(); // migrates to the last version
    assert.equal(old.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.equal(old.db.all('PRAGMA table_info(reservations)').find((c) => c.name === 'subscription_id').notnull, 0);
    for (const t of ['reservations', 'credit_movements', 'charges']) assert.deepEqual(snapshot(old.db, t), expected[t], t);
    for (const p of snapshot(old.db, 'payments')) {
      assert.equal(p.kind, 'encaissement');
      assert.equal(p.card_amount, 0);
    }
    assert.deepEqual(old.db.all('PRAGMA foreign_key_check'), []);
    const indexes = old.db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reservations'").map((i) => i.name);
    for (const i of ['reservations_time', 'reservations_day', 'reservations_member', 'reservations_room']) assert.ok(indexes.includes(i), i);
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'reservations_v1%'").n, 0);

    // A booking without a plan is now possible; the overlap triggers still guard the room.
    const r = expected.reservations[0];
    const insert = (startMs, endMs) => old.db.run(
      `INSERT INTO reservations (member_id, subscription_id, room_id, party_size, biz_day, start_ms, end_ms, duration_min, status,
         included_minutes, paid_minutes, supplement_amount, tariff_hour, tariff_half, tariff_validated, created_at)
       VALUES (?, NULL, ?, 1, ?, ?, ?, ?, 'reservee', 0, ?, 0, 0, 0, 1, ?)`,
      member.id, room.id, r.biz_day, startMs, endMs, (endMs - startMs) / 60000, (endMs - startMs) / 60000, new Date().toISOString(),
    );
    const later = insert(r.end_ms + 3600000, r.end_ms + 7200000).lastId;
    assert.equal(old.db.get('SELECT subscription_id FROM reservations WHERE id = ?', later).subscription_id, null);
    assert.throws(() => insert(r.start_ms + 1800000, r.start_ms + 5400000), /CHEVAUCHEMENT/);
    assert.throws(
      () => old.db.run('UPDATE reservations SET start_ms = ?, end_ms = ? WHERE id = ?', r.start_ms, r.end_ms, later),
      /CHEVAUCHEMENT/,
    );
  } finally {
    source.destroy();
    old.destroy();
  }
});

test('effacer toutes les données vide aussi les mouvements de carte', async () => {
  assert.ok(server.club.get('SELECT COUNT(*) AS n FROM wallet_movements').n > 0);
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM wallet_movements').n, 0);
  assert.equal(server.club.walletLiability(), 0);
});
