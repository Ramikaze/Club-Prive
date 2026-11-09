# Identifiant choisi par le client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients choose their own identifier at first sign-in (never the phone); only the associés and the administrator can create an access or give a temporary code.

**Architecture:** `client_accounts.login` holds the client's chosen identifier once chosen; a new flag `login_chosen` tells it apart from a provisional or legacy value. Sign-in looks up the typed value as a chosen/legacy login, or as the file's member number (current or former) when the account has a live temporary code. Sessions opened before the identifier is chosen are limited to the « choose » step, like `must_set_password` today. Staff rights move from `ACCOUNTS` (any staff) to `CLUB` (admin + associés) for create / new code / restore.

**Tech Stack:** Cloudflare Worker + Durable Object SQLite (`worker/`), React 18 + Vite (`src/`), `node --test` through `test/harness.js`.

**Spec:** `docs/superpowers/specs/2026-11-09-identifiant-client-design.md` (validated 2026-11-09), on top of `docs/superpowers/specs/2026-11-09-espace-client-design.md`.

## Global Constraints

- Migration **V25** after V24 (`worker/schema.js`, `MIGRATIONS`): `ALTER TABLE client_accounts ADD COLUMN login_chosen INTEGER NOT NULL DEFAULT 0 CHECK (login_chosen IN (0, 1))` — existing rows (phone logins) stay with `login_chosen = 0`.
- New accesses: `login` = the file's member number in lower case (e.g. `m-0012`), `login_chosen = 0`. The phone is no longer read to build an identifier (`TELEPHONE` and `IDENTIFIANT_PRIS` refusals at creation disappear).
- Identifier rules (exact): trimmed, lower-cased; `^[a-z0-9.-]{4,30}$`; refused if it is only digits once `.` and `-` are removed; refused if it matches `^[mc]-\d+$`; unique among `client_accounts.login` (other accounts) → errors `invalid('…', 'IDENTIFIANT_INVALIDE')`, `conflict('IDENTIFIANT_PRIS', 'Cet identifiant est déjà pris : choisissez-en un autre.')`.
- Sign-in lookup (`clientAccountByLogin`): (1) an account whose `login` equals the typed value lower-cased and trimmed; (2) for an account with `login_chosen = 0` holding a phone login, also `waDigits(typed)` (legacy phone accesses until they choose); (3) a file whose `member_no` or `former_client_no` equals the typed value (case-insensitive) **only if** its account has a live temporary code (`temp_hash` not null, not expired) — then only the code is checked. Same throttle, dummy hash and single error message as today.
- After sign-in, a session is limited to the « choose » step when `must_set_password = 1` (code sign-in) or the account has `login_chosen = 0`: other client routes answer 403 `IDENTIFIANT_A_CHOISIR` (if `login_chosen = 0`) or `MOT_DE_PASSE_A_CHOISIR`. `POST /api/client/password` takes `{ login?, current_password?, new_password }`: `login` is required when `login_chosen = 0`, optional (to change it) after a code sign-in, refused otherwise; on success `login_chosen = 1`. A legacy account signed in with its password and `login_chosen = 0` uses a new route `POST /api/client/login-name { login }` (or the same route without `new_password` — implementer's choice, documented).
- `GET /api/client/me` gains `{ login, login_chosen }` (the chosen identifier, for the « choose » screen prefill).
- Staff rights: `POST /api/members/:id/client-access`, `POST …/code`, `POST …/enable` → `CLUB` roles only (admin, associé); `POST …/disable` and `GET …/client-access` → any staff. Status gains `login_chosen`. Audit: `client.identifiant` (client, user_id null, details {client, avant, apres}).
- WhatsApp text (`clientAccessText`): address `${origin}/client`, « Identifiant provisoire : <member_no> » (not the phone), the code, « valable 7 jours », « vous choisirez votre identifiant et votre mot de passe à la première connexion ».
- All user-facing text in French with French typography. Commit messages in French ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `git stash`.

## Review Focus

1. **A gérant** calling create / new code / enable gets 403; disable still works. Test in Task 1.
2. **A member number alone** (no live code) never signs in, even with the right password; with a live code it signs in. Test in Task 1.
3. **A legacy phone access** must choose an identifier before any other route; afterwards the phone no longer signs in. Test in Task 1.
4. **Identifier rules**: `06 12 34 56 78`, `0612345678`, `m-0012`, `abc`, `é-paul`, a taken one are refused; `Paul.M` is stored `paul.m`. Test in Task 1.
5. **Renewal keeps the chosen identifier**: after a new code, the client signs in with identifier + code (or member number + code), sets a password, may change the identifier. Test in Task 1.

---

### Task 1: Server

**Files:** `worker/schema.js`, `worker/clientAccess.js`, `worker/clientApi.js`, `worker/api.js`, `shared/whatsapp.js`, tests `test/client-access.test.js`, `test/client-auth.test.js` (+ any helper signing clients in), `test/whatsapp.test.js`.

- [ ] **Step 1:** Write failing tests for Review Focus 1-5, the V25 default on existing rows, `me` fields, and the new WhatsApp text.
- [ ] **Step 2:** Run them — FAIL.
- [ ] **Step 3:** Implement the Global Constraints.
- [ ] **Step 4:** `npm test` — all PASS.
- [ ] **Step 5: Commit** `Espace client : identifiant choisi par le client, codes réservés aux associés`

### Task 2: Screens and README

**Files:** `src/components/members/ClientAccessBlock.jsx` (buttons create / new code / restore only for admin + associés — `useIsBoss()`; the gérant sees state, identifier and « Couper l’accès »; status shows « Identifiant : <login> » once chosen, « pas encore choisi » before), `src/client/pages/ClientLogin.jsx` (field « Identifiant ou numéro de membre »; the « choose » screen asks « Votre identifiant » (prefilled from `me.login` when chosen) and the new password twice; a legacy account without a temporary code gets « Choisissez votre identifiant » alone; the rules shown under the field), `src/client/ClientApp.jsx` / `src/client/clientApi.js` (handle 403 `IDENTIFIANT_A_CHOISIR` like `MOT_DE_PASSE_A_CHOISIR`), `src/lib/audit.js` (label `client.identifiant`), `README.md` (identifier chosen by the client; codes given by associés and the administrator).

- [ ] **Step 1:** Build the screens. `npm test` and `npm run build` pass.
- [ ] **Step 2: Commit** `Espace client : écrans de l’identifiant choisi`
