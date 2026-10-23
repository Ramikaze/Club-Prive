# Règles de la salle — conception

Date : 2026-10-23 · Projet : Club Privé (club « Limen ») · Branche : `feat/regles-salle` (partie de `feat/mode-demo`)

## Pourquoi

Le propriétaire veut que l'application suive le fonctionnement réel de la salle :
- entre deux séances, il faut du temps pour remettre la salle en état ;
- le gérant doit proposer une prolongation au client 15 minutes avant la fin de sa séance, ou le prévenir qu'elle est impossible parce que la séance suivante est déjà prise ;
- le client reçoit une confirmation de sa réservation sur WhatsApp.

Aujourd'hui, l'application accepte deux réservations collées (16 h 00 → 16 h 00). Elle signale une séance qui se termine seulement 10 minutes avant la fin, sans rien dire de la séance suivante, et n'envoie rien au client.

## Objectifs

1. Toujours au moins 30 minutes entre deux réservations de la même salle.
2. Une alerte au gérant 15 minutes avant la fin d'une séance en cours, qui lui dit directement si une prolongation est possible et jusqu'à quelle heure, ou pourquoi elle ne l'est pas.
3. Une confirmation de réservation envoyée au client sur WhatsApp, en un clic du gérant.

## Hors sujet

- La carte de débit (crédit conso), les reçus d'approvisionnement et le renouvellement automatique : c'est le projet suivant.
- Le nouveau design de la carte de membre : il vient avec la carte de débit, une fois le logo fourni.
- L'envoi automatique de messages WhatsApp par le serveur (API WhatsApp Business) : écarté par le propriétaire.
- Les tarifs : inchangés (temps en plus à 25 000 FCFA l'heure, 15 000 FCFA la demi-heure restante, à valider par un administrateur).

## À éviter absolument

- Un message WhatsApp parti tout seul, ou depuis la démo.
- Une règle qui bloque une réservation déjà enregistrée, ou empêche de la terminer, de l'encaisser ou de l'annuler.
- Une alerte qui annonce « prolongation possible » alors que le serveur la refuserait, ou l'inverse.
- Le numéro WhatsApp du club écrit dans le code : le dépôt GitHub est public.

## Ce que le propriétaire a décidé

1. **30 minutes entre deux réservations.**
   - Une nouvelle réservation ou une prolongation est refusée si elle laisse moins de 30 minutes avec la réservation précédente ou suivante de la même salle.
   - Ces 30 minutes ne sont ni facturées, ni retirées des heures de l'abonnement.
   - Les réservations déjà enregistrées restent telles quelles, même collées.
   - Le refus explique quoi faire, par exemple : « Il faut 30 minutes entre deux réservations : la séance précédente se termine à 16 h 00, celle-ci peut commencer à 16 h 30 au plus tôt. »
2. **Alerte 15 minutes avant la fin.**
   - Sur la page Salles et sur l'Accueil, la carte d'une séance en cours passe en orange 15 minutes avant sa fin prévue.
   - Elle affiche : « Fin à 16 h 00 : demandez au client s'il veut prolonger. »
   - Juste en dessous, l'une des deux réponses :
     - « Prolongation possible jusqu'à 17 h 30 », avec le bouton « Prolonger » (qui ouvre la fenêtre de prolongation existante) ;
     - « Prolongation impossible : la séance suivante commence à 16 h 30 (Client Test 2) ».
   - Aucun son.
   - Le calcul tient compte des 30 minutes.
3. **Confirmation WhatsApp en un clic.**
   - Après une réservation, un bouton « Envoyer la confirmation WhatsApp » ouvre WhatsApp avec le message déjà écrit, adressé au client. Le gérant n'a plus qu'à appuyer sur « Envoyer ».
   - Le message part du WhatsApp du club, installé sur l'appareil du gérant.
   - Rien n'est envoyé automatiquement.
   - En démo, le bouton montre le message mais n'ouvre pas WhatsApp.
   - Le numéro WhatsApp du club est un réglage dans Paramètres, saisi par un administrateur. Il figure en bas du message.

## Choix faits par Claude (à vérifier par le propriétaire)

- **Durée du battement réglable.** C'est un réglage « Battement entre deux réservations » dans Paramètres > Club & Horaires, 30 minutes par défaut. Un administrateur peut le régler de 0 à 240 minutes, et 0 désactive la règle.
- **Le battement vaut pour toutes les réservations de la même salle**, quel que soit le membre. Pour deux salles différentes, il ne s'applique pas.
- **Ce qui est contrôlé :** trois actions sont vérifiées.
  - La création d'une réservation.
  - La prolongation.
  - Le changement de salle d'une réservation, depuis sa fiche (`PUT /api/reservations/:id/occupancy` avec un autre `room_id`). Le battement est vérifié dans la salle d'arrivée.
  - Changer seulement le nombre de personnes n'est pas vérifié. Démarrer, terminer, encaisser, annuler ou ajouter une consommation ne sont jamais bloqués par le battement.
- **Le battement visible avant l'envoi.**
  - Dans la fenêtre de réservation, le devis (`/api/reservations/quote`) signale le battement avant l'envoi, comme il signale déjà un chevauchement.
  - Le choix des salles montre une salle refusée pour cause de battement avec sa propre mention : « Trop proche d'une autre réservation », et non « Occupée ».
  - La grille de l'Agenda ne change pas dans ce chantier : griser les zones de battement viendra peut-être plus tard.
- **Prolongation maximale : exactement ce que le serveur accepterait.**
  - Elle est calculée côté serveur par la même logique que la prolongation elle-même, au pas de prolongation (30 minutes par défaut).
  - Elle tient compte de la séance suivante moins le battement, et de la limite de 24 heures.
  - Elle tient compte des membres de la séance déjà inscrits ailleurs. Sans tarif validé (hors démo), elle se limite aussi aux heures encore comprises dans l'abonnement.
  - « Possible jusqu'à » n'apparaît que pour une prolongation que le serveur accepterait vraiment. Sinon, l'alerte donne la raison :
    - « Prolongation impossible : la séance suivante commence à 16 h 30 (Client Test 2). »
    - « Prolongation impossible : le tarif des heures supplémentaires n'est pas encore validé par un administrateur. »
    - « Prolongation impossible : Client Test 3 est déjà inscrit à une autre séance à 16 h 30. »
    - « Prolongation impossible : une séance ne peut pas dépasser 24 heures. »
  - Sans séance suivante dans les 24 heures, « possible jusqu'à » affiche la limite des 24 heures.
- **Le seuil de 15 minutes s'applique aussi au minuteur de séance**, qui passait en « bientôt fini » à 10 minutes.
- **Contenu du message de confirmation.** Il est en français, de cette forme :
  > Bonjour Jean-Pierre, votre réservation au club Limen est confirmée : vendredi 24 octobre, de 18 h 00 à 20 h 00 (Salon Principal, 2 personnes). Pour toute question : +242 06 000 00 00.

  Le nom du club et du salon viennent des réglages. Sans numéro du club réglé, la dernière phrase disparaît.
- **Numéro du client.**
  - Le numéro du membre est nettoyé (espaces, tirets, points).
  - Un numéro qui commence par « 00 » est traité comme un préfixe international.
  - Un numéro local congolais à 9 chiffres commençant par 0 (par exemple 06 000 00 00) reçoit l'indicatif 242.
  - Un numéro inutilisable ouvre WhatsApp sans destinataire : le gérant choisit alors le contact lui-même.
- **Bouton « Renvoyer la confirmation »** sur la fiche de la réservation, tant qu'elle n'est ni annulée ni terminée.

## Comment ça marche (orientation technique)

Le code concerné :
- `worker/club.js` : `settings()`, `normalizeSetting` (`booking`), `planReservation`, `quoteReservation`, `createReservation`, `planExtension`, `quoteExtension`, `extendReservation`, `reservationDetail`, `dashboard` (`rooms_status`, avec `current` et `next`) ;
- `src/pages/Rooms.jsx` et `src/pages/Dashboard.jsx` : cartes des salles ;
- `src/components/ui/SessionTimer.jsx` : `ENDING_SOON_MS` ;
- `src/dialogs/reservationDialogs.jsx` : fenêtre de réservation, `openExtendDialog` ;
- `src/pages/Reservation.jsx` : fiche d'une réservation ;
- `src/pages/Settings.jsx` : Club & Horaires.

**Battement**
- Nouveau champ `booking.gap_min` : entier de 0 à 240, 30 par défaut. Il est validé dans `normalizeSetting('booking')` et ajouté aux valeurs par défaut.
- Les déclencheurs SQL anti-chevauchement restent tels quels. Le battement est un contrôle applicatif dans `planReservation`, `planExtension` et `updateReservationOccupancy` (seulement quand `room_id` change), fait dans la même transaction : un Durable Object ne traite qu'une écriture à la fois.
- Une réservation entre en conflit de battement si, dans la même salle et hors réservations annulées, une autre réservation `o` vérifie `o.start_ms < fin + gap` et `o.end_ms > début - gap`, sans chevauchement strict. Le chevauchement strict reste l'erreur `CHEVAUCHEMENT` existante.
- Le nouveau code d'erreur est `BATTEMENT` (HTTP 409), avec un message qui donne l'heure possible la plus proche et, en détails, la réservation en cause.
- Le devis (`quoteReservation`, `quoteExtension`) renvoie ces conflits, comme `conflicts` aujourd'hui. Le client peut ainsi les afficher avant l'envoi.

**Fenêtre de prolongation**
- Une fonction serveur calcule pour une réservation `{ possible, max_minutes, until_time, reason, next: { member_name, start_time } | null }` selon les règles ci-dessus. Elle réutilise la logique de `planExtension`, pour que « possible » corresponde exactement à ce que `extendReservation` accepte. `reason` porte le texte d'impossibilité.
- Elle est exposée dans `rooms_status[].current` (Accueil, Salles) et dans le détail d'une réservation.
- L'interface ne refait jamais ce calcul : elle l'affiche.

**Alerte 15 minutes**
- C'est un composant d'interface partagé par Salles et Accueil.
- Il s'affiche pour une séance `en_cours` dont la fin prévue est dans 15 minutes ou moins. Une fois la fin dépassée, l'affichage « dépassement » existant prend le relais.
- Le temps restant est rafraîchi chaque seconde, sur le modèle du minuteur. La fenêtre de prolongation vient du serveur et se recharge avec la page, ou après une prolongation.

**Confirmation WhatsApp**
- Nouveau réglage `club_whatsapp` : texte libre, numéro au format international, vide par défaut. Il est saisi dans Paramètres > Club & Horaires.
- Le lien est construit dans le navigateur : `https://wa.me/<chiffres>?text=<message encodé>`, ou `https://wa.me/?text=…` sans numéro valide. Il s'ouvre dans un nouvel onglet ou dans l'application WhatsApp du téléphone.
- En démo (`store.demo`), le bouton ouvre une fenêtre qui montre le texte du message, avec la mention « En démo, aucun message n'est envoyé. »
- La normalisation du numéro est une petite fonction pure, testée.

**Tests**
- Les tests Node (`test/*.test.js`) couvrent :
  - le battement à la création (avant, après, exactement 30 minutes, 0 qui désactive) ;
  - le battement à la prolongation ;
  - une réservation existante collée qui reste terminable et encaissable ;
  - la validation du réglage ;
  - la fenêtre de prolongation (séance suivante, battement, 24 heures, pas) ;
  - la normalisation des numéros, si elle vit dans `shared/`.
- Le reste se vérifie dans le navigateur.

Laissé au constructeur : le nom exact de la fonction de fenêtre de prolongation et de ses champs, la forme visuelle de l'alerte (dans le style des cartes existantes, orange et lisible dans les deux thèmes), et l'emplacement exact du bouton WhatsApp après la réservation.

## Mise en ligne

Avec le mode démo, sur le site des clients seulement (`npm test` puis `npm run deploy`), et uniquement avec l'accord du propriétaire. Après la mise en ligne, un administrateur saisit le numéro WhatsApp du club dans Paramètres.
