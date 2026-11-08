# Vérification de la caisse journalière — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A day's money enters the caisses' balance in « Soldes » only once the day is closed (gérant) and then verified (associé or admin); each caisse shows its validated balance, « +X en attente », and the till tile shows « En tout ».

**Architecture:** `day_closings` gains `verified_at` / `verified_by`. The server splits each caisse into validated + pending: pending = the sum of the caisse figures over the unverified days that have money, validated = everything − pending. Profits and expenses may only spend `validé + min(0, en attente)`. The front shows the split on the existing tiles, a « journées à vérifier » band under them with a verify dialog, a status on the closing bar and an alert on Accueil.

**Tech Stack:** Cloudflare Worker + Durable Object on SQLite (`worker/`), React 18 + Vite (`src/`), tests with `node --test` on `node:sqlite` through `test/harness.js`.

**Spec:** `docs/superpowers/specs/2026-11-08-verification-caisse-design.md` (validated by the owner 2026-11-08, « (mon choix) » points included).

## Global Constraints

- Amounts are integers in hundredths (`UM = 100` in tests); never floats.
- All user-facing text in French, with French typography (« », `’`), as the code already does.
- « Validé + en attente = le solde d'aujourd'hui, à l'unité » for every caisse.
- Days before the start day (meta `day_verification_since`, set once at first boot to `bizToday()`) count as verified.
- Days are validated in date order, the oldest first; a day without any money movement is never pending.
- Only profits (`takeProfits`) and expenses (`createEntry` kind `depense`, supplier payments included) use « disponible » `= validé + min(0, en attente)`. Every other `assertCaisseCovers` caller keeps the full balance (`validé + en attente`).
- Verify and reopen: administrators and associés only (`CLUB` routes). The gérant gets nothing new.
- Trésorerie, Grand livre, Clôture mensuelle, exports: unchanged.
- Migration is V23, appended after V22 in `MIGRATIONS` (`worker/schema.js:885`); check `origin/main` has no V23 before starting.
- Commit messages in French, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Business-day boundary:** a payment made after midnight but before the business day starts belongs to the previous day; `dayHasMoney` must use `dayStartIso` bounds (`worker/ledger.js:48`), not the calendar date of `paid_at`. Test in Task 2.
2. **Reopening a verified day:** its money goes back to « en attente », `verified_through` moves back, and the day can be closed and verified again. Test in Task 3.
3. **Gérant expense against unverified money:** the till holds today's sales, but Réservation de séance has 0 validated → the gérant's expense is refused with CAISSE_INSUFFISANTE (the money is pending). Test in Task 2.
4. **Club not started** (no cash fund, `started: false`): `/api/caisses` answers with `pending_days: []`, no crash, tiles unchanged. Test in Task 2.
5. **Shortage at closing with no validated money:** `recordCashGap` still uses the full balance, so the day can always be closed. Test in Task 2.

---

## File Structure

- `worker/schema.js` — V23 (two columns on `day_closings`).
- `worker/club.js` — boot meta `day_verification_since`; dashboard `days_to_verify`.
- `worker/caisses.js` — `caisseSums`, `dayHasMoney`, `pendingDays`, split in `caisseBalances`, `assertCaisseCovers` option.
- `worker/ledger.js` — `verifyDay`, `dayClosing` gains `verified` and `net`, `createEntry` uses « disponible ».
- `worker/api.js` — route `POST /api/day-closing/:day/verify`.
- `src/components/cash/caisses.js` — tiles carry `pending` / `total`.
- `src/components/cash/CaissesBalance.jsx` — render the split and the band.
- `src/components/cash/VerifyDays.jsx` (new) — band « journées à vérifier » + `VerifyDayDialog`.
- `src/components/cash/CloseDay.jsx` — export `closeDayDialog`; bar shows verification status.
- `src/pages/Dashboard.jsx` — alert row.
- `test/harness.js` — `dayVerification` option.
- `test/day-verification.test.js` (new), `test/caisses-tiles.test.js` (extend).
- `README.md` — one paragraph under « Caisse ».

---

### Task 1: Schema, start day, test harness

**Files:**
- Modify: `worker/schema.js` (add `V23` before `MIGRATIONS`, append it to `MIGRATIONS`)
- Modify: `worker/club.js:252` (boot, next to `renewals_since`)
- Modify: `test/harness.js` (`Server` constructor options and `start()`)
- Test: `test/day-verification.test.js` (new)

**Interfaces:**
- Produces: columns `day_closings.verified_at TEXT` (ISO), `day_closings.verified_by INTEGER REFERENCES users(id)`; meta key `day_verification_since` (a `YYYY-MM-DD` business day); `new Server(env, { dayVerification: true })` keeps the real start day, any other test server gets `'9999-12-31'` (every day verified: old behaviour, legacy tests unchanged).

- [ ] **Step 1: Write the failing test** in `test/day-verification.test.js` with `const server = new Server({}, { lenientTariffs: true, dayVerification: true });`, an admin, an associé `cigares`, a gérant (same `before` pattern as `test/caisses-retrait.test.js`):

```js
test('V23 : la fermeture porte la vérification, et le jour de mise en service est noté', () => {
  const cols = server.club.all('PRAGMA table_info(day_closings)').map((c) => c.name);
  assert.ok(cols.includes('verified_at') && cols.includes('verified_by'));
  assert.equal(server.club.get("SELECT value FROM meta WHERE key = 'day_verification_since'").value, today);
});
```

- [ ] **Step 2: Run** `node --test test/day-verification.test.js` — Expected: FAIL (missing columns).
- [ ] **Step 3: Implement** V23 (`ALTER TABLE day_closings ADD COLUMN verified_at TEXT`, `ALTER TABLE day_closings ADD COLUMN verified_by INTEGER REFERENCES users(id)`), with a comment citing the spec; boot line `this.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('day_verification_since', ?)", this.bizToday());`; harness: unless `dayVerification`, after `api.init()` on the first start, `UPDATE meta SET value = '9999-12-31' WHERE key = 'day_verification_since'`.
- [ ] **Step 4: Run** `node --test test/day-verification.test.js` then `npm test` — Expected: PASS, 503 + 1 tests.
- [ ] **Step 5: Commit** `git add worker/schema.js worker/club.js test/harness.js test/day-verification.test.js && git commit` — « Vérification de caisse : V23 et jour de mise en service ».

### Task 2: Validated / pending split and « disponible »

**Files:**
- Modify: `worker/caisses.js:28-92` (`caisseBalances`), `:129-148` (`assertCaisseCovers`), `:113` (`takeProfits` call)
- Modify: `worker/ledger.js:269` (`createEntry` expense call)
- Test: `test/day-verification.test.js`

**Interfaces:**
- Produces (on `caisseMethods`, `this` = Club):
  - `caisseSums(from: string, to: string) -> { reservations, alcool, cigares }` — today's per-caisse computation (same fields as `emptyCaisses()`, `balance` and `halves` set) for business days `from..to` inclusive.
  - `dayHasMoney(day: string) -> boolean` — a payment with `paid_at` in `[dayStartIso(day), dayStartIso(addDays(day, 1)))`, a refund with `created_at` in that range, or an active `ledger_entries` row with `biz_date = day` and `kind <> 'transfert'`.
  - `pendingDays(to = bizToday()) -> Array<{ day, closed: boolean, closed_at: string|null, closed_by_name: string|null }>` — days from `max(day_verification_since, fund date)` to `to`, oldest first, that have money and no `day_closings` row with `verified_at` set.
  - `caisseBalances(to)` keeps today's fields and: each `caisses[k]` holds the **validated** figures (every numeric field = all − pending; `balance` validated; `halves` from the validated balance) plus `pending: number` (net pending); top level `pending_days: Array<{ ...pendingDays item, net: { reservations, alcool, cigares }, total: number }>`, `pending_total: number` (sum of the three caisses' pending), `till_validated: number` (`till − pending_total`), `verified_through: string` (day before the oldest pending day, else `to`). `till` keeps its meaning (« En tout »). When `started` is false: `pending_days: []`, `pending_total: 0`, `till_validated: 0`, `verified_through: to`.
  - `assertCaisseCovers(account, amount, what, actor = null, { available = false } = {})` — limit = `validated + min(0, pending)` when `available`, else `validated + pending`. The message names the limit; with `available`: `… la caisse « X » ne peut payer que Y : l’argent en attente de vérification ne se dépense pas.`

- [ ] **Step 1: Write the failing tests** in `test/day-verification.test.js`. Set the clock with `server.club.at` (as `test/day-closing.test.js` does): cash fund two days ago; a cigar sale of 100 000 yesterday, closed by the gérant; today a cigar sale of 50 000.

```js
test('le solde validé exclut les journées non vérifiées ; validé + en attente = total', async () => {
  const b = ok(await admin.get('/api/caisses'));
  assert.equal(b.caisses.cigares.balance, 0);
  assert.equal(b.caisses.cigares.pending, 150000 * UM);
  assert.equal(b.pending_total, 150000 * UM);
  assert.equal(b.till_validated + b.pending_total, b.till);
  assert.deepEqual(b.pending_days.map((d) => [d.day, d.closed]), [[yesterday, true], [today, false]]);
  assert.equal(b.verified_through, addDays(yesterday, -1));
});
test('un paiement après minuit, avant le début du jour d’activité, compte pour la veille', ...);  // Review Focus 1
test('prendre des bénéfices sur de l’argent en attente est refusé (CAISSE_INSUFFISANTE)', ...);
test('une dépense du gérant sur de l’argent en attente est refusée', ...);                       // Review Focus 3
test('un manque de caisse à la fermeture passe sur le solde complet', ...);                     // Review Focus 5
test('sans fond de caisse : pending_days vide, rien ne casse', ...);                             // Review Focus 4 (fresh Server)
test('les journées avant la mise en service comptent comme vérifiées', ...);                     // since after the movement day
```

Each `...` test asserts the exact status / code (`409`, `CAISSE_INSUFFISANTE`) or the figures its title names.

- [ ] **Step 2: Run** `node --test test/day-verification.test.js` — Expected: FAIL (`pending` undefined).
- [ ] **Step 3: Implement** `caisseSums` by moving the three SQL loops and the balance lines out of `caisseBalances` unchanged; `caisseBalances` = `caisseSums(from, to)` minus the field-by-field sum of `caisseSums(d, d)` over `pendingDays(to)`. Read the verified days once (`SELECT biz_day FROM day_closings WHERE verified_at IS NOT NULL`) and walk the days with `addDays`. Switch `takeProfits` (`worker/caisses.js:113`) and the expense check (`worker/ledger.js:269`) to `{ available: true }`; leave the five other callers as they are.
- [ ] **Step 4: Run** `node --test test/day-verification.test.js` then `npm test` — Expected: all PASS (legacy tests keep every day verified through the harness).
- [ ] **Step 5: Commit** — « Vérification de caisse : soldes validés, argent en attente et disponible ».

### Task 3: Verify a day, reopen, closing details

**Files:**
- Modify: `worker/ledger.js:507-565` (`dayClosing`, new `verifyDay` after `closeDay`, `reopenDay` audit)
- Modify: `worker/api.js:386` (new route after reopen)
- Test: `test/day-verification.test.js`

**Interfaces:**
- Consumes: `pendingDays`, `caisseSums` (Task 2).
- Produces:
  - `POST /api/day-closing/:day/verify` (`CLUB`) → `verifyDay(actor, day)` returns `dayClosing(day)`. Errors: `403` for the gérant (route); `409 NON_FERMEE` « La caisse de cette journée n’est pas encore fermée. »; `409 DEJA_VERIFIEE` « La caisse de cette journée est déjà vérifiée. »; `409 JOURNEE_PRECEDENTE` « Vérifiez d’abord la caisse du JJ/MM/AAAA. » when `pendingDays(day)` holds an earlier day. Sets `verified_at = nowIso()`, `verified_by = actor.id`; audit `caisse.verifier` with `{ jour, net: { reservations, alcool, cigares } }`.
  - `dayClosing(day)` adds `net: { reservations, alcool, cigares }` (`caisseSums(day, day)` balances) and, inside `closed`, `verified: { verified_at, verified_by_name } | null`.
  - `reopenDay` unchanged in behaviour (deleting the row erases the verification); its audit gains `verifiee_le: row.verified_at`.

- [ ] **Step 1: Write the failing tests:**

```js
test('le gérant ne peut pas vérifier (403)', ...);
test('une journée ouverte ne se vérifie pas (NON_FERMEE)', ...);
test('les journées se vérifient dans l’ordre (JOURNEE_PRECEDENTE)', ...);
test('vérifier fait passer l’argent dans le solde validé, tracé dans le journal', async () => {
  ok(await cig.post(`/api/day-closing/${yesterday}/verify`, {}));
  const b = ok(await admin.get('/api/caisses'));
  assert.equal(b.caisses.cigares.balance, 100000 * UM);
  assert.equal(b.caisses.cigares.pending, 50000 * UM);
  assert.equal(b.verified_through, yesterday);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'caisse.verifier'"));
});
test('rouvrir une journée vérifiée remet son argent en attente', ...);                          // Review Focus 2
```

- [ ] **Step 2: Run** `node --test test/day-verification.test.js` — Expected: FAIL (404 on the route).
- [ ] **Step 3: Implement** `verifyDay` and the route; extend `dayClosing` and the reopen audit as above.
- [ ] **Step 4: Run** `node --test test/day-verification.test.js` then `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — « Vérification de caisse : valider une journée ».

### Task 4: Tiles show validated, « en attente » and « En tout »

**Files:**
- Modify: `src/components/cash/caisses.js` (`caisseTiles`)
- Modify: `src/components/cash/CaissesBalance.jsx`
- Modify: `src/club.css` (next to the `.caisse-tile` rules)
- Test: `test/caisses-tiles.test.js`

**Interfaces:**
- Consumes: `/api/caisses` fields from Task 2.
- Produces: each tile from `caisseTiles` gains `pending: number` (0 on Fond de caisse and cartes); the `caisse` (till) tile has `value = b.till_validated`, `pending = b.pending_total`, `total = b.till` and, when `pending !== 0`, its first hint is `validé au ${fmt.day(b.verified_through)}` instead of `end`.

- [ ] **Step 1: Write the failing test** in `test/caisses-tiles.test.js`: with a `b` whose `caisses.cigares` has `balance: 640000, pending: 90000`, `till: 3890000`, `till_validated: 3490000`, `pending_total: 400000`, `verified_through: '2026-11-07'`: the Cigare tile has `value 640000, pending 90000`; the till tile has `value 3490000, pending 400000, total 3890000` and the hint `validé au …`; with `pending_total: 0`, the till tile has `pending 0` and the hint `à ce jour`.
- [ ] **Step 2: Run** `node --test test/caisses-tiles.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** in `caisseTiles`; render in `CaissesBalance.jsx` under `.value`: when `t.pending !== 0`, `<div className="caisse-pending">{t.pending > 0 ? '+' : '−'}{bare(Math.abs(t.pending))} en attente</div>`; on the till tile, when `t.pending !== 0`, a rule then a row « En tout » / `money(t.total)`. `.caisse-pending`: the gold already used on the dark tile, `font-weight: 600`, `white-space: nowrap`.
- [ ] **Step 4: Run** `node --test test/caisses-tiles.test.js`, `npm test`, `npm run build` — Expected: PASS, build OK.
- [ ] **Step 5: Commit** — « Vérification de caisse : l’argent en attente sur les tuiles ».

### Task 5: Band « journées à vérifier », verify dialog, closing bar

**Files:**
- Create: `src/components/cash/VerifyDays.jsx`
- Modify: `src/components/cash/CloseDay.jsx` (export `closeDayDialog`; `DayClosingBar` status)
- Modify: `src/components/cash/CaissesBalance.jsx` (render the band), `src/pages/Cash.jsx:151-153` (pass `onChange={state.reload}`)

**Interfaces:**
- Consumes: `pending_days`, routes from Task 3, `CloseDayDialog` (existing).
- Produces: `export const closeDayDialog = (day, onDone) => openDialog(CloseDayDialog, { day, onDone })` in `CloseDay.jsx`; `export function PendingDaysBand({ days, onChange })` and `VerifyDayDialog({ close, day, onDone })` in `VerifyDays.jsx`.

- [ ] **Step 1: Build `PendingDaysBand`**, shown in the « Soldes » card under the tiles when `b.pending_days.length > 0` and the period is not past: title « N journée(s) à vérifier »; one row per day: `dayLabel(day, 'medium')`, state (« Pas encore fermée » or « Fermée par X le … »), `money(total)`; only the first row has a button — « Fermer la caisse » (`closeDayDialog`) when not closed, « Vérifier » (`VerifyDayDialog`) when closed; later rows show « après le {jour précédent} ».
- [ ] **Step 2: Build `VerifyDayDialog`** (title « Vérifier la caisse · {jour} »), loading `GET /api/day-closing?day=`: who closed and when; per account attendu / compté / écart (`gapText`); motif d’écart; billetage; tickets non pointés and their motif; net per caisse (Réservation de séance, Champagne et autres boissons, Cigare). Buttons « Valider la journée » (POST verify, toast « Caisse du … vérifiée. ») and « Rouvrir pour corriger » (`actionDialog` with a required reason, POST reopen, message « La journée est rouverte : corrigez-la, refermez-la, puis validez-la. »).
- [ ] **Step 3: Closing bar:** when closed, append « · en attente de vérification » or « · vérifiée par X » (from `closed.verified`).
- [ ] **Step 4: Verify in the browser** (`npm run build`, local server, admin and gérant accounts from README): pending lines on the tiles, band, verify, reopen, bar text; console without errors.
- [ ] **Step 5: Commit** — « Vérification de caisse : journées à vérifier et dialogue de vérification ».

### Task 6: Accueil alert and README

**Files:**
- Modify: `worker/club.js` (dashboard result near `:3424`)
- Modify: `src/pages/Dashboard.jsx:190` and the alerts list (`:259`)
- Modify: `README.md` (« Caisse » section)
- Test: `test/day-verification.test.js`

**Interfaces:**
- Produces: `GET /api/dashboard` field `days_to_verify: string[]` — for bosses only, the `pendingDays(today)` days that are before today or closed; `[]` for the gérant.

- [ ] **Step 1: Write the failing test:** after closing yesterday, `GET /api/dashboard` gives `days_to_verify: [yesterday]` to the admin and `[]` to the gérant.
- [ ] **Step 2: Run** `node --test test/day-verification.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the field; in `Dashboard.jsx` add it to `totalAlerts` and a `Link` row to `/caisse` titled « Caisses à vérifier », meta the days (`dayLabel(d, 'short')`), chip `${n} à vérifier`. README: one paragraph on closing → verification → solde validé, « en attente », « En tout », order of days, « disponible ».
- [ ] **Step 4: Run** `npm test` and `npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** — « Vérification de caisse : alerte sur l’Accueil et README ».
