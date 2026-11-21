// Prices of the Boutique (spec docs/superpowers/specs/2026-11-21-remise-prix-par-lot-design.md), shared by the Worker,
// which records a sale, and the sale screen, which shows it: the same functions give the same total on both sides.
// Pure: no import from worker or src. Amounts are integers in hundredths; a franc is FRANC of them.
export const FRANC = 100;
export const DISCOUNT_KINDS = ['pourcentage', 'montant'];

// A product's lot (« 3 pour 10 000, puis 3 000 l'unité »): lot_qty, lot_price and extra_price, all null without one.
export const lotApplies = (product, quantity) => product.lot_qty != null && quantity >= product.lot_qty;

// The price of `quantity` pieces: the unit price, or from the lot's size on, the lot and each piece beyond it.
export function linePrice(product, quantity) {
  if (!lotApplies(product, quantity)) return quantity * product.price;
  return product.lot_price + (quantity - product.lot_qty) * product.extra_price;
}

// How a discount is named on the ticket: « Remise 10 % » for a percentage (a no-break space before the sign, as the
// money formatter puts before the currency), « Remise » for an amount.
export const discountLabel = (kind, value) => (kind === 'pourcentage' ? `Remise ${value} %` : 'Remise');

// The most a line can take while still costing at least a franc, in whole francs.
const lineCap = (price) => Math.max(0, Math.floor((price - FRANC) / FRANC) * FRANC);

// Spreads `discount` (whole francs) over lines priced `prices`, in proportion to their price and in whole francs: each
// line takes the floor of its exact share, then the francs left go one by one to the lines whose share lost the most
// to the floor (line order between equals), a line never going under one franc. BigInt keeps large sales exact. The
// caller has checked that the discount fits under the lines' caps.
export function spreadDiscount(prices, discount) {
  const S = BigInt(prices.reduce((s, p) => s + p, 0));
  const F = BigInt(FRANC);
  const cap = prices.map(lineCap);
  const exact = prices.map((p) => BigInt(discount) * BigInt(p)); // share × S
  const shares = exact.map((x, i) => Math.min(Number(x / S / F) * FRANC, cap[i]));
  const rest = exact.map((x) => x % (S * F)); // what the floor dropped: biggest first, then line order
  const order = prices.map((_, i) => i).sort((a, b) => (rest[b] > rest[a] ? 1 : rest[b] < rest[a] ? -1 : a - b));
  let left = discount - shares.reduce((s, x) => s + x, 0);
  while (left > 0) {
    let moved = false;
    for (const i of order) {
      if (left === 0) break;
      if (shares[i] + FRANC <= cap[i]) {
        shares[i] += FRANC;
        left -= FRANC;
        moved = true;
      }
    }
    if (!moved) throw new Error('spreadDiscount: more than the lines can take');
  }
  return shares;
}

const problem = (code, message) => ({ code, message });

// What a discount removes from `subtotal`, or why it cannot be taken: an invalid value first, then the manager's cap
// (`capPct`, null for the administrator and the associés), then a discount the lines cannot carry.
function discountOf(subtotal, prices, discount, capPct) {
  const { kind, value } = discount;
  if (!DISCOUNT_KINDS.includes(kind)) return { problem: problem('REMISE_INVALIDE', 'Type de remise inconnu.') };
  let amount;
  if (kind === 'pourcentage') {
    if (!Number.isInteger(value) || value < 1 || value > 99) {
      return { problem: problem('REMISE_INVALIDE', 'Remise en % : un nombre entier de 1 à 99.') };
    }
    amount = Math.round((subtotal * value) / 100 / FRANC) * FRANC;
    if (amount === 0) return { problem: problem('REMISE_INVALIDE', 'Cette remise arrondie au franc vaut 0 FCFA.') };
  } else {
    if (!Number.isInteger(value) || value < FRANC || value % FRANC !== 0) {
      return { problem: problem('REMISE_INVALIDE', 'Remise en montant : un nombre entier de francs.') };
    }
    amount = value;
  }
  if (capPct !== null) {
    const over = kind === 'pourcentage' ? value > capPct : amount > Math.floor((subtotal * capPct) / 100 / FRANC) * FRANC;
    if (over) {
      return {
        problem: problem('PLAFOND_REMISE', capPct === 0
          ? 'Le gérant ne fait pas de remise (plafond à 0 %).'
          : `Remise au-delà du plafond du gérant : ${capPct} % du total au maximum.`),
      };
    }
  }
  if (amount > prices.reduce((s, p) => s + lineCap(p), 0)) {
    return { problem: problem('REMISE_TROP_FORTE', 'Remise trop forte : le total doit rester positif.') };
  }
  return { amount };
}

// A whole sale: `lines` are { product, quantity } (one per product), `discount` is { kind, value } or null. Each line
// keeps its catalogue unit price, its price after the lot, its share of the discount and what is paid for it. A
// discount that cannot be taken leaves the sale undiscounted and says why in `problem`.
export function priceSale(lines, discount, { capPct = null } = {}) {
  const priced = lines.map(({ product, quantity }) => ({
    product_id: product.id, quantity, unit_price: product.price, price: linePrice(product, quantity), lot: lotApplies(product, quantity),
  }));
  const prices = priced.map((l) => l.price);
  const subtotal = prices.reduce((s, p) => s + p, 0);
  const result = discount == null ? { amount: 0 } : discountOf(subtotal, prices, discount, capPct);
  const shares = result.amount ? spreadDiscount(prices, result.amount) : prices.map(() => 0);
  const out = priced.map((l, i) => ({ ...l, discount: shares[i], amount: l.price - shares[i] }));
  const total = subtotal - (result.amount ?? 0);
  return { lines: out, subtotal, discount: result.amount ?? 0, total, problem: result.problem ?? null };
}
