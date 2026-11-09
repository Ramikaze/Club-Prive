# Espace client : identifiants, compte, réservations et commandes Boutique

Date : 2026-11-09. Statut : relu par un développeur indépendant (ses questions sont tranchées ici), validé par le
propriétaire le 2026-11-09 (y compris les points « (mon choix) »). Chaque choix qui n'a pas été dit par le
propriétaire est marqué **(mon choix)** : le propriétaire les relit avant la construction.

## Pourquoi

Les clients du club (membres et clients réguliers) veulent suivre leur compte sans appeler le club : leur solde, ce
qu'ils ont consommé, leurs réservations, leur séance en cours. Ils veulent aussi préparer un achat à la Boutique depuis
leur téléphone et venir le chercher au club. Le personnel doit être prévenu tout de suite d'une commande ou d'une
demande de réservation.

## Ce qui existe déjà

- **Comptes du personnel** (table `users`, rôles admin / associé / gérant) : identifiant + mot de passe haché
  (PBKDF2-SHA256, 100 000 itérations, sel de 16 octets, `worker/auth.js`), sessions en base (table `sessions`, cookie
  `sid`, 14 jours), 5 échecs de suite bloquent l'adresse + l'identifiant une minute (`worker/api.js`).
- **Attention** : la plupart des routes de l'API sont ouvertes à « tout compte connecté » (options `{}`). Une session
  de client ne doit donc **jamais** être reconnue par ces routes.
- **Fiches** : table `members`, colonne `kind` : `membre` (M-…), `client` (client régulier C-…), `journalier` (une seule
  ligne cachée, sans fiche). Un membre a un crédit carte en FCFA (`walletDTO`) et un abonnement en heures. Un client
  régulier peut acheter à crédit sous un plafond (`credit_limit`, `clientAccount`). Un client régulier peut être passé en
  membre : même ligne, même historique.
- **Boutique** (`worker/shop.js`) : une vente ne concerne qu'un rayon (cigares ou champagne), sort du stock, est payée
  tout de suite (espèces, MTN MoMo, crédit carte d'un membre) ou « à crédit » pour un client régulier. Les « autres
  boissons » ne se vendent pas à la Boutique.
- **Réservations** : réservées aux membres ; battement de 30 minutes ; acompte de 50 % du temps payant pour 3 h ou plus ;
  payées par les heures d'abonnement puis le crédit carte (`createReservation`).
- **Tickets de caisse** : un ticket par paiement, réimprimable (Original / Duplicata n°X, table `ticket_events`).
- La conception de la Boutique (2026-10-28) excluait la vente en ligne : **ce projet change cette règle**, sans paiement
  en ligne ni livraison.

## Décisions du propriétaire (2026-11-09)

1. Deux sortes de clients ont un espace : les **membres** et les **clients réguliers**. Les clients journaliers n'en ont
   pas (pas de fiche).
2. L'espace d'un client montre : son **solde**, l'**historique** de tout ce qu'il a consommé, ses **réservations** et
   leur état (confirmée ou non), s'il est **en séance** avec le **compte à rebours** qui défile, et la **Boutique**.
3. Le client peut **rouvrir le ticket de caisse** de chacun de ses achats et le réimprimer ou le télécharger.
4. **Boutique** : le client remplit un panier et commande ; il **vient chercher ses produits au club** et **paie sur
   place, à la Boutique**. La commande ne prend aucun argent.
5. Une commande envoie une **notification** au **gérant** et à l'**associé du rayon** concerné.
6. Le **personnel crée l'accès** depuis la fiche du client ; l'identifiant est le **numéro de téléphone** ; un **code
   provisoire** part au client **par WhatsApp en un clic** ; à sa première connexion, le client **choisit son mot de
   passe** ; s'il l'oublie, le personnel lui donne un nouveau code provisoire.
7. **Demande de réservation** : le client choisit le jour, l'heure d'arrivée, la durée et le nombre de personnes, parmi
   les créneaux libres (battement compris) ; la demande est « En attente » et prévient le personnel ; le personnel
   confirme ou refuse (avec un mot au client) ; à la confirmation, la réservation est créée comme aujourd'hui (heures
   d'abonnement, puis crédit carte) ; le client voit « Confirmée » ou « Refusée ».
8. **Acompte d'une demande de 3 h ou plus** (2026-11-09) : la règle actuelle est gardée. Si le crédit de la carte couvre
   l'acompte, il est pris dessus à la confirmation. Sinon, la demande **reste « En attente »** jusqu'à ce que le client
   paie l'acompte au club ou recharge sa carte ; aucune réservation n'est confirmée sans son acompte.

## Objectifs

### A. Côté client (sur son téléphone)

1. **Connexion** à une adresse à part, par exemple `…/client` **(mon choix)**, avec une page de connexion distincte de
   celle du personnel. Identifiant = numéro de téléphone, puis mot de passe.
2. **Première connexion** avec le code provisoire : le client doit choisir son mot de passe avant tout le reste (au moins
   10 caractères, la règle déjà en place pour le personnel **(mon choix)**).
3. **Mon compte** (maquette validée le 2026-11-09) :
   - **Membre** : crédit carte en FCFA ; heures d'abonnement restantes et date de fin de l'abonnement.
   - **Client régulier** : ce qu'il doit, son plafond et le crédit encore disponible (bloc caché si son plafond vaut 0
     et qu'il ne doit rien) **(mon choix)**.
   - **En séance** (membre) : salle, heure de fin prévue, compte à rebours seconde par seconde, calé sur l'heure du
     serveur.
   - **Mes réservations** (membre) : demandes en attente, réservations à venir (confirmées), demandes refusées avec le
     mot du personnel ; les réservations passées sont dans l'historique.
4. **Historique** : achats Boutique, consommations en séance, séances, rechargements de carte, règlements de crédit,
   annulations et remboursements, du plus récent au plus ancien. Chaque ligne payée ouvre son **ticket**, que le client
   peut imprimer ou télécharger. Une impression ou un téléchargement par le client est noté à part, comme « copie
   client » : il ne prend pas de numéro de duplicata et ne compte pas dans le signal « ticket remis 3 fois ou plus » de
   l'historique des tickets ; simplement regarder le ticket n'est pas noté **(mon choix)**.
5. **Boutique** : produits actifs des rayons Cigares et Champagne, avec photo, nom, description et prix. Une commande
   **met de côté** ses produits : la quantité qu'on peut commander est le stock moins ce que les commandes ouvertes (En
   attente, Prête) ont déjà mis de côté. Un produit dont rien ne reste est affiché « Indisponible » **(mon choix : le
   client vient chercher ce qu'il a commandé, il doit le trouver)**. Le stock réel ne baisse qu'à la vente au comptoir ;
   une commande annulée ou retirée libère ce qu'elle mettait de côté. Le stock exact n'est pas montré **(mon choix)**.
   Le client remplit un panier (cigares et champagne mêlés possibles) et valide « Commander · à retirer au club ».
6. **Mes commandes** : état de chaque commande (En attente, Prête au club, Retirée, Annulée). Le client peut **annuler**
   une commande tant qu'elle est « En attente » **(mon choix)**.
7. **Demander une réservation** : comme la décision 7.
   - Qui peut demander : un membre dont la fiche est active et qui a au moins une carte active ; avec ou sans
     abonnement, puisque le crédit carte peut payer le temps **(mon choix)**.
   - Créneaux proposés : par demi-heure, au plus tôt 1 heure après la demande, au plus tard 30 jours après, dans les
     limites qui s'appliquent déjà au personnel (horaires de la salle, fermeture, battement) **(mon choix)**. Le client
     ne voit jamais qui occupe un créneau.
   - Avant d'envoyer, le client voit une estimation : heures d'abonnement utilisées, montant payé par la carte, acompte
     s'il y en a un **(mon choix)**.
   - Le client peut annuler sa demande tant qu'elle est « En attente » ; une réservation confirmée s'annule en appelant
     le club, comme aujourd'hui **(mon choix)**.
8. **Se déconnecter**, et **changer son mot de passe** (avec l'ancien).

### B. Côté personnel

1. **Fiche du client** (membre ou client régulier), bloc « Accès client » :
   - « Créer l'accès client » : identifiant = téléphone de la fiche (normalisé, voir Règles) ; le site fabrique un code
     provisoire, l'affiche une seule fois et propose « Envoyer sur WhatsApp » (lien wa.me, message prérempli avec
     l'adresse de l'espace, l'identifiant et le code), comme les confirmations de réservation.
   - « Nouveau code provisoire » (mot de passe oublié) : l'ancien mot de passe ne marche plus et toutes les sessions du
     client sont fermées.
   - « Couper l'accès » / « Rétablir l'accès ».
   - L'état de l'accès : pas d'accès, en attente de première connexion, actif (dernière connexion le …), coupé.
   - Tout le personnel peut faire ces actions, le gérant compris **(mon choix)**.
2. **Page « Commandes »** (nouvelle entrée du menu, avec un compteur de ce qui attend) :
   - les **commandes** en attente et prêtes, les plus anciennes en premier, avec le client, les produits, le rayon ;
   - les **demandes de réservation** en attente.
   - Tout le personnel voit toutes les commandes et toutes les demandes ; un associé n'encaisse que les produits de son
     rayon (règle déjà en place). Le compteur montre tout pour le gérant et l'administrateur, et pour un associé les
     commandes qui touchent son rayon plus les demandes de réservation **(mon choix)**.
3. **Traiter une commande** : « Marquer prête » (facultatif), puis « Encaisser » : le panneau de vente Boutique habituel
   s'ouvre, déjà rempli avec le client et les produits d'**un rayon** ; le personnel peut changer les quantités au
   comptoir ; le paiement se fait comme pour toute vente (espèces, MTN MoMo, crédit carte d'un membre, « à crédit » pour
   un client régulier sous son plafond). Une commande à deux rayons donne deux ventes et deux tickets. Quand toutes ses
   ventes sont faites, la commande est « Retirée ». Le prix est celui du jour de la vente **(mon choix)**.
   « Annuler la commande » avec un motif, visible du client. Pas d'expiration automatique : la page montre depuis quand
   la commande attend, et le personnel annule une commande oubliée pour libérer les produits **(mon choix)**.
   **Retrait partiel** : si le client ne prend pas tout, le personnel clôt la commande après la ou les ventes faites ;
   les lignes non prises sont marquées « non retiré » et libérées **(mon choix)**. L'annulation plus tard d'une vente
   liée ne rouvre pas la commande (la vente s'annule comme toute vente Boutique) **(mon choix)**.
4. **Traiter une demande de réservation** : « Confirmer » ouvre le formulaire de réservation habituel, déjà rempli
   (membre, salle, jour, heure, durée, personnes), avec ses règles (acompte de 3 h ou plus, battement, tarifs) ; une fois
   la réservation créée, la demande passe « Confirmée » et pointe vers elle. « Refuser » demande un mot pour le client.
   Une demande en attente ne bloque pas le créneau : si le créneau a été pris entre-temps, la confirmation est refusée
   comme aujourd'hui et le personnel refuse ou propose autre chose **(mon choix)**.
   **Acompte** (décision 8) : pour 3 h ou plus, la confirmation prend l'acompte sur la carte si elle le couvre ; sinon
   elle est refusée (`ACOMPTE_REQUIS`, comme aujourd'hui) et la demande reste « En attente ». Le personnel peut aussi
   confirmer quand le client paie l'acompte au comptoir, avec le formulaire habituel. Le client voit alors sur sa
   demande « En attente — acompte de X à payer au club ou en rechargeant votre carte » **(mon choix pour le texte)**.
5. **Après une action**, un bouton « Prévenir sur WhatsApp » (un clic, message prérempli) : commande prête, réservation
   confirmée ou refusée **(mon choix)**. Aucun message automatique.
6. **Notifications push** sur les appareils du personnel (téléphone Android, ordinateur, montre reliée au téléphone ;
   iPhone une fois le site ajouté à l'écran d'accueil) :
   - chaque membre du personnel les active **sur chaque appareil** (« Activer les notifications sur cet appareil ») et
     peut les couper ;
   - **nouvelle commande** : le gérant (tous les comptes gérant actifs) et l'associé de chaque rayon de la commande ;
   - **nouvelle demande de réservation** : le gérant et les deux associés **(mon choix)** ;
   - l'administrateur n'en reçoit pas **(mon choix)** ;
   - le texte : « Nouvelle commande Boutique — Cigares — Paul MBEMBA — 3 articles » ; un toucher ouvre la page
     Commandes.
   - Une notification qui échoue ne bloque jamais la commande ni la demande.

## Non-objectifs

- Paiement en ligne, livraison, retrait ailleurs qu'au club.
- Inscription du client par lui-même, mot de passe oublié sans passer par le personnel, connexion par e-mail.
- Notifications push vers les clients (ils voient l'état dans leur espace ; le personnel peut les prévenir sur WhatsApp).
- Espace pour les clients journaliers.
- Réservation confirmée automatiquement, sans le personnel.
- Les « autres boissons » à la Boutique en ligne.

## Anti-objectifs (ce serait un échec même si « ça marche »)

- Un client qui voit, même une seconde, les données d'un autre client, ou une page du personnel.
- Une session de client acceptée par une route du personnel, ou l'inverse.
- Un mot de passe ou un code provisoire gardé en clair, affiché deux fois, ou écrit dans le journal.
- Des informations internes montrées au client : notes du personnel, plafonds des autres, marges, stock exact, noms du
  personnel en dehors de ce que le ticket imprime déjà.
- Une commande qui fait bouger le stock ou l'argent avant la vente au comptoir.
- Une notification envoyée à l'associé de l'autre rayon, ou à un compte désactivé.
- Une clé secrète des notifications écrite dans le dépôt (il est public).

## Règles

### Identifiants et connexion

- Un accès par fiche au plus. L'identifiant est le téléphone de la fiche, gardé en chiffres seuls ; un numéro local
  congolais reçoit +242, comme pour WhatsApp **(mon choix)**. Il est unique parmi les accès ; s'il est déjà pris, la
  création est refusée avec un message clair **(mon choix)**. Il est copié à la création : changer plus tard le téléphone
  de la fiche ne le change pas ; « Nouveau code provisoire » reprend le téléphone du moment **(mon choix)**.
- Code provisoire : 8 caractères faciles à lire (sans 0/O, 1/l), haché comme un mot de passe, valable **7 jours**
  **(mon choix)**, une seule utilisation : il ouvre seulement l'écran « Choisissez votre mot de passe ».
- Hachage : le même que le personnel (`hashPassword` / `verifyPassword`). Jamais de mot de passe ni de code en clair dans
  la base, les réponses (sauf le code provisoire, une fois, au membre du personnel qui le crée) ou le journal.
- Limitation : comme le personnel (5 échecs de suite par adresse + identifiant bloquent une minute), même temps de
  réponse que l'identifiant existe ou non, même message d'erreur dans les deux cas.
- Session client : sa propre table et son propre cookie (`HttpOnly`, `Secure`, `SameSite`), limités aux routes du client ;
  durée **30 jours** **(mon choix : le client se connecte depuis son téléphone)**. Déconnexion = session effacée.
- Un accès coupé, une fiche désactivée, ou un nouveau code provisoire ferment toutes les sessions du client. Un client
  régulier passé en membre garde son accès (même fiche).

### Séparation et droits

- Toutes les routes du client sont sous un préfixe à elles (par exemple `/api/client/…`) et vont toujours au vrai club,
  jamais à l'espace démo.
- Une route du client ne lit **jamais** un identifiant de client venant de l'adresse ou du corps : le client est celui de
  la session. Tout autre identifiant (ticket, commande, demande, photo de produit) est vérifié comme lui appartenant ou lui
  étant ouvert ; sinon la réponse est « introuvable ».
- Les réponses au client sont construites champ par champ (liste blanche) : elles ne réutilisent pas telles quelles les
  réponses du personnel (`memberDetail` contient par exemple les notes du personnel).
- Les mêmes protections que le reste de l'API : JSON obligatoire et contrôle de l'origine pour toute écriture, en-têtes
  de sécurité, taille de corps limitée.
- Limites contre les abus **(mon choix)** : 3 commandes ouvertes et 3 demandes de réservation en attente au plus par
  client ; 20 articles au plus par ligne de commande.

### Journal

- Créer, couper, rétablir un accès, donner un code provisoire, traiter une commande ou une demande : journalisé avec le
  membre du personnel.
- Commander, annuler, demander une réservation : journalisé comme fait « par le client ».

### Mode démo

- Les accès clients n'existent que dans le vrai club, comme les comptes du personnel : dans l'espace démo, « Créer
  l'accès client » est refusé et la page Commandes reste vide **(mon choix)**.
- « Effacer toutes les données » efface aussi les accès, les sessions, les commandes et les demandes des clients.

## Ce qui est laissé au développeur

- Le schéma (migration **V24**, après V23) : tables des accès, des sessions client, des commandes et de leurs lignes,
  des demandes de réservation, des abonnements push.
- La forme de l'adresse de l'espace client (chemin à part ou route de l'application) et le découpage en pages.
- Les notifications push : Web Push avec clés VAPID. La clé privée est un **secret du Worker** (comme `SETUP_TOKEN`),
  jamais dans le dépôt ; le site gagne un manifeste et un service worker (nécessaires pour l'iPhone et le push). Le
  chiffrement des messages avec WebCrypto, ou une petite bibliothèque compatible Workers, au choix du développeur.
- Le rafraîchissement de la page Commandes et du compteur (par exemple toutes les 30 secondes, page ouverte).
- La façon de garder les écritures du client idempotentes (la table `idempotency_keys` pointe vers `users`).
- Le calcul des créneaux libres (réutiliser `planReservation` / `quoteReservation`, sans montrer qui occupe un créneau).
- L'ordre de construction, pourvu que chaque étape reste testable.

## Vérification attendue

- Tests : hachage et code provisoire ; limitation des tentatives ; une session client refusée sur chaque route du
  personnel et une session du personnel refusée sur chaque route du client ; un client ne voit ni ne touche les
  données d'un autre (tickets, commandes, demandes) ; commande → vente(s) → « Retirée » sans mouvement de stock avant la
  vente ; demande → réservation ; destinataires des notifications selon le rayon.
- Dans le navigateur (serveur de dev) : le personnel crée un accès, le client se connecte, choisit son mot de passe,
  voit son compte, commande ; la commande apparaît côté personnel et devient une vente.
- Avant la mise en ligne : créer le secret VAPID ; activer les notifications sur le téléphone du gérant et des associés.

## Choix faits pendant la conception (à vérifier à la relecture)

Tous les points marqués **(mon choix)** ci-dessus, en particulier : l'adresse `…/client` ; le mot de passe de 10
caractères ; le code provisoire de 7 jours ; la session de 30 jours ; les produits mis de côté par une commande ouverte ;
le stock exact caché ; l'annulation par le client tant que « En attente » ; le prix du jour de la vente ; pas
d'expiration des commandes ; le retrait partiel ; la « copie client » des tickets notée à part ; qui peut demander une
réservation ; les créneaux de 1 heure à 30 jours ; l'estimation avant la demande ; une demande qui ne bloque pas le
créneau ; ce que voit un associé sur la page Commandes ; les demandes de réservation notifiées aux deux associés ;
l'administrateur sans notification ; WhatsApp en un clic après chaque traitement ; les limites contre les abus.
