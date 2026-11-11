// Roles and shop accounts, shared by the Worker and the interface. Pure: no import from worker or src.
export const ROLES = ['admin', 'associe', 'gerant'];
export const ROLE_LABEL = { admin: 'Administrateur', associe: 'Associé', gerant: 'Gérant' };

// The two shop departments (« rayons »); an associé owns one of them. Each is also a ledger account.
export const RAYONS = ['cigares', 'alcool'];
export const RAYON_LABEL = { cigares: 'Cigares', alcool: 'Champagne' };

export const SHOP = {
  cigares: { category: 'cigare', tab: 'Cigares', title: 'Vente de cigares', tag: 'Compte Cigares · Boutique', purpose: 'boutique cigares' },
  alcool: { category: 'bouteille', tab: 'Champagnes', title: 'Vente de champagne', tag: 'Compte Alcool · Boutique', purpose: 'boutique champagne' },
};

// The three product categories: cigars, champagne (stored as « bouteille ») and other drinks (« boisson »).
// Screen labels come from here only.
export const CATEGORIES = ['cigare', 'bouteille', 'boisson'];
export const CATEGORY_LABEL = { cigare: 'Cigare', bouteille: 'Champagne', boisson: 'Autre boisson' };
export const CATEGORY_PLURAL = { cigare: 'Cigares', bouteille: 'Champagne', boisson: 'Autres boissons' };

// The account a product category sells into: cigars into Cigares, champagne and other drinks into Alcool.
export const accountOfCategory = (category) => (category === 'cigare' ? 'cigares' : 'alcool');

// Club management: the administrator and the associés.
export const isBoss = (user) => user?.role === 'admin' || user?.role === 'associe';

// The administrator owns both accounts; an associé owns the one of his rayon.
export const ownsAccount = (user, account) => user?.role === 'admin' || (user?.role === 'associe' && user.rayon === account);

// Any manager sells in both rayons; a boss sells in the accounts he owns.
export const canSellIn = (user, account) => user?.role === 'gerant' || ownsAccount(user, account);
