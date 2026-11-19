// The side menu by sector (src/components/layout/nav.js): sections, rights by role, no empty heading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV, visibleNav } from '../src/components/layout/nav.js';

const ROLES = { admin: { role: 'admin' }, associe: { role: 'associe', rayon: 'cigares' }, gerant: { role: 'gerant' } };
const groups = (list) => list.filter((n) => n.group).map((n) => n.group);
const paths = (list) => list.filter((n) => n.path).map((n) => n.path);

test('ordre des sections, Accueil en tête sans titre', () => {
  assert.deepEqual(groups(NAV), ['Clients', 'Ventes', 'Achats et stocks', 'Administration']);
  assert.equal(NAV[0].path, '/');
});

test('administrateur : tout', () => {
  const list = visibleNav(ROLES.admin);
  assert.deepEqual(groups(list), ['Clients', 'Ventes', 'Achats et stocks', 'Administration']);
  assert.deepEqual(paths(list), ['/', '/salles', '/agenda', '/membres', '/boutique', '/commandes', '/caisse', '/produits', '/fournisseurs', '/parametres']);
});

test('associé : fournisseurs, pas d’administration', () => {
  const list = visibleNav(ROLES.associe);
  assert.ok(paths(list).includes('/fournisseurs'));
  assert.ok(!paths(list).includes('/parametres'));
  assert.ok(!groups(list).includes('Administration'));
});

test('gérant : ni fournisseurs ni administration, Stocks seul dans Achats et stocks', () => {
  const list = visibleNav(ROLES.gerant);
  assert.ok(!paths(list).includes('/fournisseurs'));
  assert.ok(!paths(list).includes('/parametres'));
  assert.ok(!groups(list).includes('Administration'));
  const i = list.findIndex((n) => n.group === 'Achats et stocks');
  assert.equal(list[i + 1].path, '/produits');
});

test('aucun titre de section vide, quel que soit le rôle', () => {
  for (const user of Object.values(ROLES)) {
    const list = visibleNav(user);
    list.forEach((n, i) => {
      if (n.group) assert.ok(list[i + 1]?.path, `titre « ${n.group} » vide pour ${user.role}`);
    });
  }
});

test('onglets du téléphone inchangés', () => {
  assert.deepEqual(NAV.filter((n) => n.tab).map((n) => n.path), ['/', '/salles', '/agenda', '/membres', '/boutique', '/caisse']);
});
