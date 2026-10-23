# Règles de la salle — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objectif :** imposer 30 minutes entre deux réservations d'une même salle, alerter le gérant 15 minutes avant la fin d'une séance avec la prolongation réellement possible, et lui permettre d'envoyer la confirmation de réservation sur WhatsApp en un clic.

**Architecture :**
- Le serveur porte les règles : `worker/club.js`.
  - Le battement est contrôlé à la création, à la prolongation et au changement de salle.
  - Une fenêtre de prolongation est calculée par la même logique que la prolongation elle-même.
- L'interface affiche ce que le serveur calcule, avec une alerte partagée par Salles et Accueil.
- Le message WhatsApp est construit dans le navigateur, par un lien `wa.me` que le gérant ouvre lui-même.

**Technologies :** Cloudflare Workers + Durable Objects (SQLite) ; Node `node:test` + `node:sqlite` ; React 18 + zustand ; Vite.

**Description approuvée :** `docs/superpowers/specs/2026-10-23-regles-salle-design.md`

## Contraintes générales

- **Battement :**
  - réglage `booking.gap_min`, entier de 0 à 240, 30 par défaut, et 0 désactive la règle ;
  - il vaut pour la même salle seulement, et ignore les réservations annulées ;
  - il n'est ni facturé, ni retiré de l'abonnement.
- **Contrôles du battement :**
  - il est vérifié à la création, à la prolongation, et au changement de salle quand `room_id` change ;
  - jamais à : démarrer, terminer, encaisser, annuler, ajouter une consommation, changer seulement l'effectif ;
  - les réservations déjà enregistrées, même collées, restent valides.
- **Erreur de battement :** code `BATTEMENT`, HTTP 409. Le message commence par « Il faut 30 minutes entre deux réservations », où « 30 minutes » est la durée réglée (formatée avec `fmtDuration`). Il donne l'heure possible la plus proche. Les heures sont au format de l'application, `HH:MM`.
- **Fenêtre de prolongation :**
  - « possible » égale exactement ce que `extendReservation` accepterait ;
  - elle tient compte de la séance suivante moins le battement, de la limite de 24 heures et des membres déjà occupés ;
  - sans tarif validé (hors démo), elle se limite aux heures comprises encore disponibles.
- **Alerte :**
  - séance `en_cours` dont la fin prévue est dans 15 minutes ou moins ;
  - pas de son ;
  - le minuteur passe aussi à 15 minutes, au lieu de 10.
- **WhatsApp :**
  - lien `https://wa.me/<chiffres>?text=<message encodé>`, ou `https://wa.me/?text=<message encodé>` sans numéro utilisable ;
  - rien n'est jamais envoyé automatiquement ;
  - en démo (`store.demo`), aucun lien n'est ouvert : une fenêtre montre le texte, avec « En démo, aucun message n'est envoyé. »
- **Numéro du club :**
  - réglage `club_whatsapp`, texte de 30 caractères au plus, vide par défaut ;
  - le vrai numéro n'est jamais écrit dans le dépôt (public) : exemples avec `+242 06 000 00 00`.
- **Langues :** textes d'interface en français, commentaires du code en anglais, dans le style existant.
- **Mise en ligne :** jamais sans l'accord du propriétaire.

## Points de vigilance

- **Réservation existante collée, ou devenue trop proche** après un changement de réglage : la terminer, l'encaisser ou l'annuler reste possible. Test en Tâche 1.
- **Battement exactement atteint**, quand la suivante commence à fin + 30 min : la réservation est acceptée. Avec 29 minutes, elle est refusée. Test en Tâche 1.
- **Alerte « possible » mais prolongation refusée** (tarif non validé, membre occupé, 24 heures) : la fenêtre doit dire « impossible » avec la raison. Test en Tâche 2.
- **Numéro de membre au format libre** (« 06 000 00 00 », « +242 06… », « 00242… », vide, texte) : le lien reste toujours ouvrable. Test en Tâche 4.
- **Démo :** le bouton WhatsApp n'ouvre jamais `wa.me`. Vérifié à la main en Tâche 4.

---

### Tâche 1 : le battement côté serveur

**Fichiers :** `worker/club.js` (`defaultSettings`, `normalizeSetting` case `booking`, `planReservation`, `quoteReservation`, `createReservation`, `planExtension`, `quoteExtension`, `extendReservation`, `updateReservationOccupancy`) ; tests dans un nouveau `test/gap.test.js`.

**Interfaces :**
- Produit `booking.gap_min` dans `settings()`, 30 par défaut. Un réglage déjà stocké sans `gap_min` doit se lire avec 30.
- Produit `club.gapConflicts(startMs, endMs, excludeId, roomId) -> ReservationDTO[]`. Elle renvoie les réservations non annulées de la salle `roomId`, autres que `excludeId`, qui ne chevauchent pas strictement `[startMs, endMs)` mais tombent à moins de `gap_min` minutes. Elle renvoie `[]` si `gap_min` vaut 0.
- Produit `planReservation(...).gap_conflicts`, la liste pour la salle choisie. Chaque entrée de `rooms_availability` reçoit `gap_conflict: ReservationDTO | null`, et `available` devient faux si elle n'est pas nulle.
- `quoteReservation` renvoie `gap_conflicts` et `rooms_availability` enrichi.
- `createReservation` lève `BATTEMENT` quand la salle choisie a un conflit de battement et aucun chevauchement strict.
- Produit `planExtension(...).gap_conflicts`. `quoteExtension` les renvoie. `extendReservation` lève `BATTEMENT`.
- `updateReservationOccupancy` lève `BATTEMENT` quand `room_id` change et que la salle d'arrivée a un conflit de battement.
- Messages (la durée « 30 minutes » vient du réglage) :
  - création, la précédente est trop proche : « Il faut 30 minutes entre deux réservations : la séance précédente se termine à 16:00, celle-ci peut commencer à 16:30 au plus tôt. »
  - création, la suivante est trop proche : « Il faut 30 minutes entre deux réservations : la séance suivante commence à 18:00, celle-ci doit se terminer à 17:30 au plus tard. »
  - prolongation : « Il faut 30 minutes entre deux réservations : la séance suivante commence à 18:00, la prolongation peut aller jusqu'à 17:30 au plus tard. »
  - changement de salle : « Il faut 30 minutes entre deux réservations : la salle « Nom » a une réservation de 18:00 à 20:00. »
  - Le champ `details.conflicts` porte la ou les réservations en cause.

- [ ] **Étape 1 : écrire les tests qui échouent** dans `test/gap.test.js`, sur un `Server` avec `{ lenientTariffs: true }` et un gérant connecté (voir `test/rooms.test.js` pour la mise en place) :
  - `battement : refusé à 29 minutes, accepté à 30` : une réservation 14:00–16:00, puis une autre à 16:00 → 409 `BATTEMENT` ; à 16:30 → 200.
  - `battement : la suivante trop proche` : une réservation 18:00–20:00, puis 16:00–17:45 (si le pas le permet, sinon 16:00–18:00 doit donner `CHEVAUCHEMENT`, et 16:00–17:30 être accepté).
  - `battement : réglé à 0, désactivé` : `PUT /api/settings { booking: { ..., gap_min: 0 } }`, puis une réservation collée est acceptée.
  - `battement : validation du réglage` : `gap_min: -1` et `gap_min: 241` → 400.
  - `battement : prolongation` : 14:00–16:00 et 16:30–18:00 ; prolonger la première de 30 → 409 `BATTEMENT`.
  - `battement : devis` : le devis d'une réservation à 16:00 après 14:00–16:00 renvoie `gap_conflicts` non vide et la salle `available: false` avec `gap_conflict`.
  - `battement : réservations collées existantes intactes` : avec le réglage à 0, créer 14:00–16:00 et 16:00–18:00, remettre 30, puis démarrer, terminer, encaisser et annuler sur ces réservations → tout réussit.
  - `battement : changement de salle` : avec deux salles, une réservation 16:00–18:00 dans la salle B, et une réservation 14:00–16:00 dans la salle A déplacée vers B → 409 `BATTEMENT`. Changer seulement `party_size` reste accepté.

- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent**

Commande : `node --test test/gap.test.js`
Attendu : ÉCHEC (pas de code `BATTEMENT`).

- [ ] **Étape 3 : implémenter** ces interfaces dans `worker/club.js`.
  - Le contrôle se place à côté des contrôles de chevauchement existants, avec le même style d'erreur (`conflict(...)`).
  - Le chevauchement strict garde la priorité : `CHEVAUCHEMENT`.

- [ ] **Étape 4 : lancer tous les tests**

Commande : `npm test`
Attendu : tout PASSE, y compris les anciens tests. Si un ancien test crée des réservations collées, le corriger en écartant ses horaires, ou en mettant `gap_min: 0` dans ce test seulement, et le noter dans le rapport.

- [ ] **Étape 5 : commiter**

### Tâche 2 : la fenêtre de prolongation côté serveur

**Fichiers :** `worker/club.js` (une nouvelle méthode, `dashboard` → `rooms_status[].current`, `reservationDetail`) ; tests dans `test/gap.test.js`.

**Interfaces :**
- Utilise `planExtension` et `gapConflicts` (Tâche 1).
- Produit `club.extensionWindow(reservationId) -> { possible: boolean, max_minutes: number, until_time: string|null, until_at: string|null, reason: string|null, next: { member_name, start_time } | null }` :
  - Il essaie les durées multiples du pas de prolongation, de la plus courte à la plus longue, jusqu'à la limite des 24 heures.
  - Une durée est valide si `planExtension` la planifie sans erreur, et si elle ne crée ni chevauchement, ni conflit de battement, ni membre occupé, ni blocage de tarif hors démo (`addPaid > 0 && !tariff.validated && !demo_mode`).
  - `max_minutes` est la plus longue durée valide.
  - Si aucune durée n'est valide, `reason` reçoit la raison de l'échec de la plus courte :
    - « Prolongation impossible : la séance suivante commence à 16:30 (Client Test 2). »
    - « Prolongation impossible : le tarif des heures supplémentaires n'est pas encore validé par un administrateur. »
    - « Prolongation impossible : Client Test 3 est déjà inscrit à une autre séance à 16:30. »
    - « Prolongation impossible : une séance ne peut pas dépasser 24 heures. »
  - `next` est la prochaine réservation non annulée de la même salle, ou `null`.
  - Pour une réservation qui n'est pas `reservee` ou `en_cours`, il renvoie `possible: false` et `reason: null`.
- `rooms_status[].current.extension_window` et `reservationDetail(...).extension_window` portent ce résultat.

- [ ] **Étape 1 : écrire les tests qui échouent** :
  - `fenêtre : suivante à fin + 90 min, battement 30` → `max_minutes: 60`, `until_time` = fin + 60.
  - `fenêtre : suivante à fin + 30 min` → `possible: false`, `reason` commence par « Prolongation impossible : la séance suivante ».
  - `fenêtre : sans suivante` → `max_minutes` = 1440 − durée, arrondi au pas inférieur.
  - `fenêtre : tarif non validé, sans crédit restant`, sur un `Server` sans `lenientTariffs` → `possible: false` avec la raison du tarif.
  - `fenêtre : tarif non validé, 60 min de crédit restant` → `max_minutes: 60`.
  - `fenêtre et prolongation d'accord` : pour plusieurs cas, `extend` avec `max_minutes` réussit, et avec `max_minutes + pas` échoue.
  - `fenêtre : exposée` : `GET /api/dashboard` → `rooms_status[0].current.extension_window` est présent pour une séance démarrée ; `GET /api/reservations/:id` → `extension_window` est présent.

- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent**

Commande : `node --test test/gap.test.js`

- [ ] **Étape 3 : implémenter** dans `worker/club.js`. Réutiliser `planExtension` dans un try/catch par durée essayée. Ne pas dupliquer ses règles.

- [ ] **Étape 4 : lancer tous les tests**

Commande : `npm test`
Attendu : tout PASSE.

- [ ] **Étape 5 : commiter**

### Tâche 3 : l'alerte de 15 minutes et le battement dans l'interface

**Fichiers :**
- Créer `src/components/ui/EndingSoonNotice.jsx`.
- Modifier `src/components/ui/SessionTimer.jsx` (`ENDING_SOON_MS` passe à `15 * 60000`), `src/pages/Rooms.jsx`, `src/pages/Dashboard.jsx`, `src/dialogs/reservationDialogs.jsx`, `src/pages/Settings.jsx` (formulaire des horaires, qui contient `slot_min` et `extension_step_min`) et `src/club.css`.

**Interfaces :**
- Utilise `current.extension_window` (Tâche 2), `gap_conflicts` et `rooms_availability[].gap_conflict` (Tâche 1), et `openExtendDialog(r, onDone)` (existant).
- Produit `<EndingSoonNotice reservation={r} onExtended={reload} />` :
  - Il ne rend rien si `r.status !== 'en_cours'`, ou si la fin prévue est à plus de 15 minutes, ou déjà passée.
  - Sinon, il affiche « Fin à 16:00 : demandez au client s'il veut prolonger. » puis :
    - si `extension_window.possible`, « Prolongation possible jusqu'à 17:30 » et un bouton « Prolonger » qui appelle `openExtendDialog(r, onExtended)` ;
    - sinon, `extension_window.reason`.
  - Le temps se rafraîchit chaque seconde.
  - Le style est orange, dans l'esprit des cartes existantes, lisible en thème clair et en thème sombre.

- [ ] **Étape 1 : implémenter.**
  - Brancher `EndingSoonNotice` dans la carte de la séance en cours, sur Salles et sur Accueil.
  - Dans la fenêtre de réservation :
    - une salle refusée seulement pour le battement affiche la puce « Trop proche d'une autre réservation », au lieu de « Occupée » ;
    - l'avis du devis montre le message de battement quand `gap_conflicts` n'est pas vide.
  - Ajouter le champ « Battement entre deux réservations (minutes) » au formulaire des horaires : nombre de 0 à 240, envoyé dans `booking.gap_min`, avec l'aide « 0 pour désactiver ».
- [ ] **Étape 2 : vérifier** que `npm run build` réussit sans avertissement et que `npm test` passe.
- [ ] **Étape 3 : commiter**

### Tâche 4 : la confirmation WhatsApp en un clic

**Fichiers :**
- Créer `shared/whatsapp.js` et `test/whatsapp.test.js`.
- Modifier `worker/club.js` : réglage `club_whatsapp` ; dans `reservationDetail`, les champs `member_first_name` et `member_phone`, uniquement dans le détail, pas dans les listes.
- Modifier `src/dialogs/reservationDialogs.jsx` (après une réservation réussie), `src/pages/Reservation.jsx` (« Renvoyer la confirmation »), `src/pages/Settings.jsx` (« Numéro WhatsApp du club ») et `README.md` (une phrase sur la confirmation WhatsApp et le réglage).

**Interfaces :**
- **`waDigits(phone: string) -> string | null`** :
  - il retire tout ce qui n'est pas un chiffre, en gardant un `+` initial ;
  - « 00 » en tête est traité comme un préfixe international et retiré ;
  - 9 chiffres commençant par 0 reçoivent le préfixe `242` ;
  - il renvoie les chiffres internationaux, de 8 à 15, sinon `null`.
- **`bookingConfirmationText({ firstName, dayLabel, startTime, endTime, roomName, partySize, clubName, clubWhatsapp }) -> string`** :
  - « Bonjour Jean-Pierre, votre réservation au club Limen est confirmée : vendredi 24 octobre, de 18:00 à 20:00 (Salon Principal, 2 personnes). Pour toute question : +242 06 000 00 00. » ;
  - au singulier, « 1 personne » ;
  - la dernière phrase disparaît si `clubWhatsapp` est vide.
- **`waLink(digits: string | null, text: string) -> string`** : `https://wa.me/<digits>?text=<encodeURIComponent(text)>`, ou `https://wa.me/?text=…`.
- **`club_whatsapp`** : texte de 30 caractères au plus, vide par défaut, réglable par un administrateur via `PUT /api/settings`.

- [ ] **Étape 1 : écrire les tests qui échouent** dans `test/whatsapp.test.js` :
  - `waDigits('06 000 00 00') === '242060000000'` ;
  - `waDigits('+242 06 000 00 00') === '242060000000'` ;
  - `waDigits('00242060000000') === '242060000000'` ;
  - `waDigits('') === null` et `waDigits('abc') === null` ;
  - `waDigits('+33 6 12 34 56 78') === '33612345678'` ;
  - `bookingConfirmationText` avec et sans `clubWhatsapp`, et avec `partySize` 1 ;
  - `waLink(null, 'a b')` vaut `https://wa.me/?text=a%20b`.

  Ajouter aussi un test serveur : `PUT /api/settings { club_whatsapp: '+242 06 000 00 00' }` est relu dans `/api/me`, et une valeur de 31 caractères est refusée.

- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent**

Commande : `node --test test/whatsapp.test.js`

- [ ] **Étape 3 : implémenter.**
  - Le bouton « Envoyer la confirmation WhatsApp » apparaît dans la fenêtre de réservation, après le succès. Il ouvre `waLink(...)` dans un nouvel onglet (`window.open(url, '_blank', 'noopener')`).
  - Sur la fiche de la réservation, le bouton « Renvoyer la confirmation » apparaît quand le statut est `reservee` ou `en_cours`.
  - En démo, les deux boutons ouvrent une fenêtre avec le texte et « En démo, aucun message n'est envoyé. », sans ouvrir de lien.

- [ ] **Étape 4 : vérifier** que `npm test` passe en entier et que `npm run build` réussit sans avertissement.

- [ ] **Étape 5 : commiter**

### Après la construction (contrôleur)

1. Vérification dans le navigateur, sur le serveur local :
   - une réservation collée est refusée avec le message de battement ;
   - le devis l'annonce, et la salle affiche « Trop proche » ;
   - pour une séance démarrée qui finit dans moins de 15 minutes, l'alerte s'affiche avec « possible jusqu'à » ou la raison, et le bouton « Prolonger » fonctionne ;
   - le bouton WhatsApp produit le bon lien (le lien est lu, pas ouvert) ;
   - en démo, il montre seulement le texte ;
   - le réglage du battement et le numéro du club s'enregistrent ;
   - en largeur téléphone et en thème sombre, tout reste lisible.
2. Relecture finale de toute la branche.
3. Mise en ligne seulement avec l'accord du propriétaire.
