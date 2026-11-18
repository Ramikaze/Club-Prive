# Bénéfice réel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy each product's cost price onto every sale, compute the real profit (sales − purchase cost − gifts) per caisse and per product, and show it in the catalogue, Trésorerie & Bilans and the bosses' cash page.

**Architecture:** One column `charges.unit_cost` (migration V30) filled at sale time and back-filled when a missing cost is entered. A new mixin `worker/profit.js` builds the report from four kinds of events (sale, undo of a sale, goods back to stock, gift and its cancellation), each on its own day, so a past period never changes. One React component file draws the Bilans card and the cash band.

**Tech Stack:** Cloudflare Worker + SQLite (Durable Object; `node:test` with `worker/db-node.js` locally), React + Vite.

**Spec:** `docs/superpowers/specs/2026-11-18-benefice-reel-design.md`

## Global Constraints

- Amounts are integers in hundredths (`UM = 100` in tests); `unit_cost` is per unit, same unit as `unit_price`.
- The manager (`gerant`) never receives `cost_price`, `unit_cost` or any profit figure; `/api/finance/profit` is `CLUB` (admin + associés).
- Associés see both caisses (`alcool`, `cigares`); no filter by rayon.
- A cost price changed later never rewrites a sale or gift that already had one; only `unit_cost IS NULL` rows are filled.
- Every undo (cancellation, refund, goods back, gift cancelled) counts on the day it happens, never on the sale's day.
- A line with an unknown cost is never counted at 0: it is reported apart (« sans prix de revient ») and the report is `complete: false`.
- UI copy in French, code comments in English, as in the rest of the code. No parallel agents (owner's economy mode); one final review.

## Review Focus

- A settlement cancelled on a credit sale (`refunds` row, charge back to `due`) must not undo the sale: only `status` `annulee` / `remboursee` undoes it. → test in Task 2.
- A Boutique sale cancelled whole on a later day (paid lines refunded with restock, unpaid lines annulled): sales and cost both come back on the cancel day. → test in Task 2.
- The same product sold before and after its cost is entered: earlier sales take the cost, later ones copy it; changing it again moves neither. → test in Task 1.
- The manager's product list and charge lists contain no `cost_price` / `unit_cost`. → test in Task 1.
- A period with no product sale returns zeros and `complete: true`, and the UI shows « Aucune vente de produit » instead of an empty table. → test in Task 2, check in Task 4.

---

### Task 1: Cost copied on each sale (V30, insert, back-fill)

**Files:**
- Modify: `worker/schema.js` (new `V30`, add to `MIGRATIONS`)
- Modify: `worker/club.js` (`insertCharge` ~2704, `updateProduct` ~3243)
- Test: `test/profit.test.js` (new)

**Interfaces:**
- Produces: column `charges.unit_cost INTEGER NULL` (per unit, hundredths); filled for `kind = 'produit'` only.

- [ ] **Step 1: Write the failing tests** in `test/profit.test.js` (setup like `test/gifts.test.js`: `Server`, users `admin`, `ger` (gerant), `cig` (associé cigares), `cha` (associé alcool); products `CHP` bouteille price 50 000 cost 30 000, `DRK` boisson price 20 000 no cost, `CIG` cigare price 10 000 cost 4 000, each with stock 50; `fundCaisse` both caisses so refunds pass). A sale is `POST /api/shop/sales { account, buyer: { kind: 'journalier' }, lines: [{ product_id, quantity }], method: 'Espèces' }`; read its charge with `server.club.get('SELECT * FROM charges WHERE shop_sale_id = ?', r.sale.id)`.

```js
test('V30 : les ventes passées prennent le prix de revient actuel', () => {
  // db at V29 (run MIGRATIONS.slice(0, 29) the way migrate() does, meta schema_version = '29'),
  // one product cost_price 3000000 and one charge kind 'produit' on it, one 'abonnement' charge; then migrate(db).
  assert.equal(productCharge.unit_cost, 3000000);
  assert.equal(subscriptionCharge.unit_cost, null);
});
test('le prix de revient est copié sur la vente', async () => {
  // sale CHP ×2
  assert.equal(charge.unit_cost, 30000 * UM);
});
test('prix saisi plus tard : les ventes et offerts sans prix le prennent, les autres non', async () => {
  // sale DRK ×1 → unit_cost null; cha offers DRK ×1 → gifts.unit_cost null
  // admin PUT /api/products/DRK { cost_price: 12000 * UM } → both 12000 * UM
  // admin PUT again { cost_price: 15000 * UM } → both still 12000 * UM; a new DRK sale → 15000 * UM
});
test('le gérant ne reçoit jamais le prix de revient', async () => {
  const list = ok(await ger.get('/api/products'));
  assert.ok(list.every((p) => !('cost_price' in p) && !('unit_cost' in p)));
  // and the sale's reservation / ticket lines read by ger carry no unit_cost
});
```

- [ ] **Step 2: Run** `node --test test/profit.test.js` — Expected: FAIL (no column `unit_cost`).

- [ ] **Step 3: Implement**
  - `V30 = ['ALTER TABLE charges ADD COLUMN unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0)', "UPDATE charges SET unit_cost = (SELECT cost_price FROM products p WHERE p.id = charges.product_id) WHERE kind = 'produit' AND product_id IS NOT NULL"]`, with a comment naming the spec.
  - `insertCharge`: add `unit_cost` to the column list, value `(SELECT cost_price FROM products WHERE id = ?)` bound to `c.kind === 'produit' ? c.product_id : null`.
  - `updateProduct`: after the `UPDATE products`, when `f.cost !== null`, run `UPDATE charges SET unit_cost = ? WHERE product_id = ? AND kind = 'produit' AND unit_cost IS NULL` and `UPDATE gifts SET unit_cost = ? WHERE product_id = ? AND unit_cost IS NULL`; put the two `changes` counts in the existing audit details as `prix_de_revient_rempli: { ventes, offerts }`.

- [ ] **Step 4: Run** `node --test test/profit.test.js` then `npm test` — Expected: all PASS.

- [ ] **Step 5: Commit** `git add worker/schema.js worker/club.js test/profit.test.js && git commit -m "Prix de revient copié sur chaque vente (V30)"`

### Task 2: Profit report (`GET /api/finance/profit`)

**Files:**
- Create: `worker/profit.js` (`export const profitMethods = { profitReport(from, to) }`)
- Modify: `worker/club.js` (import + `Object.assign(Club.prototype, profitMethods)` next to the others ~3935)
- Modify: `worker/api.js` (route next to `/api/finance/billed`)
- Test: `test/profit.test.js`

**Interfaces:**
- Consumes: `charges.unit_cost` (Task 1), `this.periodBounds(from, to)` → `[startIso, endIso)`, `ACCOUNT_LABELS`.
- Produces: `profitReport(from, to)` → `{ from, to, complete, accounts: [Figures & { account, label }] (alcool, cigares), total: Figures, products: [{ product_id, name, reference, category, account, quantity, sales, cost, gifts_quantity, gifts_cost, profit, margin, cost_missing }] }` where `Figures = { sales, cost, gifts_cost, profit, missing: { sales_count, sales_amount, gifts_count } }`; `profit = sales − cost − gifts_cost`; `margin = sales > 0 ? profit / sales : null`; `complete` = no missing anywhere. Route: `add('GET', '/api/finance/profit', CLUB, (ctx) => club.profitReport(ctx.query.from, ctx.query.to ?? ctx.query.from))`.

The events, each counted only when its date is in the period (spec §3); rows with `unit_cost IS NULL` go to `missing` instead of `sales`/`cost`:

| Event | Date | Effect |
|---|---|---|
| sale: `charges` `kind = 'produit'` | `created_at` | `+amount` sales, `+quantity×unit_cost` cost, `+quantity` |
| sale undone: `status = 'annulee'` | `cancelled_at` | `−amount`, `−quantity` |
| sale undone: `status = 'remboursee'` | `MAX(refunds.created_at)` of that charge | `−amount`, `−quantity` |
| goods back: `stock_movements` kind `annulation_vente` / `retour` with `charge_id` | `created_at` | `−ABS(quantity)×unit_cost` cost |
| gift: `gifts` | `biz_date` (day) | `+quantity×unit_cost` gifts_cost, `+quantity` gifts_quantity |
| gift cancelled | `cancelled_at` | the opposite |

- [ ] **Step 1: Write the failing tests** (values from Task 1's products; set the clock with `server.club.at = noon(day)` as in `test/day-verification.test.js`, `null` to release):

```js
test('bénéfice du jour : ventes − prix d’achat − offerts, par caisse', async () => {
  // CHP ×2 and CIG ×3 sold paid; cig offers CIG ×1
  // alcool  { sales: 100000*UM, cost: 60000*UM, gifts_cost: 0,        profit: 40000*UM }
  // cigares { sales: 30000*UM,  cost: 12000*UM, gifts_cost: 4000*UM,  profit: 14000*UM }
  // total.profit 54000*UM, complete true; products CIG { quantity: 3, gifts_quantity: 1, margin: 14000/30000 }
});
test('vente sans prix de revient : hors bénéfice, signalée, puis comptée quand le prix est saisi', async () => {
  // DRK ×1 → total unchanged, total.missing { sales_count: 1, sales_amount: 20000*UM, gifts_count: 0 }, complete false
  // admin sets DRK cost 12000*UM → alcool sales +20000*UM, cost +12000*UM, complete true
});
test('remboursement un autre jour : compté ce jour-là, le jour de la vente ne bouge pas', async () => {
  // day D: CHP ×1 sold paid. day D+1: refund without restock (POST /api/charges/:id/refund { reason, method, restock: false })
  // report(D).total.profit === 20000*UM (unchanged); report(D+1): sales −50000*UM, cost 0, profit −50000*UM
  // same with restock: true on another CHP line → report(D+1) cost −30000*UM, profit −20000*UM
});
test('vente Boutique annulée le lendemain : ventes et prix d’achat reviennent ce jour-là', async () => {
  // day D: CIG ×2 sold paid; D+1: POST /api/shop/sales/:id/cancel → report(D+1) { sales: −20000*UM, cost: −8000*UM }
  // a sale cancelled the same day nets to 0 on that day
});
test('annuler un règlement à crédit ne défait pas la vente', async () => {
  // client with limit, credit sale CHP ×1, settlement, settlement cancelled the next day → report(next day) all zero
});
test('prix de revient changé après la vente : la vente garde le sien', async () => {
  // CIG sold at cost 4000*UM; admin sets 6000*UM; same day report cost stays 4000*UM for that line
});
test('période sans vente de produit : zéros, complète', async () => { /* total all 0, products [], complete true */ });
test('droits : le gérant est refusé, un associé voit les deux caisses', async () => {
  // ger → 403; cig → accounts has alcool and cigares
});
```

- [ ] **Step 2: Run** `node --test test/profit.test.js` — Expected: FAIL (404 on `/api/finance/profit`).
- [ ] **Step 3: Implement** `profitReport` in `worker/profit.js` (one query per event kind, folded into per-account and per-product maps; product rows sorted by `profit` descending) and the route.
- [ ] **Step 4: Run** `node --test test/profit.test.js` then `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `git add worker/profit.js worker/club.js worker/api.js test/profit.test.js && git commit -m "Bénéfice réel : GET /api/finance/profit"`

### Task 3: Catalogue — « Prix de revient » column and missing filter

**Files:**
- Modify: `src/pages/Products.jsx` (list ~470-520, form ~145)

**Interfaces:**
- Consumes: `p.cost_price` (present only for bosses: test `'cost_price' in p`).
- Produces: query param `revient=manquant` on `/produits` filters on products with `cost_price === null` (used by Task 4's link).

- [ ] **Step 1: Implement**
  - Bosses only: sortable column « Prix de revient » after « Prix » (`cost: (p) => p.cost_price ?? -1`), cell `money(p.cost_price)` or `<span className="chip chip-warn">à renseigner</span>`; `data-label="Prix de revient"`, `num nowrap`.
  - Above the table, when some active listed product lacks it: a button-styled chip « N produit(s) sans prix de revient » toggling `revient=manquant` through the existing `setQuery` (keep `cat` and `inactifs`); when on, the list shows only those and the chip reads « Tous les produits ».
  - Form: the field's help line « Nécessaire pour calculer le bénéfice réel. Laissez vide s’il n’est pas encore connu. »
- [ ] **Step 2: Verify** `npm run build` passes; in the browser preview (admin demo account from `worker/seed.js`), the column shows and the filter works; as `gerant` the column is absent.
- [ ] **Step 3: Commit** `git add src/pages/Products.jsx && git commit -m "Catalogue : colonne « Prix de revient » et filtre des prix manquants"`

### Task 4: Bilans card and cash band

**Files:**
- Create: `src/components/cash/ProfitBlock.jsx` (`export function ProfitCard({ report })`, `export function ProfitBand({ report, oneDay })`)
- Modify: `src/pages/Treasury.jsx` (load + card after « Résultat de la période » row)
- Modify: `src/pages/Cash.jsx` (`AdminCash` only: load + pass to `CategoryColumns`)
- Modify: `src/components/cash/CategoryColumns.jsx` (new optional prop `footer`, drawn at the end of the section when `!method`)

**Interfaces:**
- Consumes: Task 2's response; Task 3's `/produits?revient=manquant`.

- [ ] **Step 1: Implement**
  - Loading: `api.get(`/api/finance/profit${qs({ from, to })}`, { signal }).catch(() => null)` beside the existing calls; `null` hides the card / band (a failure never takes the page down).
  - `ProfitCard` (spec §5 sketch): title « Bénéfice réel des produits », chip « incomplet » when `!complete`; table Ventes / Prix d’achat / Offerts / Bénéfice for « Champagne et autres boissons », « Cigare », « Total »; the missing sentence « N vente(s) (X) sans prix de revient ne sont pas comptées » (+ « N offert(s) sans prix de revient ») with a link « Voir les produits à compléter » to `/produits?revient=manquant`; a sortable product table (`Sorted`) Produit / Qté / Ventes / Prix d’achat / Offerts / Bénéfice / Marge (`margin` as a whole percent, « — » when null); « Aucune vente de produit sur la période. » when `products` is empty; under it, subtle: « Ne s’additionne pas au résultat de la période : les achats aux fournisseurs y sont déjà des dépenses. »
  - `ProfitBand`: one line « Bénéfice réel du jour » (« de la période » when `!oneDay`): « Champagne et autres boissons X · Cigare Y · Offerts −Z · Total T », the missing sentence when incomplete, and a link « Détail dans Bilans » to `/tresorerie?from=…&to=…`.
  - `AdminCash` passes `footer={profit && <ProfitBand report={profit} oneDay={oneDay} />}`; `ManagerCash` is untouched (no call, no band).
- [ ] **Step 2: Verify** `npm run build`; in the browser preview as admin: band under the columns on /caisse, card on /tresorerie, links work, numbers match a sale made in the preview; as `gerant`: no band, and no request to `/api/finance/profit` in the network log.
- [ ] **Step 3: Commit** `git add src/components/cash/ProfitBlock.jsx src/pages/Treasury.jsx src/pages/Cash.jsx src/components/cash/CategoryColumns.jsx && git commit -m "Bénéfice réel dans Bilans et sur la caisse"`

### Task 5: Whole-branch check

- [ ] **Step 1:** `npm test` and `npm run build` — Expected: all pass.
- [ ] **Step 2:** One fresh reviewer on the whole branch against the spec (economy mode: the only review).
- [ ] **Step 3:** Fix what it confirms, re-run Step 1, commit.
