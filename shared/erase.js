// What the administrator may erase (Paramètres › « Effacer des données », owner's request 2026-11-10): the club's
// data in groups he ticks. Accounts, settings, plans and categories always stay. A group lists its own tables;
// `needs` are the groups whose rows point to them, erased with it (the screen says so before the confirmation).
// The stock quantities are never recomputed: after erasing test sales, the stock is adjusted by hand.
// Shared by the server (worker/club.js eraseData) and the screen (src/pages/Settings.jsx).
export const ERASE_GROUPS = [
  {
    key: 'encaissements', label: 'Encaissements, tickets et ventes',
    help: 'Encaissements, tickets, notes (lignes), ventes Boutique, approvisionnements et soldes des cartes.',
    tables: ['payment_allocations', 'refunds', 'ticket_events', 'client_ticket_copies', 'wallet_movements', 'client_order_sales', 'charges', 'payments', 'shop_sales'],
  },
  {
    key: 'seances', label: 'Séances et réservations', needs: ['encaissements'],
    help: 'Séances, réservations, demandes de réservation, heures consommées.',
    tables: ['reservation_attendees', 'credit_movements', 'reservation_requests', 'reservations'],
  },
  {
    key: 'caisse', label: 'Dépenses et caisse',
    help: 'Dépenses, entrées diverses, transferts, fermetures et vérifications de caisse, clôtures de mois.',
    tables: ['ledger_entries', 'day_closings', 'closed_periods'],
  },
  { key: 'offerts', label: 'Cadeaux (offerts)', help: 'Les produits offerts par les associés.', tables: ['gifts'] },
  {
    key: 'commandes', label: 'Commandes des clients', help: 'Les commandes passées depuis l’espace client.',
    tables: ['client_order_sales', 'client_order_lines', 'client_orders'],
  },
  {
    key: 'stock', label: 'Historique du stock', help: 'Les mouvements de stock ; les quantités actuelles restent.',
    tables: ['stock_movements'],
  },
  { key: 'fournisseurs', label: 'Fournisseurs', help: 'Les fournisseurs et leurs achats à crédit.', tables: ['supplier_purchases', 'suppliers'] },
  {
    key: 'produits', label: 'Produits', needs: ['encaissements', 'offerts', 'commandes', 'stock'],
    help: 'Le catalogue, ses photos et ses prix.', tables: ['product_photos', 'products'],
  },
  {
    key: 'membres', label: 'Membres et clients', needs: ['encaissements', 'seances', 'commandes'],
    help: 'Fiches, cartes, abonnements, accès à l’espace client.',
    tables: ['client_idempotency', 'client_sessions', 'client_accounts', 'cards', 'subscriptions', 'members'],
  },
  { key: 'journal', label: 'Journal des opérations', help: 'L’historique des actions ; l’effacement y est noté ensuite.', tables: ['audit_log'] },
];

export const ERASE_LABEL = Object.fromEntries(ERASE_GROUPS.map((g) => [g.key, g.label]));

// The groups ticked and every group they need, in the list's order.
export function eraseClosure(keys) {
  const chosen = new Set();
  const add = (key) => {
    const group = ERASE_GROUPS.find((g) => g.key === key);
    if (!group || chosen.has(key)) return;
    chosen.add(key);
    for (const need of group.needs ?? []) add(need);
  };
  for (const key of keys ?? []) add(key);
  return ERASE_GROUPS.filter((g) => chosen.has(g.key)).map((g) => g.key);
}

// A link from a table that stays to rows a group erases: it is emptied instead (a stock movement keeps its line in
// the history once the sale is gone). [table, column, the group its rows belong to, the group of the table itself].
export const ERASE_UNLINKS = [
  ['stock_movements', 'charge_id', 'encaissements', 'stock'],
  ['stock_movements', 'gift_id', 'offerts', 'stock'],
  ['gifts', 'member_id', 'membres', 'offerts'],
  ['ledger_entries', 'supplier_id', 'fournisseurs', 'caisse'],
];
