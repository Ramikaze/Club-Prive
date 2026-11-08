# Vérification de la caisse journalière

Date : 2026-11-08. Statut : validé par le propriétaire le 2026-11-08 (y compris les points « (mon choix) »).

## Pourquoi

Aujourd'hui, les tuiles de « Soldes » (page Caisse) ajoutent l'argent d'une journée dès qu'il est encaissé, avant que
quiconque ait compté la caisse. Le propriétaire veut que l'argent d'une journée n'entre dans le solde qu'une fois la
caisse de cette journée **vérifiée et validée** : un solde qui ne contient que de l'argent contrôlé.

Il veut aussi voir, dans la même tuile, l'argent **en attente** (pas encore vérifié) et le **total**, « afin de ne pas
avoir à faire de calculs sur l'argent total actuellement dans les caisses ».

## Ce qui existe déjà

- « Fermer la caisse » (`src/components/cash/CloseDay.jsx`, `closeDay` dans `worker/ledger.js`, table `day_closings`),
  ouvert à tous les rôles connectés : 1. pointer les tickets du jour (motif pour ceux non pointés), 2. compter chaque
  caisse et compte (espèces billet par billet), 3. valider (motif pour un écart ; l'écart est enregistré comme
  « Écart de caisse »). La journée est alors verrouillée (`assertOpen` refuse tout mouvement daté de ce jour) jusqu'à
  sa réouverture par un administrateur ou un associé, avec motif (`reopenDay`, route réservée à `CLUB`).
- « Soldes » : six tuiles (`caisseBalances` dans `worker/caisses.js`, `caisseTiles` dans
  `src/components/cash/caisses.js`) : Fond de caisse, Crédit sur les cartes, Réservation de séance, Champagne et autres
  boissons, Cigare, Solde en caisse. Elles comptent tous les mouvements depuis la date du fond.
- Règle « aucune caisse dans le négatif » : `assertCaisseCovers` refuse une dépense, un paiement fournisseur ou une
  prise de bénéfices plus grande que le solde de la caisse.

## Décisions du propriétaire (2026-11-08)

1. **L'argent d'une journée n'entre dans le solde qu'après validation.** Tant que la journée n'est pas validée, son
   argent est « en attente ».
2. **Validation en deux temps.** Le soir, le gérant ferme la caisse comme aujourd'hui (tickets, comptage, écarts).
   Ensuite **un associé ou l'administrateur** vérifie et valide. C'est cette seconde validation qui fait passer
   l'argent dans le solde.
3. **La vérification porte sur toute la journée**, en une fois (pas caisse par caisse). Un seul associé ou
   l'administrateur suffit.
4. **Affichage retenu : maquette A** (`.superpowers/brainstorm/70638-1794134215/content/solde-en-attente-v2.html`,
   non versionnée) :
   - chaque caisse (Réservation de séance, Champagne et autres boissons, Cigare) montre en gros son **solde validé** et,
     juste dessous, en doré, **« +X en attente »** (ou « −X en attente » si la journée en attente est négative) ;
   - la tuile « Solde en caisse » montre le solde validé (« validé au 7 nov. »), puis « +X en attente », un trait, et
     **« En tout »** : l'argent réellement présent maintenant ;
   - rien « en attente » : la ligne n'apparaît pas.

## Règles détaillées

Les points marqués **(mon choix)** n'ont pas été tranchés par le propriétaire : il les vérifie en relisant.

### Journées et états

Une journée (jour d'activité, `bizDay`) est dans l'un de ces états :

| État | Sens | Son argent |
| --- | --- | --- |
| Ouverte | pas encore fermée | en attente |
| Fermée | fermée par le gérant (ou un autre), pas encore vérifiée | en attente |
| Validée | vérifiée et validée par un associé ou l'administrateur | dans le solde |

- **(mon choix)** Une journée sans aucun mouvement d'argent n'a rien en attente : elle n'a besoin ni d'être fermée ni
  validée et n'apparaît nulle part.
- **(mon choix) Le passé** : toutes les journées **avant le jour de la mise en service** comptent comme validées.
  Sinon tout l'historique tomberait « en attente » au déploiement. Le jour de mise en service est enregistré une fois
  (meta), au premier démarrage avec la migration.
- **(mon choix)** Plusieurs journées non validées **s'additionnent** dans « en attente » jusqu'à leur validation.
- **(mon choix) Les journées se valident dans l'ordre des dates**, la plus ancienne d'abord. Ainsi le validé est
  toujours continu jusqu'à une date, et « validé au 7 nov. » reste exact. Dans la bande, seule la plus ancienne journée
  en attente a le bouton « Vérifier » ; les suivantes affichent « après le 6 nov. ». Le serveur refuse aussi de valider
  une journée tant qu'une journée plus ancienne avec des mouvements n'est pas validée.
- Une journée validée reste verrouillée comme une journée fermée.

### Ce qui est « en attente »

- **(mon choix)** Le net de la journée par caisse : ce qui a été vendu moins ce qui a été dépensé, plus les apports,
  moins les bénéfices pris, exactement comme `caisseBalances` le calcule aujourd'hui, mais limité aux journées non
  validées. Le solde validé est le même calcul limité aux journées validées. Validé + en attente = le solde
  d'aujourd'hui, à l'unité.
- **(mon choix)** Le Fond de caisse et le Crédit sur les cartes ne changent pas : ce ne sont pas des recettes d'une
  caisse. « En attente » de la tuile « Solde en caisse » = la somme des « en attente » des trois caisses ; « En tout »
  = le solde en caisse actuel (inchangé) ; le validé = En tout − en attente.
- Les « Écart de caisse » enregistrés à la fermeture ou par « Compter la caisse » sont des mouvements de leur journée :
  ils attendent avec elle.

### La vérification

- Où : sur la page Caisse des administrateurs et associés. **(mon choix)** Une bande dans la carte « Soldes », sous les
  tuiles, quand au moins une journée attend : « 2 journées à vérifier », chaque journée avec son état, son net en
  attente et un bouton. Une journée encore ouverte (pas fermée) montre « Pas encore fermée » et le bouton « Fermer la
  caisse » (le dialogue existant) ; une journée fermée montre « Vérifier ».
- **(mon choix)** Le dialogue « Vérifier la caisse du … » montre ce que la fermeture a enregistré : qui a fermé et quand,
  chaque caisse ou compte avec attendu / compté / écart, le motif d'écart, le billetage, les tickets non pointés et
  leur motif, et le net de la journée par caisse (Réservation de séance, Champagne et autres boissons, Cigare). Deux
  boutons :
  - **« Valider la journée »** : l'argent passe dans le solde. Tracé dans le journal d'audit (qui, quand, jour, net
    par caisse).
  - **« Rouvrir pour corriger »** : rouvre la journée avec un motif obligatoire (la réouverture existante). **C'est
    l'associé (ou l'administrateur) qui corrige lui-même** (décision du propriétaire, 2026-11-08) : il saisit ou annule
    les mouvements datés de cette journée, la referme (le dialogue « Fermer la caisse » existant, pour ce jour-là), puis
    la valide. Le gérant n'a rien de nouveau à faire : il ne travaille que sur la journée en cours.
  - Une journée passée ne peut plus être recomptée (la caisse contient déjà l'argent des jours suivants) : en la
    refermant, l'associé reporte les montants comptés par le gérant ou corrige l'écart avec un motif.
- **(mon choix)** La même personne peut fermer et valider (si le gérant est absent, un associé fait les deux). C'est
  tracé, rien n'est bloqué.
- **(mon choix)** Rouvrir une journée **validée** reste possible (administrateur ou associé, motif obligatoire) : la
  validation est effacée, son argent revient « en attente », c'est tracé.
- Le gérant ne voit pas les soldes. **(mon choix)** Après sa fermeture, sa bande dit « Caisse fermée … · en attente de
  vérification par un associé », puis « vérifiée par X » une fois validée.
- **(mon choix)** Sur l'Accueil des administrateurs et associés, une alerte « Caisse du 8 nov. à vérifier » mène à la
  page Caisse.

### Payer un fournisseur, prendre des bénéfices, dépenser

- **(mon choix)** On ne dépense jamais l'argent en attente. Ce qu'une caisse peut payer = son solde validé, diminué de
  ce qui est en attente si ce net est négatif : `disponible = validé + min(0, en attente)`. Exemple : Cigare validé
  640 000, aujourd'hui vendu 90 000 → disponible 640 000. Paiement fournisseur 600 000 accepté → en attente −510 000,
  disponible 130 000. Le message d'erreur dit le disponible.
- **(mon choix) Quels contrôles passent au « disponible »** : seulement l'argent qu'une personne décide de sortir :
  les dépenses (y compris celles du gérant), les paiements fournisseurs et les bénéfices pris. Les corrections et
  retours d'argent gardent le contrôle actuel sur le solde complet (validé + en attente) : le manque constaté à la
  fermeture ou par « Compter la caisse » (`recordCashGap`), les remboursements, l'annulation d'un encaissement, d'un
  règlement ou d'une vente à crédit. Sinon une journée pourrait ne jamais se fermer (un manque refusé faute de solde
  validé), donc ne jamais être validée.

### Vue d'une période passée

- **(mon choix)** Sur une période passée (`to` avant aujourd'hui), les tuiles montrent le validé et l'en attente au
  jour `to`, d'après les validations connues aujourd'hui. Pas de boutons (comme aujourd'hui).

## Hors champ

- Trésorerie, Grand livre, Clôture mensuelle, exports : inchangés (ils montrent tous les mouvements).
- Les notifications (téléphone, ordinateur) : projet séparé, à venir avec l'iPad client.
- Le crédit sur les cartes reste tel quel.

## Ce qui est laissé au constructeur

- Le schéma : par exemple deux colonnes `verified_at`, `verified_by` sur `day_closings` (migration V23, après V22) et
  une clé meta pour le jour de mise en service. Vérifier qu'aucune autre branche en cours n'a pris V23.
- La route de validation (par exemple `POST /api/day-closing/:day/verify`, réservée à `CLUB`) et la forme de
  `GET /api/caisses` (validé, en attente, journées à vérifier).
- Les textes exacts, la mise en page fine de la bande, les tests (serveur : partage validé / en attente, droits,
  passé, réouverture, disponible ; front : `caisseTiles`).
- Le mode démo suit les mêmes règles.
