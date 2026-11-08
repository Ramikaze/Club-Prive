// The verification of the daily till (« Vérification de la caisse journalière »): a day closing carries who verified
// it and when, and the club notes the first business day of the feature. Days closed before that day stay as they were.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client } from './harness.js';

const server = new Server({}, { lenientTariffs: true, dayVerification: true });
let admin;
let cig;
let ger;
let today;

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
});
after(() => server.destroy());

test('V23 : la fermeture porte la vérification, et le jour de mise en service est noté', () => {
  const cols = server.club.all('PRAGMA table_info(day_closings)').map((c) => c.name);
  assert.ok(cols.includes('verified_at') && cols.includes('verified_by'));
  assert.equal(server.club.get("SELECT value FROM meta WHERE key = 'day_verification_since'").value, today);
});
