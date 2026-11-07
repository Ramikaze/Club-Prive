// Supplier accounts (spec docs/superpowers/specs/2026-11-07-comptes-fournisseurs-design.md), shared by the Worker and
// the interface. Pure: no import from worker or src. An account is kept in the club's currency (FCFA); an amount in
// euros or dollars is written next to it, between brackets, for information only: it never enters a calculation.
export const FOREIGN_CURRENCIES = ['EUR', 'USD'];
export const FOREIGN_SYMBOL = { EUR: '€', USD: '$' };
export const FOREIGN_LABEL = { EUR: 'Euro (€)', USD: 'Dollar US ($)' };

// A supplier belongs to one caisse and is paid from it alone (owner's rule): an associé's, never the common one.
export const SUPPLIER_CAISSES = ['alcool', 'cigares'];

// What raises the debt: a credit purchase, or the balance already owed before the application (carried over).
export const PURCHASE_KINDS = ['achat', 'report'];
export const PURCHASE_KIND_LABEL = { achat: 'Achat', report: 'Solde reporté' };

// The purchase category a payment of a supplier of this caisse opens with (the Champagne caisse may switch to « Achats
// autres boissons »).
export const SUPPLIER_DEFAULT_CATEGORY = { alcool: 'achat_champagne', cigares: 'achat_cigares' };

// Amount in cents -> « 1 250 € », « 980,50 $ »: decimals only when there are cents.
export function formatForeign(minor, currency) {
  const cents = minor % 100 !== 0;
  const n = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);
  return `${n} ${FOREIGN_SYMBOL[currency] ?? currency}`;
}
