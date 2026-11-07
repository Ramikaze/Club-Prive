// The associés' caisses (spec docs/superpowers/specs/2026-11-07-caisses-associes-design.md), shared by the Worker
// and the interface. Pure: no import from worker or src. The real till is one; it is shared out into three virtual
// caisses, one per owner of the money: the common one of the two associés (session bookings) and the one of each
// associé (his rayon). Each caisse is a ledger account.
export const CAISSES = ['reservations', 'alcool', 'cigares'];
export const CAISSE_LABEL = {
  reservations: 'Réservation de séance',
  alcool: 'Champagne et autres boissons',
  cigares: 'Cigare',
};

// The categories the caisses rely on, found by this code and never by their name (an administrator may rename
// them). A purchase category always pays from its caisse; « Apport des associés » brings money into the caisse
// chosen. `legacy`: the name the category had before the drinks purchases were split (2026-11-07).
export const CATEGORY_CODES = {
  achat_champagne: { kind: 'depense', name: 'Achats champagne', account: 'alcool', legacy: 'Achats boissons' },
  achat_autres_boissons: { kind: 'depense', name: 'Achats autres boissons', account: 'alcool' },
  achat_cigares: { kind: 'depense', name: 'Achats cigares', account: 'cigares' },
  apport: { kind: 'recette', name: 'Apport des associés', account: null },
};

// The caisse a purchase category pays from, or null for any other category.
export const purchaseAccount = (code) => (code && CATEGORY_CODES[code]?.kind === 'depense' ? CATEGORY_CODES[code].account : null);

// The common caisse belongs to the two associés in equal shares: an amount split in two, the unit left over (an odd
// number of hundredths) going to the Champagne associé, so that the two halves always add up to the amount.
export const splitHalves = (amount) => ({ alcool: Math.ceil(amount / 2), cigares: Math.floor(amount / 2) });
