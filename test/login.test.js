// Sign-in lockout: five failures lock the address + identifier for one minute, whatever the way the
// identifier is written (spaces around it, letter case) and however long the submitted value is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client } from './harness.js';

const server = new Server();
before(async () => {
  await server.start();
  await server.addUser('proprietaire', 'Propriétaire', 'admin', 'mot-de-passe-proprio');
});
after(() => server.destroy());

// Each test signs in from its own address, so their failure counts stay apart.
const attempt = (client, login, password, ip) => client.post('/api/login', { login, password }, { 'cf-connecting-ip': ip });

test('connexion : des espaces autour de l’identifiant ne redonnent pas cinq essais', async () => {
  const visitor = new Client(server);
  for (let i = 0; i < 5; i += 1) assert.equal((await attempt(visitor, 'proprietaire', 'faux', '10.0.0.1')).status, 401);
  for (const login of [' proprietaire', 'proprietaire ', '\tPROPRIETAIRE', ' proprietaire']) {
    assert.equal((await attempt(visitor, login, 'faux', '10.0.0.1')).status, 429, JSON.stringify(login));
  }
  // Even the right password waits for the minute, however the identifier is written.
  assert.equal((await attempt(visitor, 'proprietaire ', 'mot-de-passe-proprio', '10.0.0.1')).status, 429);
});

test('connexion : un identifiant très long ne garde qu’une clé de taille bornée', async () => {
  const visitor = new Client(server);
  const long = 'x'.repeat(41); // one character past the longest identifier (40)
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await attempt(visitor, `${long}${'a'.repeat(1000)}${i}`, 'faux', '10.0.0.2')).status, 401);
  }
  // Past that length the key stops growing: these values all count as one identifier.
  assert.equal((await attempt(visitor, `${long}b`, 'faux', '10.0.0.2')).status, 429);
});
