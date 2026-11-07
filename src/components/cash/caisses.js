// The six tiles of « Soldes » (pure, no JSX, no store): GET /api/caisses read left to right as the owner ordered them
// (2026-11-07). Fund, card credit, the three caisses, the till; the five on the left add up to the last. Each caisse
// shows how it got there and the buttons the person may use: the administrator every one; an associé pays a
// supplier and makes an apport on either caisse (the other associé may be away, decision 8) and takes profits from
// his own caisse or the common one only; « Payer un fournisseur » never on the common caisse. `fmt` formats money
// and days ({ money, day, today }), so that the tiles are tested without the store.
import { CAISSE_LABEL } from '../../../shared/caisses.js';

const line = (label, amount, out = false) => ({ label, amount: Math.abs(amount), sign: out || amount < 0 ? 'out' : 'in' });

function actionsFor(me, key, past) {
  const boss = me?.role === 'admin' || me?.role === 'associe';
  // On a past period the tiles show that day's balances, not today's: no button acts on them.
  if (!boss || past) return [];
  const mayTake = me.role === 'admin' || key === 'reservations' || me.rayon === key;
  return [...(key !== 'reservations' ? ['fournisseur'] : []), ...(mayTake ? ['benefices'] : []), 'apport'];
}

export function caisseTiles(b, me, fmt) {
  if (!b.started) return null;
  const past = b.to < fmt.today;
  const end = past ? `au ${fmt.day(b.to)}` : 'à ce jour';
  const { reservations: r, alcool: a, cigares: c } = b.caisses;
  const caisse = (key, lines, extra = []) => {
    const balance = b.caisses[key].balance;
    return {
      key, title: CAISSE_LABEL[key], value: balance, negative: balance < 0, lines,
      hints: [...extra, ...(balance < 0 ? ['Remettez de l’argent dans cette caisse.'] : [])],
      actions: actionsFor(me, key, past),
    };
  };
  const optional = (label, amount, out) => (amount !== 0 ? [line(label, amount, out)] : []);
  return [
    {
      key: 'fond', title: 'Fond de caisse', value: b.fund.amount, negative: false, lines: [], actions: [],
      hints: [
        b.start ? `au ${fmt.day(b.start)}` : 'depuis le début',
        ...(b.fund.card_credit > 0 ? [`dont crédit des cartes déjà là : −${fmt.money(b.fund.card_credit)}`] : []),
      ],
    },
    { key: 'cartes', title: 'Solde de crédit sur les cartes clients non utilisées', value: b.cards, negative: false, lines: [], actions: [], hints: [end] },
    caisse('reservations', [
      line('Réservations', r.sold),
      line('Dépenses communes', r.expenses, true),
      ...optional('Apports et entrées', r.apports),
      ...optional('Bénéfices pris', r.taken, true),
    ], r.balance > 0 ? [`soit ${fmt.money(r.halves.cigares)} chacun`] : []),
    caisse('alcool', [
      line('Vendu champagne', a.sold_champagne),
      line('Vendu autres boissons', a.sold_autres),
      line('Achats champagne', a.purchases_champagne, true),
      line('Achats autres boissons', a.purchases_autres, true),
      ...optional('Autres dépenses', a.other_expenses, true),
      ...optional('Apports', a.apports),
      line('Bénéfices pris', a.taken, true),
    ]),
    caisse('cigares', [
      line('Vendu', c.sold),
      line('Achats cigares', c.purchases, true),
      ...optional('Autres dépenses', c.other_expenses, true),
      ...optional('Apports', c.apports),
      line('Bénéfices pris', c.taken, true),
    ]),
    { key: 'caisse', title: 'Solde en caisse', value: b.till, negative: false, lines: [], actions: [], hints: [end] },
  ];
}
