# Menu par secteur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ranger le menu latéral en sections Clients / Ventes / Achats et stocks / Administration.

**Architecture:** La liste `NAV` et le filtre par rôle sortent de `AppShell.jsx` vers un module pur `nav.js` (testable par `node --test`). Le filtre retire aussi les titres de section sans rubrique visible.

**Tech Stack:** React 18, react-router 6, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-19-menu-par-secteur-design.md`

## Global Constraints

- Titres exacts : `Clients`, `Ventes`, `Achats et stocks`, `Administration` (affichés en majuscules par le CSS `.side-nav-label`).
- Accueil en tête, sans titre.
- Droits inchangés : `boss: true` sur Fournisseurs, `admin: true` sur Administration.
- Onglets téléphone (`tab: true`) inchangés : Accueil, Salles, Agenda, Membres, Boutique, Caisse.

## Review Focus

- Gérant : aucune section vide ; « Achats et stocks » montre Stocks seul ; pas de titre « Administration ».
- Associé : Fournisseurs visible, pas de titre « Administration ».
- Menu replié : un trait par section, pas deux traits collés.
- Page active toujours surlignée (`navFor` lit la même liste).
- Menu compte sur téléphone : même liste qu'avant (Commandes, Stocks, Fournisseurs, Administration selon rôle).

---

### Task 1: Module `nav.js` et menu par secteur

**Files:**
- Create: `src/components/layout/nav.js`
- Modify: `src/components/layout/AppShell.jsx:20-41,136,219`
- Modify: `src/components/ui/GuidedTour.jsx:20` (texte de l'étape « Le menu du club »)
- Test: `test/nav.test.js`

**Interfaces:**
- Produces: `export const NAV` (même forme qu'aujourd'hui : `{ group }` ou `{ path, label, short, icon, tab?, counter?, boss?, admin?, also? }`) ; `export function visibleNav(user) -> Array` (rubriques autorisées pour `user`, titres sans rubrique retirés).

- [ ] **Step 1: Écrire `test/nav.test.js`**

Tests :
- `ordre des sections` : `NAV.filter(n => n.group).map(n => n.group)` vaut `['Clients', 'Ventes', 'Achats et stocks', 'Administration']`, et `NAV[0].path === '/'`.
- `administrateur` : `visibleNav({ role: 'admin' })` contient les 4 titres et les 10 rubriques.
- `associé` : contient `/fournisseurs`, pas `/parametres`, pas le titre `Administration`.
- `gérant` : pas `/fournisseurs`, pas `/parametres`, pas `Administration` ; `Achats et stocks` suivi de `/produits`.
- `aucun titre vide` : pour chaque rôle, aucun titre n'est suivi d'un autre titre ni en dernière position.
- `onglets téléphone` : `NAV.filter(n => n.tab).map(n => n.path)` vaut `['/', '/salles', '/agenda', '/membres', '/boutique', '/caisse']`.

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test test/nav.test.js` — Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `nav.js`**, y déplacer `NAV` réordonnée selon la spec et `visibleNav(user)` (filtre `admin` → `user.role === 'admin'`, `boss` → `isBoss(user)`, puis retire tout titre non suivi d'une rubrique). `AppShell.jsx` importe `NAV` et `visibleNav` ; la barre latérale et le menu compte utilisent `visibleNav(me)`.

- [ ] **Step 4: Mettre à jour le texte de la visite guidée** : décrire les sections au lieu de la liste.

- [ ] **Step 5: Lancer** `npm test` — Expected: tout PASS ; `npm run build` — Expected: build OK.

- [ ] **Step 6: Vérifier dans le navigateur** (admin, menu déplié et replié, téléphone).

- [ ] **Step 7: Commit**
