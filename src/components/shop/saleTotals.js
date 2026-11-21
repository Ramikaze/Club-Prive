// The figures of the sale screen (spec docs/superpowers/specs/2026-11-21-remise-prix-par-lot-design.md, § 4): the cart's
// lines priced with the lot, the discount as typed, the total. The same shared/pricing.js as the server, so the screen
// shows the total the server records. Pure (no store, no React): `format.js` is not imported here.
import { priceSale } from '../../../shared/pricing.js';
import { parseMoney } from '../../lib/moneyText.js';

// The discount of a cart (`{ kind, input }`, the text as typed) as the server reads it: null while nothing is typed; a
// text that is not a whole percentage or an amount gives NaN, which shared/pricing.js refuses with its message.
export function discountOf(cartDiscount) {
  if (!cartDiscount) return null;
  const input = String(cartDiscount.input ?? '').trim();
  if (input === '') return null;
  if (cartDiscount.kind === 'pourcentage') return { kind: 'pourcentage', value: /^\d+$/.test(input) ? Number(input) : NaN };
  return { kind: cartDiscount.kind, value: parseMoney(input) ?? NaN };
}

// The cart priced: its lines in catalogue order (`products`, `cart.lines` as { [productId]: quantity }), its discount,
// the manager's cap (`capPct`, null for the administrator and the associés). See priceSale for the result.
export function cartTotals(products, cart, capPct) {
  const lines = products.filter((p) => (cart.lines[p.id] ?? 0) > 0).map((p) => ({ product: p, quantity: cart.lines[p.id] }));
  return priceSale(lines, discountOf(cart.discount), { capPct });
}
