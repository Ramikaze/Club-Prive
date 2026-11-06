// Roles and shop accounts, shared by the Worker and the interface. Pure: no import from worker or src.
export const ROLES = ['admin', 'associe', 'gerant'];
export const ROLE_LABEL = { admin: 'Propriétaire / administrateur', associe: 'Associé', gerant: 'Gérant' };

// The two shop departments (« rayons »); an associé owns one of them. Each is also a ledger account.
export const RAYONS = ['cigares', 'alcool'];
export const RAYON_LABEL = { cigares: 'Cigares', alcool: 'Champagne' };

export const SHOP = {
  cigares: { category: 'cigare', tab: 'Cigares', title: 'Vente de cigares', tag: 'Compte Cigares · Boutique', purpose: 'boutique cigares' },
  alcool: { category: 'bouteille', tab: 'Champagnes', title: 'Vente de champagne', tag: 'Compte Alcool · Boutique', purpose: 'boutique champagne' },
};

// The account a product category sells into.
export const accountOfCategory = (category) => (category === 'cigare' ? 'cigares' : 'alcool');

// Club management: the administrator and the associés.
export const isBoss = (user) => user?.role === 'admin' || user?.role === 'associe';

// The administrator owns both accounts; an associé owns the one of his rayon.
export const ownsAccount = (user, account) => user?.role === 'admin' || (user?.role === 'associe' && user.rayon === account);

// Any manager sells in both rayons; a boss sells in the accounts he owns.
export const canSellIn = (user, account) => user?.role === 'gerant' || ownsAccount(user, account);
