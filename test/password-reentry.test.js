// Password changes (security audit run-2): the current password, re-entered to change it, counts its failures like a
// sign-in, and a weak new password is refused before the current one is checked; the password routes keep no
// idempotency record; a password change or reset drops the devices that receive the account's notifications.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Server, Client, ok } from './harness.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};

async function setup() {
  const server = new Server({});
  servers.push(server);
  await server.start();
  await server.addUser('proprietaire', 'Propriétaire', 'admin', 'mot-de-passe-proprio');
  await server.addUser('gerant', 'Gérant', 'gerant', 'mot-de-passe-gerant');
  const admin = new Client(server);
  await admin.login('proprietaire', 'mot-de-passe-proprio');
  const manager = new Client(server);
  await manager.login('gerant', 'mot-de-passe-gerant');
  const managerId = server.club.get("SELECT id FROM users WHERE login = 'gerant'").id;
  return { server, admin, manager, managerId };
}

// The keys a browser gives when it subscribes to notifications (a P-256 point and a 16-byte secret).
async function deviceKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  return { p256dh: raw.toString('base64url'), auth: Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('base64url') };
}

test('personnel : le mot de passe actuel se bloque après 5 erreurs, comme la connexion', async () => {
  const { manager } = await setup();
  for (let i = 0; i < 5; i += 1) {
    refused(await manager.post('/api/me/password', { current_password: `faux-mot-de-passe-${i}`, new_password: 'nouveau-mot-de-passe' }), 400);
  }
  refused(await manager.post('/api/me/password', { current_password: 'mot-de-passe-gerant', new_password: 'nouveau-mot-de-passe' }), 429, 'TROP_DE_TENTATIVES');
});

test('personnel : un nouveau mot de passe trop court ne dit rien de l’actuel', async () => {
  const { manager } = await setup();
  const wrong = await manager.post('/api/me/password', { current_password: 'faux-mot-de-passe', new_password: 'court' });
  const right = await manager.post('/api/me/password', { current_password: 'mot-de-passe-gerant', new_password: 'court' });
  refused(wrong, 400);
  refused(right, 400);
  assert.equal(wrong.data.error.message, right.data.error.message);
  ok(await manager.post('/api/me/password', { current_password: 'mot-de-passe-gerant', new_password: 'nouveau-mot-de-passe' }));
});

test('client : le mot de passe actuel se bloque après 5 erreurs', async () => {
  const { server, admin } = await setup();
  const m = ok(await admin.post('/api/members', { first_name: 'jean', last_name: 'client', phone: '06 123 45 67' }));
  const { code } = ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  const client = new Client(server);
  ok(await client.post('/api/client/login', { login: m.member_no, password: code }));
  ok(await client.post('/api/client/password', { login: 'jean.client', new_password: 'mot-de-passe-client-1' }));
  for (let i = 0; i < 5; i += 1) {
    refused(await client.post('/api/client/password', { current_password: `faux-${i}-mot-de-passe`, new_password: 'mot-de-passe-client-2' }), 400);
  }
  refused(await client.post('/api/client/password', { current_password: 'mot-de-passe-client-1', new_password: 'mot-de-passe-client-2' }), 429, 'TROP_DE_TENTATIVES');
});

test('les mots de passe du personnel ne laissent aucune clé d’idempotence', async () => {
  const { server, admin, manager, managerId } = await setup();
  const key = (n) => ({ 'idempotency-key': `cle-mot-de-passe-${n}` });
  ok(await admin.call('POST', '/api/users', { login: 'nouveau', name: 'Nouveau', role: 'gerant', password: 'mot-de-passe-nouveau' }, key(1)));
  ok(await admin.call('POST', `/api/users/${managerId}/password`, { password: 'mot-de-passe-reinit' }, key(2)));
  await manager.login('gerant', 'mot-de-passe-reinit');
  ok(await manager.call('POST', '/api/me/password', { current_password: 'mot-de-passe-reinit', new_password: 'mot-de-passe-choisi' }, key(3)));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM idempotency_keys').n, 0);
});

test('changer ou réinitialiser le mot de passe coupe les notifications du compte', async () => {
  const { server, admin, manager, managerId } = await setup();
  const devices = () => server.club.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', managerId).n;
  ok(await manager.post('/api/push/subscriptions', { endpoint: 'https://push.test/appareil-1', keys: await deviceKeys() }));
  assert.equal(devices(), 1);
  ok(await manager.post('/api/me/password', { current_password: 'mot-de-passe-gerant', new_password: 'mot-de-passe-choisi' }));
  assert.equal(devices(), 0);
  ok(await manager.post('/api/push/subscriptions', { endpoint: 'https://push.test/appareil-2', keys: await deviceKeys() }));
  ok(await admin.post(`/api/users/${managerId}/password`, { password: 'mot-de-passe-reinit' }));
  assert.equal(devices(), 0);
});
