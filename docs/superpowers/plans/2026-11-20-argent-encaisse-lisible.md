# Argent encaissé lisible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le bloc « Argent encaissé » montre d'abord ses groupes fermés et leurs totaux, les annulations à part, des lignes courtes ; le bloc « Dépenses » suit les mêmes règles de lignes et d'annulations.

**Architecture:** Le classement des lignes (groupe, annulation, payé par carte, montant compté) sort de `ReceiptsBlock.jsx` vers un module pur `receiptGroups.js`, testé sous `node:test` comme `flows.js`. Les blocs JSX ne font plus que l'affichage. La croix d'annulation et la couleur des montants se règlent dans `CashRow.jsx` et `club.css`.

**Tech Stack:** React 18, react-router 6, lucide-react (`Icon`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-20-argent-encaisse-lisible-design.md`

## Global Constraints

- Textes exacts : `1 annulation · non comptée`, `N annulations · non comptées`, info-bulle et nom accessible de la croix `Annuler l’opération` (+ ` : <libellé>` pour le lecteur d'écran).
- Aucun montant, total ni droit ne change : la somme des groupes reste `receiptSummary(...).total`.
- `src/components/cash/receiptGroups.js` n'importe rien qui touche au store (`when.js`, `format.js` interdits) : il doit tourner sous `node --test`.

## Review Focus

- Une recharge ou une livraison repas annulée **après** la fin de la période reste dans son groupe (elle compte encore) ; annulée **dans** la période, elle part dans les annulations.
- Un groupe dont toutes les lignes sont annulées disparaît (pas de « Entrées diverses (0) »).
- Une vente payée entièrement par carte membre reste dans « Payé par carte membre, non compté », jamais dans les annulations.
- Un rayon Boutique à 0 n'est pas affiché ; si les deux sont à 0 (vente puis remboursement), la petite ligne n'apparaît pas.
- Le gérant (`isAdmin={false}`) ne voit aucune croix ; une opération d'un mois clôturé non plus.

---

### Task 1: Classement pur des lignes (`receiptGroups.js`)

**Files:** Create `src/components/cash/receiptGroups.js` · Modify `src/components/cash/ReceiptsBlock.jsx` (retirer `GROUPS`, `natureOf`, `countedOf`) · Test `test/receipt-groups.test.js`

**Interfaces:**
- Produces `RECEIPT_GROUPS: [nature, label][]` (la liste actuelle `GROUPS`, même ordre).
- Produces `isCancelledRow(row, to, dayOf) -> boolean` : entrée `status !== 'active'`, ou paiement `recharge`/`repas` avec `cancelledBy(p, to, dayOf)` et `cashOf(p) > 0` (la règle barrée d'aujourd'hui).
- Produces `splitReceipts(rows, to, dayOf) -> { groups: {nature, label, list, amount}[], cancelled: row[], byCard: row[] }`. `rows` = lignes `{ type: 'payment'|'refund'|'entry', key, ms, p|r|e }` déjà triées. Ordre : annulation d'abord, puis carte (`natureOf === 'card'`), puis groupe. Groupes vides retirés.
- Produces `shopRayons(group) -> { account, amount }[]` : montants par rayon (`p.shop_account` ou `r.account`), rayons à 0 retirés, dans l'ordre de `RAYONS`.

- [ ] **Step 1: Écrire les tests** (`test/receipt-groups.test.js`, objets synthétiques, `dayOf = (iso) => iso.slice(0, 10)`, `to = '2026-11-18'`) :
  - `annulation d'une entrée diverse` : entrée `{kind:'recette', status:'cancelled', amount:100}` + entrée active 597 500 → `cancelled.length === 1`, groupe `entree` avec `list.length === 1` et `amount === 597500`.
  - `groupe vide retiré` : seule une entrée annulée → `groups` ne contient pas `entree`.
  - `recharge annulée dans / après la période` : `cancelled_at: '2026-11-18T…'` → dans `cancelled` ; `cancelled_at: '2026-11-19T…'` → dans le groupe `recharge`.
  - `vente payée par carte` : `amount === card_amount` → dans `byCard`, pas dans `cancelled`.
  - `somme des groupes = receiptSummary` : un jeu mêlant vente, Boutique, remboursement, entrée annulée → `Σ groups.amount === receiptSummary(journal, entries, { to, dayOf }).total`.
  - `shopRayons` : vente cigares 241 500 seule → `[{ account: 'cigares', amount: 241500 }]` ; vente 10 000 puis remboursement 10 000 du même rayon → `[]`.
- [ ] **Step 2:** `node --test test/receipt-groups.test.js` → FAIL (module absent).
- [ ] **Step 3:** Écrire le module ; `ReceiptsBlock.jsx` l'importe à la place de ses copies locales.
- [ ] **Step 4:** `node --test test/receipt-groups.test.js test/cash-flows.test.js test/cash-categories.test.js` → PASS.

### Task 2: Ligne courte et croix d'annulation (`CashRow.jsx`, `club.css`)

**Files:** Modify `src/components/cash/CashRow.jsx`, `src/club.css` (zone `.cash-row` ~l.1249-1272)

**Interfaces:**
- `EntryCancel` rend `<button type="button" className="icon-btn cash-cancel" title="Annuler l’opération" aria-label={`Annuler l’opération : ${e.label}`}>` avec `<Icon name="x" />` (mêmes conditions de rendu qu'aujourd'hui).
- `CashRow` : `.cash-row-end` passe en ligne (montant puis croix), aligné en haut.
- CSS : `.cash-block-plain .cash-row .cash-amount:not(.is-quiet) { color: var(--text); font-weight: 500; }` ; `.cash-cancel` 28 px, icône 16 px, couleur `var(--text-3)`.

- [ ] **Step 1:** Modifier `EntryCancel`, `CashRow`, le CSS.
- [ ] **Step 2:** `npm run build` → sans erreur.

### Task 3: Bloc « Argent encaissé » (`ReceiptsBlock.jsx`)

**Files:** Modify `src/components/cash/ReceiptsBlock.jsx`, `src/club.css`

**Interfaces:** Consumes `splitReceipts`, `shopRayons`, `RECEIPT_GROUPS` (Task 1) ; `EntryCancel` (Task 2).

- [ ] **Step 1:** Section : classe `cash-block cash-block-plain`. Groupes : `<details>` **sans** `open`.
- [ ] **Step 2:** Titres de paiement et de remboursement = `<Link>` vers le ticket (`/caisse/ticket/${p.id}`, ou `r.payment_id`) ; retirer `ticketLink` de la ligne grise. Boutique : rayon en texte simple (`RAYON_LABEL[account]`), plus de puce `Boutique …`. Entrée : retirer `'Entrée diverse'` de la ligne grise ; garder `par <nom>`.
- [ ] **Step 3:** Boutique (si `shopSplit`) : `<p className="subtle cash-group-sub">` avec `shopRayons(g)` joints par ` · ` (`Cigares 241 500 FCFA`), rien si vide ; supprimer le `<dl className="calc cash-shop-split">`.
- [ ] **Step 4:** Après `TotalLine` : `<details className="cash-group cash-group-cancelled">` si `cancelled.length`, résumé au texte exact des Global Constraints, puis les lignes (barrées, avec la note du motif) ; puis le bloc carte inchangé.
- [ ] **Step 5:** CSS : `.cash-group-sub { margin: 0 0 6px 16px; font-size: 0.85rem; }` ; `.cash-group-cancelled` = même cadre pointillé que `.cash-group-card`.

### Task 4: Bloc « Dépenses » (`ExpensesBlock.jsx`)

**Files:** Modify `src/components/cash/ExpensesBlock.jsx`

- [ ] **Step 1:** Section `cash-block cash-block-plain`. « Détail (n) » liste les dépenses actives seulement ; après « Total des dépenses », le même `<details className="cash-group cash-group-cancelled">` pour les annulées (même texte, même rendu).
- [ ] **Step 2:** `npm test` (tout) et `npm run build` → PASS.

### Task 5: Contrôle et commit

- [ ] **Step 1:** Navigateur (`club-cloudflare-local`), page Caisse en administrateur et en gérant, à 375 px et sur ordinateur : groupes fermés, total lisible, annulations repliées, croix seulement chez l'administrateur, liens des titres vers le ticket.
- [ ] **Step 2:** Avec l'accord du propriétaire : commit de la conception, du plan et du code ; PR.
