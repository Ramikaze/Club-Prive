// The Caisse by category (pure, no JSX): three columns, each with the day's net and what was billed. The nets come
// from the summary (the money counted on the day it is collected or returned), the lines from /api/finance/billed
// (what was billed in the period, paid or not).
import { CATEGORY_PLURAL } from '../../../shared/roles.js';

// A part is one list under a net; `key` is the key of billed.columns it reads.
const part = (key, title, net, billed) => {
  const c = billed.columns[key] ?? { count: 0, truncated: false, lines: [] };
  return { key, title, net, count: c.count, truncated: c.truncated, lines: c.lines };
};

export function categoryColumns(sum, billed) {
  const account = (k) => sum.accounts.find((a) => a.account === k);
  const alcool = account('alcool');
  return [
    { key: 'reservations', title: 'Réservation séance', icon: 'rooms', net: account('reservations').net, parts: [part('reservations', null, account('reservations').net, billed)] },
    {
      key: 'boisson', title: 'Boisson', icon: 'bottle', net: alcool.net,
      parts: [
        part('champagne', CATEGORY_PLURAL.bouteille, alcool.champagne.net, billed),
        { ...part('autres_boissons', CATEGORY_PLURAL.boisson, alcool.autres_boissons.net, billed), icon: 'drink' },
      ],
    },
    { key: 'cigares', title: 'Cigare', icon: 'cigar', net: account('cigares').net, parts: [part('cigares', null, account('cigares').net, billed)] },
  ];
}

// What a billed line says: its title, and where it comes from (empty for a plan). The day client is only a name:
// the server sends no member for him.
export function lineTexts(line) {
  const { kind, member_name: who } = line;
  if (kind === 'abonnement') return { title: `Abonnement · ${line.plan_name} · ${who}`, origin: '' };
  if (kind === 'temps_supplementaire') {
    return { title: line.label, origin: ['Séance n° ' + line.reservation_id, line.room_name, who].filter(Boolean).join(' · ') };
  }
  const title = `${line.label} × ${line.quantity}`;
  if (line.shop_sale_id) return { title, origin: `Boutique · ${who}` };
  if (line.reservation_id) return { title, origin: `Séance n° ${line.reservation_id} · ${who}` };
  return { title, origin: who };
}
