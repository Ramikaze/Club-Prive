# Caisse sur téléphone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur téléphone, la page Caisse montre une ligne d'actions (Dépense, Entrée, Transfert, ⋯) et une ligne de filtres (période ▾, caisse ▾) avant les Soldes.

**Architecture:** Les deux affichages sont rendus et basculés en CSS (`.only-phone` / `.only-desktop`, limite 900 px comme `.sidebar`). Les fenêtres « Plus » et « Période » passent par `openDialog` + `Modal`. Le libellé du bouton de période est une fonction pure testée.

**Tech Stack:** React 18, react-router 6, lucide-react, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-19-caisse-telephone-design.md`

## Global Constraints

- Téléphone = `max-width: 899px` ; au-delà, l'affichage actuel ne change pas.
- Textes exacts : `Dépense`, `Entrée`, `Transfert`, titre de fenêtre `Plus`, groupes `Consulter` / `Comptabilité`, `Trésorerie et bilans`, option `Toutes les caisses`.
- Page du gérant : inchangée.

## Review Focus

- Dates libres dans la fenêtre Période : changer « Du » puis « au » ne doit pas perdre le premier choix (état local, un seul `setPeriod` à la validation).
- Les autres paramètres de l'adresse (`compte`, `type`) restent après un choix de période.
- Un seul jour hors préréglage (ex. 12 nov.) : le bouton dit « 12 nov. ».
- Période à cheval sur deux années : le bouton montre l'année des deux bouts.
- Liens de la fenêtre « Plus » : la fenêtre se ferme en naviguant.

---

### Task 1: Libellé de période (`src/lib/period.js`)

**Files:** Create `src/lib/period.js` · Test `test/period-label.test.js`

**Interfaces:** Produces `periodButtonLabel(from: string, to: string, presets: {label, from, to}[]) -> string`.

- [ ] Test : préréglage qui correspond → son `label` (« 7 jours ») ; un jour hors préréglage `2026-11-12` → `12 nov.` ; plage même année `2026-11-03`→`2026-11-19` → `3 nov. – 19 nov.` ; plage sur deux années `2025-12-28`→`2026-01-03` → `28 déc. 2025 – 3 janv. 2026`.
- [ ] Lancer `node --test test/period-label.test.js` → FAIL ; écrire la fonction (`Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })`) → PASS.

### Task 2: Sélecteur de période compact (`PeriodPicker.jsx`)

**Files:** Modify `src/components/ui/PeriodPicker.jsx`, `src/components/ui/Icon.jsx` (ajouter `more: Ellipsis`, `down: ChevronDown`), `src/club.css`.

- [ ] `PeriodPicker` rend en plus un bouton `.only-phone` : icône `calendar`, `periodButtonLabel(...)`, icône `down` ; il ouvre `PeriodDialog` (titre « Période ») : les préréglages (un clic applique et ferme), puis Du / au en état local et un bouton « Afficher » qui applique une fois et ferme.
- [ ] Les préréglages et les dates actuels reçoivent `.only-desktop`.
- [ ] CSS : `.only-phone { display: none }` ; sous 900 px `.only-desktop { display: none !important }` et `.only-phone` visible.

### Task 3: Actions de la Caisse (`Cash.jsx`)

**Files:** Modify `src/pages/Cash.jsx:130-155`, `src/club.css`.

- [ ] Actions actuelles dans un conteneur `.only-desktop`.
- [ ] Rangée `.only-phone .cash-phone-actions` : `+ Dépense` (principal, prend la place libre), `+ Entrée`, `Transfert`, bouton `⋯` (`aria-label="Plus"`) qui ouvre `MoreDialog` : groupes Consulter (Historique des tickets, Journal des opérations) et Comptabilité (Trésorerie et bilans, Grand livre, Clôture mensuelle), liens qui ferment la fenêtre.
- [ ] « Caisse ou compte » : texte `.only-desktop`, `aria-label` sur le `select`, option vide « Toutes les caisses ».
- [ ] `npm test` et `npm run build` OK ; contrôle navigateur à 375 px et sur ordinateur ; commit.
