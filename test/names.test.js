import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFirstName, formatLastName } from '../shared/rules.js';
import { Server } from './harness.js';

test('le prénom commence par une majuscule, chaque partie aussi', () => {
  assert.equal(formatFirstName('junior'), 'Junior');
  assert.equal(formatFirstName('  JUNIOR  '), 'Junior');
  assert.equal(formatFirstName('jean-pierre'), 'Jean-Pierre');
  assert.equal(formatFirstName('marie   claire'), 'Marie Claire');
  assert.equal(formatFirstName('élodie'), 'Élodie');
});

test('le nom est tout en majuscules, accents compris', () => {
  assert.equal(formatLastName('oko'), 'OKO');
  assert.equal(formatLastName(" n'diaye  mbemba "), "N'DIAYE MBEMBA");
  assert.equal(formatLastName('gérard'), 'GÉRARD');
});

test('une fiche créée ou modifiée garde ce format', async () => {
  const s = new Server({ SETUP_TOKEN: 'x' });
  await s.start();
  try {
    const admin = { id: null, name: 'Test', role: 'admin' };
    const m = s.club.tx(() => s.club.createMember(admin, { first_name: 'junior', last_name: 'oko', phone: '000000000' }));
    assert.equal(m.first_name, 'Junior');
    assert.equal(m.last_name, 'OKO');
    const u = s.club.tx(() => s.club.updateMember(admin, m.id, { first_name: 'JEAN-paul', last_name: 'dupont' }));
    assert.equal(u.first_name, 'Jean-Paul');
    assert.equal(u.last_name, 'DUPONT');
  } finally {
    s.destroy();
  }
});

test('les fiches déjà enregistrées sont corrigées une fois au démarrage', async () => {
  const s = new Server({ SETUP_TOKEN: 'x' });
  await s.start();
  try {
    const admin = { id: null, name: 'Test', role: 'admin' };
    const m = s.club.tx(() => s.club.createMember(admin, { first_name: 'Ada', last_name: 'LOVELACE', phone: '000000000' }));
    s.db.run("UPDATE members SET first_name = 'ada', last_name = 'lovelace' WHERE id = ?", m.id);
    s.db.run("DELETE FROM meta WHERE key = 'names_formatted'");
    await s.restart();
    const row = s.db.get('SELECT first_name, last_name FROM members WHERE id = ?', m.id);
    assert.deepEqual({ ...row }, { first_name: 'Ada', last_name: 'LOVELACE' });
  } finally {
    s.destroy();
  }
});
