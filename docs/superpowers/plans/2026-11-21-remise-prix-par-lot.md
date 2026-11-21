# Remise et prix par lot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the Boutique counter, price a product by lot (coupe-cigare: 3 for 10 000, then 3 000 each) and let any seller take a discount off the total (in % or FCFA, the manager capped at 10 %), with every money figure of the app staying right.

**Architecture:** One pure module `shared/pricing.js` prices a sale (lot, discount, its spread over the lines, the manager's cap) for both the Worker and the screen. Migration V31 rebuilds `charges` so a Boutique line keeps its catalogue `unit_price`, real `quantity`, the `amount` really paid and its `discount` share; every existing total keeps reading `amount`. The screen sends the discount and the total it shows; the server recomputes and refuses a different total.

**Tech Stack:** Cloudflare Worker + SQLite (Durable Object; `node:test` with `worker/db-node.js` locally), React + Vite.

**Spec:** `docs/superpowers/specs/2026-11-21-remise-prix-par-lot-design.md`

## Global Constraints

- Amounts are integers in hundredths (`UM = 100` in tests, `FRANC = 100` in code). Discounts, lot prices and spread shares are whole francs.
- Only a Boutique line (`shop_sale_id IS NOT NULL`) may have `amount ≠ quantity × unit_price`; every other `insertCharge` caller is unchanged.
- The server computes everything; the screen sends only `discount: { kind, value }` and `expected_total`. Never trust an amount from the body.
- Existing money totals (`SUM(... amount ...)`) are not edited: they read the net `amount`.
- Manager cap: setting `gerant_discount_cap_pct`, default `10`, integer 0–99, changed by the administrator only; administrator and associés are uncapped.
- Nothing changes for sessions (reservations), the client space, subscriptions, settlements, recharges.
- Error codes and French messages exactly as in the spec: `REMISE_INVALIDE` (400), `REMISE_TROP_FORTE`, `PLAFOND_REMISE`, `PAGE_A_RECHARGER`, `TOTAL_CHANGE` (409).
- UI copy in French, code comments in English, as in the rest of the code. Commit messages in French, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The same product twice in one body (`[{coupe, 2}, {coupe, 2}]`) is one line of 4: the lot applies (13 000) and the screen's total matches. → test in Task 4.
- A discount typed, then lines removed until it no longer fits: the screen warns and blocks, the server would refuse `REMISE_TROP_FORTE`. → test in Task 5.
- A price with centimes (40 000,50) under a % discount: shares stay whole francs, line amounts keep their centimes, the sum is exact. → test in Task 1.
- A client's online order (`order_id`) holding a lot product, cashed at the counter: the lot applies and the order ends « retirée ». → test in Task 4.
- A discounted credit sale cancelled later: the client's debt drops by the net amount, not the gross. → test in Task 4.

---

### Task 1: Pricing core (`shared/pricing.js`)

**Files:**
- Create: `shared/pricing.js`
- Test: `test/pricing.test.js`

**Interfaces:**
- Produces:
  - `FRANC = 100`, `DISCOUNT_KINDS = ['pourcentage', 'montant']`
  - `lotApplies(product, quantity) → boolean` (product `{ price, lot_qty, lot_price, extra_price }`, lot fields null = no lot)
  - `linePrice(product, quantity) → number`
  - `discountLabel(kind, value) → string` — `'Remise 10 %'` for a percentage, `'Remise'` for an amount
  - `spreadDiscount(prices: number[], discount: number) → number[]`
  - `priceSale(lines: { product, quantity }[], discount: { kind, value } | null, { capPct = null } = {}) → { lines: { product_id, quantity, unit_price, price, lot, discount, amount }[], subtotal, discount, total, problem: null | { code, message } }`. With a `problem`, every line has `discount: 0`, `discount` is 0 and `total === subtotal`.

- [ ] **Step 1: Write the failing tests** in `test/pricing.test.js` (`import { ... } from '../shared/pricing.js'`, `UM = 100`). `COUPE = { id: 1, price: 5000 * UM, lot_qty: 3, lot_price: 10000 * UM, extra_price: 3000 * UM }`.
  - `linePrice : grille du coupe-cigare` → quantities 1…6 give `[5000, 10000, 10000, 13000, 16000, 19000].map((x) => x * UM)`; a product with null lot fields: `linePrice({ price: 7000 * UM, lot_qty: null }, 3) === 21000 * UM`; `lotApplies(COUPE, 2) === false`, `lotApplies(COUPE, 3) === true`.
  - `priceSale : lot puis remise de 10 %` → `[{ product: COUPE, quantity: 4 }, { product: { id: 2, price: 12500 * UM }, quantity: 1 }]`, `{ kind: 'pourcentage', value: 10 }` → `subtotal 25500 * UM`, `discount 2550 * UM`, `total 22950 * UM`, `lines[0]` `{ unit_price: 5000 * UM, price: 13000 * UM, lot: true }`, `lines[1].lot === false`, sum of line discounts `2550 * UM`, every `amount === price − discount`, `problem === null`.
  - `priceSale : pourcentage arrondi au franc` → one line `{ price: 12345 * UM }` × 1, 10 % → `discount 1235 * UM`.
  - `priceSale : montant réparti au plus grand reste` → three lines of `10000 * UM`, `{ kind: 'montant', value: 1000 * UM }` → line discounts `[334, 333, 333].map((x) => x * UM)`.
  - `spreadDiscount : chaque ligne garde au moins 1 franc` → `spreadDiscount([2 * UM, 98 * UM], 98 * UM)` deep-equals `[1 * UM, 97 * UM]`.
  - `priceSale : centimes gardés` → one line `{ price: 4000050 }` (40 000,50) × 1, 10 % → `discount 400000` (4 000 F), `lines[0].amount === 3600050`.
  - `priceSale : remise trop forte` → lines `2 * UM` and `98 * UM`, `{ kind: 'montant', value: 99 * UM }` → `problem.code 'REMISE_TROP_FORTE'`, `discount 0`, `total 100 * UM`.
  - `priceSale : valeurs refusées` → each of `{ kind: 'pourcentage', value: 0 }`, `{ … 100 }`, `{ … 12.5 }`, `{ kind: 'montant', value: 150 }`, `{ kind: 'montant', value: 0 }`, `{ kind: 'cadeau', value: 5 }`, `{ kind: 'pourcentage', value: '10' }` gives `problem.code 'REMISE_INVALIDE'`; a 1 % discount of a `30 * UM` line (rounds to 0 F) also does.
  - `priceSale : plafond du gérant` → lines 12500, 11500, 10000 F (`subtotal 34000 * UM`), `capPct: 10`: 10 % passes; 11 % → `'PLAFOND_REMISE'`; montant `3400 * UM` passes; montant `3500 * UM` → `'PLAFOND_REMISE'`; `capPct: 0` with 1 % → `'PLAFOND_REMISE'`; `capPct: null` with 50 % passes.
  - `discountLabel` → `discountLabel('pourcentage', 10) === 'Remise 10 %'`, `discountLabel('montant', 500000) === 'Remise'`.
  - `priceSale : sans remise` → `discount null` gives `discount 0`, `total === subtotal`, `problem null`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/pricing.test.js`
Expected: FAIL (`Cannot find module '../shared/pricing.js'`).

- [ ] **Step 3: Implement `shared/pricing.js`** (pure, no import from `worker/` or `src/`).
  - `linePrice`: `quantity × price` unless `lotApplies`, then `lot_price + (quantity − lot_qty) × extra_price`.
  - Discount checks in this order, each returning `{ code, message }` with the spec's French message:
    1. `REMISE_INVALIDE` — kind not in `DISCOUNT_KINDS`; percentage not an integer 1–99; amount not an integer multiple of `FRANC` ≥ `FRANC`; a percentage that rounds to 0 F. Percentage amount: `Math.round(subtotal * value / 100 / FRANC) * FRANC`.
    2. `PLAFOND_REMISE` (only when `capPct !== null`) — percentage `value > capPct`, or amount `> Math.floor(subtotal * capPct / 100 / FRANC) * FRANC`. Message: `Remise au-delà du plafond du gérant : ${capPct} % du total au maximum.`; with `capPct === 0`: `Le gérant ne fait pas de remise (plafond à 0 %).`
    3. `REMISE_TROP_FORTE` — amount above the sum of the line caps, a cap being `max(0, floor((price − FRANC) / FRANC) × FRANC)`. Message: `Remise trop forte : le total doit rester positif.`
  - `spreadDiscount` (the order matters; BigInt keeps large sales exact):

```js
export function spreadDiscount(prices, discount) {
  const S = BigInt(prices.reduce((s, p) => s + p, 0));
  const F = BigInt(FRANC);
  const cap = prices.map((p) => Math.max(0, Math.floor((p - FRANC) / FRANC) * FRANC));
  const exact = prices.map((p) => BigInt(discount) * BigInt(p)); // share × S
  const shares = exact.map((x, i) => Math.min(Number(x / S / F) * FRANC, cap[i]));
  const rest = exact.map((x) => x % (S * F)); // what the floor dropped: biggest first, then line order
  const order = prices.map((_, i) => i).sort((a, b) => (rest[b] > rest[a] ? 1 : rest[b] < rest[a] ? -1 : a - b));
  let left = discount - shares.reduce((s, x) => s + x, 0);
  while (left > 0) {
    let moved = false;
    for (const i of order) {
      if (left === 0) break;
      if (shares[i] + FRANC <= cap[i]) { shares[i] += FRANC; left -= FRANC; moved = true; }
    }
    if (!moved) throw new Error('spreadDiscount: more than the lines can take');
  }
  return shares;
}
```

  - `priceSale` calls `spreadDiscount` only when the discount passed every check and is > 0.

- [ ] **Step 4: Run the tests**

Run: `node --test test/pricing.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add shared/pricing.js test/pricing.test.js
git commit -m "Prix de la Boutique : lot et remise calculés à un seul endroit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration V31 and `insertCharge`

**Files:**
- Modify: `worker/schema.js` (new `V31` after `V30`, add it to `MIGRATIONS`)
- Modify: `worker/club.js` (`insertCharge` ~2705)
- Test: `test/remise-v31.test.js` (new)

**Interfaces:**
- Produces: columns `charges.discount`, `shop_sales.discount_kind` / `discount_value`, `products.lot_qty` / `lot_price` / `extra_price`; `insertCharge(actor, c)` accepts optional `c.amount` (default `c.quantity * c.unit_price`) and `c.discount` (default 0).

- [ ] **Step 1: Write the failing test** `test/remise-v31.test.js`, built like `test/credit-v21.test.js` (`v30Copy` = its `v20Copy` with `MIGRATIONS.slice(0, 30)` and version `'30'`). On a source server: a member's card sale then its cancellation (refund, restock, card movement), a walk-in cash sale, a regular client's credit sale then a settlement, a gift (`POST /api/products/:id/offer` by an associé). `read(db)` = `charges` rows (every column but `discount`), `payment_allocations`, `refunds`, `stock_movements` (`id, product_id, charge_id, gift_id, quantity`), ordered by id.
  - `migration V31 sans perte : lignes, paiements, remboursements et stock gardés` → after `old.start()`: `schema_version === String(MIGRATIONS.length)`; `read(old.db)` deep-equals `read(source.db)`; `SELECT COUNT(*) FROM charges WHERE discount <> 0` is 0; `PRAGMA foreign_key_check` is `[]`; no `charges_v30` table; the index names on `charges` include `charges_reservation`, `charges_member`, `charges_created`, `charges_consumer`, `charges_shop_sale`, `charges_product`.
  - `V31 : seule une ligne Boutique s'écarte de quantité × prix` → on the migrated db, a raw `INSERT INTO charges` with `shop_sale_id NULL`, `quantity 1`, `unit_price 1000`, `amount 900` throws (CHECK); the same with an existing `shop_sale_id` and `discount 100` succeeds; one with `amount 900, discount 200` throws.

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/remise-v31.test.js`
Expected: FAIL (no `discount` column / version 30).

- [ ] **Step 3: Write `V31`** in `worker/schema.js`, with a comment pointing at the spec and at V15 for why the table is dropped, not renamed:

```js
const V31 = [
  'ALTER TABLE products ADD COLUMN lot_qty INTEGER CHECK (lot_qty IS NULL OR lot_qty BETWEEN 2 AND 99)',
  'ALTER TABLE products ADD COLUMN lot_price INTEGER CHECK (lot_price IS NULL OR lot_price > 0)',
  'ALTER TABLE products ADD COLUMN extra_price INTEGER CHECK (extra_price IS NULL OR extra_price > 0)',
  "ALTER TABLE shop_sales ADD COLUMN discount_kind TEXT CHECK (discount_kind IS NULL OR discount_kind IN ('pourcentage', 'montant'))",
  'ALTER TABLE shop_sales ADD COLUMN discount_value INTEGER CHECK (discount_value IS NULL OR discount_value > 0)',
  'PRAGMA defer_foreign_keys = ON',
  'CREATE TABLE charges_v30 AS SELECT * FROM charges',
  'DROP TABLE charges',
  `CREATE TABLE charges (
    id INTEGER PRIMARY KEY,
    account TEXT NOT NULL CHECK (account IN ('reservations', 'alcool', 'cigares')),
    kind TEXT NOT NULL CHECK (kind IN ('temps_supplementaire', 'produit', 'abonnement')),
    member_id INTEGER NOT NULL REFERENCES members(id),
    reservation_id INTEGER REFERENCES reservations(id),
    subscription_id INTEGER REFERENCES subscriptions(id),
    product_id INTEGER REFERENCES products(id),
    label TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('due', 'payee', 'annulee', 'remboursee')),
    tariff_validated INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancel_reason TEXT,
    consumer_member_id INTEGER REFERENCES members(id),
    deposit INTEGER NOT NULL DEFAULT 0 CHECK (deposit IN (0, 1)),
    shop_sale_id INTEGER REFERENCES shop_sales(id),
    settled INTEGER NOT NULL DEFAULT 0 CHECK (settled >= 0),
    carryover INTEGER NOT NULL DEFAULT 0 CHECK (carryover IN (0, 1)),
    unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
    discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
    CHECK (shop_sale_id IS NOT NULL OR (discount = 0 AND amount = quantity * unit_price)),
    CHECK (amount + discount <= quantity * unit_price)
  )`,
  // INSERT … SELECT naming the 24 V30 columns on both sides, then:
  'DROP TABLE charges_v30',
  // the six CREATE INDEX of V1 (3), V6, V18 and V19, unchanged.
];
```

- [ ] **Step 4: Change `insertCharge`** to write `c.amount ?? c.quantity * c.unit_price` and `c.discount ?? 0` (new `discount` column in the INSERT).

- [ ] **Step 5: Run the test, then the whole suite**

Run: `node --test test/remise-v31.test.js && npm test`
Expected: PASS everywhere (no existing test changes behaviour).

- [ ] **Step 6: Commit**

```bash
git add worker/schema.js worker/club.js test/remise-v31.test.js
git commit -m "Migration V31 : une ligne Boutique garde le montant payé et sa remise" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Lot price on the product sheet

**Files:**
- Modify: `worker/club.js` (`productDTO` ~3180, `productFields` ~3207, `createProduct` ~3229, `updateProduct` ~3244)
- Modify: `src/pages/Products.jsx` (`ProductDialog` ~90, product sheet facts ~370)
- Modify: `src/components/shop/ShopProductCard.jsx` (under `.shop-card-price`)
- Test: `test/product-lot.test.js` (new)

**Interfaces:**
- Consumes: product lot columns (Task 2), `FRANC` (Task 1).
- Produces: `productDTO` gives `lot_qty`, `lot_price`, `extra_price` (null without a lot) to every role; `POST/PUT /api/products` accept them (all three null or `''` clear the lot; left out, they keep the current ones).

- [ ] **Step 1: Write the failing tests** (`test/product-lot.test.js`, admin + gérant users, `UM = 100`):
  - `prix par lot : enregistré, lu par le gérant, effacé` → admin creates `{ category: 'cigare', price: 5000 * UM, lot_qty: 3, lot_price: 10000 * UM, extra_price: 3000 * UM, … }`; the gérant's `GET /api/products` shows the three values; `PUT` with the three at `null` → all null; a `PUT` without them keeps them.
  - `prix par lot : refus` → status 400 for: only `lot_qty` given; `lot_qty: 1`; `lot_price: 15000 * UM` (= 3 × price); `extra_price: 6000 * UM` (> price); `lot_price: 50` (under a franc).
  - `prix par lot : noté au journal` → the last `produit.modifier` audit row's `apres` holds `lot_qty`, `lot_price`, `extra_price`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/product-lot.test.js`
Expected: FAIL (fields absent from the DTO).

- [ ] **Step 3: Implement the server side.** `productFields` returns `lot: null | { qty, price, extra }`. Messages: partial → `Prix par lot : remplissez les trois champs (quantité, prix du lot, prix par unité en plus), ou aucun.`; `int(v, 'Quantité du lot', { min: 2, max: 99 })`, `int(v, 'Prix du lot', { min: FRANC })`, `int(v, 'Prix par unité en plus', { min: FRANC })`; lot ≥ qty × price → `Prix par lot : le lot doit coûter moins cher que ses pièces au prix normal.`; extra > price → `Prix par lot : une unité en plus ne peut pas coûter plus que le prix de vente.` Write the columns in both INSERT and UPDATE; add them to `avant` / `apres`.

- [ ] **Step 4: Implement the screens.** `ProductDialog`: a form row « Prix par lot (facultatif) » with `lot_qty` (`type="number"`, min 2, max 99), `lot_price` and `extra_price` (money inputs like `price`), help « Exemple : 3 pour 10 000, puis 3 000 par pièce en plus. Laissez vide s’il n’y a pas de lot. »; all empty → send the three as `null`; a money field that `parseMoney` refuses → `throw new Error('Prix par lot invalide (exemple : 10000).')`. Product sheet: `Prix par lot` → `3 pour 10 000 FCFA, puis 3 000 FCFA l’unité`. `ShopProductCard`: under the price, `3 pour 10 000 FCFA` when `product.lot_qty`.

- [ ] **Step 5: Run the tests and the build**

Run: `node --test test/product-lot.test.js && npm run build`
Expected: PASS, build without error.

- [ ] **Step 6: Commit**

```bash
git add worker/club.js src/pages/Products.jsx src/components/shop/ShopProductCard.jsx test/product-lot.test.js
git commit -m "Prix par lot réglable sur la fiche produit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sale with lot, discount, manager cap and checked total (server)

**Files:**
- Modify: `worker/shop.js` (`createShopSale` ~88, `shopSaleDTO` ~197)
- Modify: `worker/club.js` (settings defaults ~109, `normalizeSetting` ~501)
- Modify: `test/harness.js` (new `postSale`), and every test file that posts `'/api/shop/sales'` (22 files, 49 calls)
- Modify: `test/client-orders.test.js` (one new test)
- Test: `test/shop-discount.test.js` (new)

**Interfaces:**
- Consumes: `priceSale` (Task 1), `insertCharge` with `amount` / `discount` (Task 2), product lot fields (Task 3).
- Produces:
  - `POST /api/shop/sales` body: `discount?: { kind, value } | null`, `expected_total: number` (required).
  - Sale DTO: `subtotal`, `discount` (sum of the lines'), `discount_kind`, `discount_value`; each line `discount`, `price` (`amount + discount`), `lot` (`quantity × unit_price > price`).
  - Setting `gerant_discount_cap_pct` (default 10, `int(v, 'Remise maximale du gérant', { min: 0, max: 99 })`).
  - `postSale(client, body, headers)` in `test/harness.js`.

- [ ] **Step 1: Add `postSale` to `test/harness.js`.** It reads `GET /api/products?all=1` with the same client, merges the body's lines by `product_id`, prices them with `priceSale` (no cap: the server alone applies it), and posts the body with `expected_total` added unless the body already has one. A body it cannot price (bad lines, unknown product, failed read) goes as is.

- [ ] **Step 2: Move every test sale onto `postSale`**

```bash
perl -pi -e "s/([\w.]+)\.post\('\/api\/shop\/sales', /postSale(\$1, /g" test/*.test.js
grep -l "postSale(" test/*.test.js
```

Then add `postSale` to the `./harness.js` import of each file the second command lists.

Run: `npm test`
Expected: PASS (the server does not require `expected_total` yet).

- [ ] **Step 3: Write the failing tests** in `test/shop-discount.test.js` (admin, gérant `ger`, associé cigares `cig`; `COUPE` = cigar product price 5000, lot 3/10000/3000, stock 20; `BARREDA` = cigar 12500, stock 10):
  - `lot et remise : lignes nettes, prix catalogue gardé` → `postSale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: COUPE, quantity: 4 }, { product_id: BARREDA, quantity: 1 }], method: 'Espèces', discount: { kind: 'pourcentage', value: 10 } })` → `sale.amount === payment.amount === 22950 * UM`, `sale.subtotal 25500 * UM`, `sale.discount 2550 * UM`; the coupe charge has `unit_price 5000 * UM`, `quantity 4`, `amount + discount === 13000 * UM`; `shop_sales` row `discount_kind 'pourcentage'`, `discount_value 10`; coupe stock down 4; the `boutique.vente` audit holds `sous_total`, `remise.montant 2550 * UM`, `prix_par_lot` with the coupe's name.
  - `même produit deux fois : une ligne de 4, prix par lot` → lines `[{ COUPE, 2 }, { COUPE, 2 }]`, no discount → one charge, `quantity 4`, `amount 13000 * UM`.
  - `carte du membre : paie le total net` → member recharged 30000 F, 4 coupes with `card: true` → `payment.card_amount 13000 * UM`, card balance `17000 * UM`.
  - `crédit : plafond comparé au total net, annulation au net` → client with `credit_limit 15000 * UM`, 4 coupes `credit: true` → accepted (gross 20 000 would exceed); owed `13000 * UM`; admin cancels the sale → owed back to 0.
  - `annulation : rembourse le payé, remet toutes les pièces` → the first sale cancelled by `cig` → refunds sum `22950 * UM`, coupe stock back up 4.
  - `bénéfice réel : ventes nettes, coût de toutes les pièces` → `COUPE` `cost_price 1000 * UM`; 4 coupes sold → `GET /api/finance/profit?from=today` product row `quantity 4`, `sales 13000 * UM`, `cost 4000 * UM`.
  - `plafond du gérant` → `ger` 11 % → 409 `PLAFOND_REMISE`; 10 % passes; montant above 10 % of the subtotal → `PLAFOND_REMISE`; `cig` 50 % passes; admin `PUT /api/settings { gerant_discount_cap_pct: 0 }` → `ger` 1 % refused; back to 10; `cig` `PUT /api/settings` → 403; admin `PUT … 100` → 400.
  - `remise refusée : rien n'est écrit` → 0 % → 400 `REMISE_INVALIDE`; montant = subtotal → 409 `REMISE_TROP_FORTE`; `shop_sales`, `charges`, `payments` counts unchanged.
  - `total contrôlé : manquant ou différent` → raw `ger.post('/api/shop/sales', body)` without `expected_total` → 409 `PAGE_A_RECHARGER`; with `expected_total: 20000 * UM` for 4 coupes → 409 `TOTAL_CHANGE`; counts unchanged.
  - In `test/client-orders.test.js`: `commande avec prix par lot : le lot s'applique à l'encaissement` → `newProduct('cigare', 10)`, admin sets the lot (3/10000/3000), `person()` orders 4, `postSale(ger, { …, order_id })` → `sale.amount 13000 * UM`, order `status 'retiree'`.

- [ ] **Step 4: Run them to see them fail**

Run: `node --test test/shop-discount.test.js`
Expected: FAIL (no discount handling, `PAGE_A_RECHARGER` not raised).

- [ ] **Step 5: Implement.**
  - Settings default `gerant_discount_cap_pct: 10` and its `normalizeSetting` case.
  - `createShopSale`, in this order: existing checks on account, rights and lines; `discount` must be absent, `null` or a plain object; `priceSale(products.map(({ p, quantity }) => ({ product: p, quantity })), discount, { capPct: actor.role === 'gerant' ? this.settings().gerant_discount_cap_pct : null })`; a `problem` throws `invalid(message, 'REMISE_INVALIDE')` or `conflict(code, message)`; existing buyer / card / credit / method / open-day / order checks, with `assertCreditAllowed(m, priced.total)`; then `expected_total` (missing → `conflict('PAGE_A_RECHARGER', 'Rechargez la page avant d’encaisser.')`; `int(…, 'Total affiché', { min: 0 }) !== priced.total` → `conflict('TOTAL_CHANGE', 'Les prix ont changé : vérifiez le panier avant d’encaisser.')`); only then the writes. `shop_sales` gets `discount_kind` / `discount_value` when `priced.discount > 0`; each charge gets `unit_price`, `quantity`, `amount`, `discount` from `priced.lines`. Audit (credit and paid): add `sous_total`, `remise: { type, valeur, montant }` when there is one, `prix_par_lot: [names]` when a lot applied.
  - `shopSaleDTO`: read `c.discount`, `s.discount_kind`, `s.discount_value`; add the fields of the Interfaces block.

- [ ] **Step 6: Run the new tests, then the whole suite**

Run: `node --test test/shop-discount.test.js test/client-orders.test.js && npm test`
Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add worker/shop.js worker/club.js test/
git commit -m "Vente Boutique : prix par lot, remise, plafond du gérant et total contrôlé" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sale screen (`SalePanel`, `Shop`, Paramètres)

**Files:**
- Create: `src/components/shop/saleTotals.js`
- Modify: `src/components/shop/SalePanel.jsx`, `src/pages/Shop.jsx` (`emptyCart`, phone « Panier » button), `src/pages/Settings.jsx` (`RulesSection`)
- Modify: the stylesheet holding `.sale-lines` (new rules beside it)
- Test: `test/sale-totals.test.js` (new)

**Interfaces:**
- Consumes: `priceSale`, `lotApplies`, `FRANC` (Task 1); product lot fields (Task 3); sale body and error codes, setting `gerant_discount_cap_pct` (Task 4).
- Produces (`saleTotals.js`, pure; imports `parseMoney` from `src/lib/moneyText.js`, never from `format.js`):
  - `discountOf(cartDiscount: { kind, input } | null) → { kind, value } | null` — empty `input` → `null`; `pourcentage`: `/^\d+$/` → `Number(input)`, else `NaN`; `montant`: `parseMoney(input) ?? NaN`.
  - `cartTotals(products, cart, capPct) → priceSale result` for the cart's lines (`cart.lines` `{ [productId]: qty }`, products in catalogue order) and `discountOf(cart.discount)`.
  - Cart shape: `{ key, lines, buyer, order_id?, discount: null | { kind, input } }`.

- [ ] **Step 1: Write the failing tests** (`test/sale-totals.test.js`):
  - `discountOf` → `{ kind: 'montant', input: '5 000' }` → `{ kind: 'montant', value: 500000 }`; `{ kind: 'pourcentage', input: '10' }` → value `10`; input `''` → `null`; `'1,5'` in percent → `NaN` value; `null` → `null`.
  - `cartTotals : lot et remise` → coupe (lot) × 4 + Barreda × 1, discount `{ kind: 'pourcentage', input: '10' }` → `total 22950 * UM`.
  - `cartTotals : remise devenue trop forte` → one line of `100 * UM`, discount `{ kind: 'montant', input: '100' }` → `problem.code 'REMISE_TROP_FORTE'`.
  - `cartTotals : plafond` → capPct 10 with 20 % → `problem.code 'PLAFOND_REMISE'`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/sale-totals.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `saleTotals.js`.**

- [ ] **Step 4: Wire the screens.**
  - `SalePanel`: `capPct = me.role === 'gerant' ? settings.gerant_discount_cap_pct : null`; `totals = cartTotals(products, cart, capPct)`. Each line shows `line.price`; with `line.lot`, a small line under it: `prix par lot (3 pour 10 000 FCFA)`. Without `cart.discount`: « Total » as today, plus a `+ Remise` ghost button (hidden when `capPct === 0`) that sets `discount: { kind: 'pourcentage', input: '' }`. With it: « Sous-total », a row with `Segmented` (label « Type de remise », options `%` / currency label), the input, `−{money(totals.discount)}` and « Retirer » (sets `discount: null`); for the manager the help `10 % au maximum` (from `capPct`); then « Total ». A `totals.problem` while a discount is open shows its message in a warn `Notice` and disables the submit button. Every use of the old `total` (card part, credit availability, button labels) reads `totals.total`. The body adds `discount: discountOf(cart.discount)` when not null and `expected_total: totals.total`. `onRefused` already reloads the products after a refusal.
  - `Shop.jsx`: `emptyCart()` gets `discount: null`; the phone button shows `cartTotals(products, cart, capPct).total`.
  - `Settings.jsx` `RulesSection`: number field `gerant_discount_cap_pct` (min 0, max 99), label « Remise maximale du gérant (% du total) », help « 0 : le gérant ne fait pas de remise. L’administrateur et les associés n’ont pas de plafond. », saved with the others.

- [ ] **Step 5: Run the tests and the build**

Run: `node --test test/sale-totals.test.js && npm run build`
Expected: PASS, build without error.

- [ ] **Step 6: Commit**

```bash
git add src/components/shop/saleTotals.js src/components/shop/SalePanel.jsx src/pages/Shop.jsx src/pages/Settings.jsx src/*.css test/sale-totals.test.js
git commit -m "Écran Vente : prix par lot, remise et plafond du gérant" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ticket with subtotal and discount

**Files:**
- Modify: `worker/club.js` (`paymentDTO` ~2846, `publicTicket` ~3087)
- Modify: `shared/ticket.js` (`paymentLines`, new `paymentDiscount`, `ticketWhatsAppText`)
- Modify: `src/components/ui/TicketSheet.jsx`, `src/pages/Ticket.jsx` (WhatsApp text call ~53), `src/pages/PublicTicket.jsx` (`TicketView`)
- Test: `test/ticket-format.test.js` (new cases), `test/shop-discount.test.js` (one new test)

**Interfaces:**
- Consumes: `discountLabel` (Task 1); sale columns (Task 4).
- Produces:
  - `paymentDTO`: each allocation has `discount` (0 outside the Boutique); new `shop_discount_kind`, `shop_discount_value`.
  - `paymentLines(...)`: an allocation's line amount is `amount + (discount ?? 0)`.
  - `paymentDiscount(allocations) → number` (sum of `discount`).
  - `ticketWhatsAppText` new params `discount = 0`, `discountLabel = null`.
  - `publicTicket` returns `discount` and `discount_label` (`null` without a discount).

- [ ] **Step 1: Write the failing tests.**
  - `test/ticket-format.test.js`: `paymentLines : une ligne Boutique montre son prix avant remise` → an allocation `{ label: 'Coupe-cigare', quantity: 4, amount: 11700 * UM, discount: 1300 * UM }` gives amount `13000 * UM`; `paymentDiscount` of it is `1300 * UM`. `ticketWhatsAppText : sous-total et remise` → with `discount: 2550 * UM`, `discountLabel: 'Remise 10 %'`, `total: 22950 * UM`, the text has `Sous-total : ` + `money(25500 * UM)`, then `Remise 10 % : −` + `money(2550 * UM)`, before `TOTAL : `; with `discount: 0` the text is unchanged from today's expected text.
  - `test/shop-discount.test.js`: `ticket : remise sur le ticket et la page publique` → after a 10 % sale, `GET /api/payments/:id/ticket` → allocations carry `discount`, `shop_discount_kind 'pourcentage'`, `shop_discount_value 10`; `GET /api/tickets/:id/:code` (code from `payments.ticket_code`) → `discount 2550 * UM`, `discount_label 'Remise 10 %'`, line amounts before discount summing to `25500 * UM`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/ticket-format.test.js test/shop-discount.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the server and shared parts** (`c.discount` in both allocation queries; `discountLabel` from the sale's kind and value).

- [ ] **Step 4: Implement the screens.** `TicketSheet` and `PublicTicket`: when the discount is > 0, « Sous-total » (total + discount) and the label with `−` amount before « TOTAL » / « Total »; nothing new otherwise. `Ticket.jsx` passes `discount: paymentDiscount(ticket.allocations)` and `discountLabel` to `ticketWhatsAppText`.

- [ ] **Step 5: Run the tests and the build**

Run: `node --test test/ticket-format.test.js test/shop-discount.test.js && npm run build`
Expected: PASS, build without error.

- [ ] **Step 6: Commit**

```bash
git add worker/club.js shared/ticket.js src/components/ui/TicketSheet.jsx src/pages/Ticket.jsx src/pages/PublicTicket.jsx test/
git commit -m "Ticket : sous-total et remise" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Caisse › Boutique and the journal

**Files:**
- Modify: `worker/shop.js` (`shopSummary` ~229)
- Modify: `src/components/cash/ShopTab.jsx` (`SaleRow`, `Column`)
- Modify: `src/lib/audit.js` (`'boutique.vente'` detail ~194)
- Test: `test/shop-discount.test.js` (one new test)

**Interfaces:**
- Consumes: sale DTO `discount` (Task 4), `discountLabel` (Task 1).
- Produces: each `shopSummary` account gets `discounts` (sum of the period's sales' `discount`, cancelled sales left out).

- [ ] **Step 1: Write the failing test** `Caisse › Boutique : remises accordées, vente annulée exclue` → two discounted cigar sales today (10 % and 1 000 F), the second cancelled → `GET /api/shop/summary?from=today` as admin → `accounts.cigares.discounts` equals the first sale's `discount`; `accounts.alcool.discounts === 0`.

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/shop-discount.test.js`
Expected: FAIL (`discounts` undefined).

- [ ] **Step 3: Implement.** `shopSummary` sums `s.discount` of the listed sales without `cancelled_at`. `Column`: under « Par moyen de paiement », when `col.discounts > 0`, a `calc` row « Remises accordées » `−{money(col.discounts)}`. `SaleRow` meta: `remise −{money(sale.discount)}` when > 0. `audit.js` `'boutique.vente'`: append ` · ${discountLabel(d.remise.type, d.remise.valeur)} : −${money(d.remise.montant)}` when `d.remise`, and ` · prix par lot : ${d.prix_par_lot.join(', ')}` when it has names.

- [ ] **Step 4: Run the tests and the build**

Run: `node --test test/shop-discount.test.js && npm run build`
Expected: PASS, build without error.

- [ ] **Step 5: Commit**

```bash
git add worker/shop.js src/components/cash/ShopTab.jsx src/lib/audit.js test/shop-discount.test.js
git commit -m "Caisse › Boutique et journal : remises visibles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole check

**Files:** none new (fixes only, if a check fails).

- [ ] **Step 1: Run everything**

Run: `npm test && npm run build`
Expected: every test PASS, build without error.

- [ ] **Step 2: Check in the browser** (dev server from `.claude/launch.json`, a fresh local database): as administrator, set the coupe lot (3 / 10 000 / 3 000) and the cap (10 %); as the manager, sell 4 coupes + one cigar with 10 % → the panel shows « Sous-total », « Remise 10 % », the net total on « Encaisser »; the ticket shows the same; 11 % is blocked with the cap message; on a phone width (375 px) the remise row fits and the « Panier » button shows the net total; as administrator, Caisse › Boutique shows « Remises accordées ». Screenshot each.

- [ ] **Step 3: Final review** of the whole branch by a fresh reviewer against the spec, then fix what it finds (one commit per fix, message in French).
