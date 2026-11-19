// The side menu, by sector (owner, 2026-11-19: « mieux organisée par secteur »): Accueil on top, then the clients,
// the sales, the purchases and stock, and the administration. Pure: tested by test/nav.test.js.
import { isBoss } from '../../../shared/roles.js';

export const NAV = [
  { path: '/', label: 'Accueil', short: 'Accueil', icon: 'home', tab: true },
  { group: 'Clients' },
  { path: '/salles', label: 'Salles', short: 'Salles', icon: 'rooms', tab: true },
  { path: '/agenda', label: 'Agenda', short: 'Agenda', icon: 'calendar', tab: true, also: ['/reservations'] },
  { path: '/membres', label: 'Membres / Clients', short: 'Membres', icon: 'users', tab: true, also: ['/clients', '/cartes'] },
  { group: 'Ventes' },
  { path: '/boutique', label: 'Boutique', short: 'Boutique', icon: 'shop', tab: true },
  // Orders and reservation requests from the client space; the counter is what waits (useOrderCounter).
  { path: '/commandes', label: 'Commandes', short: 'Commandes', icon: 'receipt', counter: true },
  { path: '/caisse', label: 'Caisse', short: 'Caisse', icon: 'wallet', tab: true },
  { group: 'Achats et stocks' },
  { path: '/produits', label: 'Stocks', short: 'Stocks', icon: 'box' },
  // Supplier accounts (owner, 2026-11-07: « Les fournisseurs s'afficheront ici. Ils auront leur icône. »): the
  // administrator and the associés only.
  { path: '/fournisseurs', label: 'Fournisseurs', short: 'Fournisseurs', icon: 'truck', boss: true },
  { group: 'Administration' },
  { path: '/parametres', label: 'Administration', short: 'Admin', icon: 'settings', admin: true, also: ['/tresorerie', '/grand-livre', '/cloture', '/journal'] },
];

// The entries this user may open, with their section headings; a heading left with no entry under it (the
// gérant has no Administration) is dropped.
export function visibleNav(user) {
  const allowed = NAV.filter((n) => (!n.admin || user?.role === 'admin') && (!n.boss || isBoss(user)));
  return allowed.filter((n, i) => !n.group || allowed[i + 1]?.path);
}
