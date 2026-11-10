# Produits offerts (« Offert »)

Date : 2026-11-10. Statut : à valider par l'utilisateur. Le club n'est pas encore ouvert : l'utilisateur a demandé de
« mettre en place » une première façon de faire, qu'il ajustera pendant les tests réels (à partir du jeudi 2026-11-12).
Chaque choix qui n'a pas été dit par le propriétaire est marqué **(mon choix)**.

## Pourquoi

Réunion des associés du 2026-11-06 : un produit « Offert » sort du stock, est valorisé au **prix de revient**, sans
encaissement, et il est **suivi par associé**. Le club veut savoir, pour chaque associé, ce qu'il a donné et combien
cela a coûté, sans que l'argent des caisses bouge.

Précisions de l'utilisateur (2026-11-10) :

- seuls les **associés** peuvent offrir (ni le gérant, ni l'administrateur) ;
- le **nom de la personne qui a offert** est toujours noté ;
- l'associé des cigares n'offre que des **cigares** ; l'associé des boissons n'offre que des **boissons** (champagne et
  autres boissons).

## Ce qui existe déjà

- `products` : prix de vente (`price`), stock (`stock_qty`). **Aucun prix de revient** n'existe aujourd'hui.
- `stock_movements` : types `stock_initial`, `entree`, `vente`, `annulation_vente`, `retour`, `ajustement` (contrainte
  CHECK). `Club.moveStock` refuse un stock négatif (409 `STOCK_INSUFFISANT`).
- Rôles (`shared/roles.js`) : un associé a un rayon (`cigares` ou `alcool`) ; `accountOfCategory` envoie `cigare` vers
  `cigares`, `bouteille` (champagne) et `boisson` vers `alcool` ; `ownsAccount(user, account)`.
- Fiche produit (`src/pages/Products.jsx`) : boutons « Entrée de stock » et « Ajuster le stock » (`StockButtons`,
  `canStockProduct`), fenêtre « Historique du stock ».
- `assertOpen(day, what)` refuse une écriture un jour dont la caisse est fermée ou un mois clôturé.

## Ce qui change

### 1. Prix de revient du produit (mon choix)

- Nouvelle donnée du produit : **prix de revient unitaire**, facultatif (vide = « pas encore connu »). Il est saisi et
  affiché en FCFA, et stocké exactement comme le prix de vente (`price`, centimes entiers), pour que l'affichage, les
  totaux et le futur import Excel concordent.
- Saisi dans le formulaire de modification du produit, par l'administrateur ou l'associé du rayon du produit.
- Visible de l'administrateur et des associés ; **le gérant ne le voit pas** (mon choix : c'est une donnée de marge).
- L'import Excel du propriétaire (colonne « prix de revient ») le remplira plus tard ; il n'est pas dans cette spec.

### 2. Offrir un produit

- Un bouton **« Offrir »** sur la fiche produit et sur la ligne du produit dans la liste Stocks, visible **seulement pour
  l'associé du rayon du produit** (mon choix pour l'emplacement : à côté des boutons de stock existants).
- La fenêtre « Offrir » demande :
  - la **quantité** (nombre entier, au moins 1, au plus le stock) ;
  - **offert à** (facultatif, mon choix) : un membre ou un client régulier choisi dans la liste, ou personne
    (client de passage) ;
  - un **motif** (facultatif, texte court, mon choix).
- Ce qui est enregistré :
  - le stock baisse de la quantité (mouvement de stock de type « offert ») ;
  - une ligne « offert » avec : le produit, la quantité, le **prix de revient unitaire au moment du cadeau** (copié ; peut
    être vide si le produit n'en a pas encore), le prix de vente unitaire au moment du cadeau (pour information), le
    rayon, l'associé qui offre (son compte **et son nom copié au moment du cadeau**, pour que le nom reste même si le
    compte est renommé ou désactivé, mon choix), le bénéficiaire éventuel, le motif, le jour de caisse et l'heure ;
  - le cadeau est toujours daté du **jour de caisse en cours** : pas de cadeau antidaté (mon choix) ;
  - une ligne dans le journal des opérations.
- **Aucun argent** : pas de paiement, pas de ticket, rien dans les caisses, ni recette ni dépense (mon choix pour le
  ticket).
- Refus (le serveur refuse, même si on passe par l'API) :
  - le gérant et l'administrateur : 403 (l'administrateur ne peut pas offrir, mon choix tiré de « seuls les
    associés ») ;
  - un associé pour un produit de l'autre rayon : 403 ;
  - stock insuffisant : 409 `STOCK_INSUFFISANT` ;
  - produit désactivé : refus ;
  - jour dont la caisse est fermée, ou mois clôturé : 409, comme les autres écritures (`assertOpen`, mon choix).
- Quand le produit n'a pas de prix de revient : le cadeau est accepté, et la fenêtre prévient « Prix de revient à
  renseigner : ce cadeau sera compté à 0 tant qu'il manque » (mon choix). Le prix de revient renseigné plus tard ne
  change pas les cadeaux déjà faits (le prix est copié au moment du cadeau, mon choix).

### 3. Annuler un cadeau (erreur de saisie)

- Possible pour l'associé qui l'a fait, tant que son compte est actif et toujours associé de ce rayon, ou pour
  l'administrateur (mon choix), avec un motif obligatoire. Si l'associé a été désactivé ou a changé de rayon, seul
  l'administrateur peut annuler.
- Le stock revient (mouvement de type « annulation d'offert »). La ligne reste visible, marquée « annulé ».
- Refusée si la caisse du jour est fermée ou le mois clôturé (mon choix, comme ci-dessus).

### 4. Suivi par associé : page « Offerts »

- Un nouvel onglet **« Offerts »** dans la Caisse, à côté de « Boutique » (mon choix), pour l'administrateur et les
  associés. Le gérant n'y a pas accès (mon choix).
- Choix de la période comme ailleurs (Aujourd'hui, 7 jours, Mois en cours, Mois précédent, Du / au).
- En haut, **par associé** : le total offert **au prix de revient**, le nombre de produits offerts, et le nombre de
  cadeaux dont le prix de revient manque.
- Dessous, la liste : date et heure, produit, quantité, valeur au prix de revient (ou « prix de revient à renseigner »),
  valeur au prix de vente (pour information), offert à, offert par, motif, état (annulé ou non), et le bouton « Annuler
  le cadeau » pour qui en a le droit.
- Un associé ne voit que les cadeaux de **son** rayon ; l'administrateur voit les deux.
- Les cadeaux annulés restent listés mais ne comptent pas dans les totaux.

### 5. Ailleurs dans l'application

- L'« Historique du stock » d'un produit montre les mouvements « Offert » et « Offert annulé », avec le nom de la
  personne.
- L'espace démo fonctionne de la même façon, avec ses données fictives (mon choix).
- Rien ne change dans la clôture mensuelle (mon choix ; à ajouter plus tard si le propriétaire le demande).

## Non-objectifs (cette version)

- Pas de remise partielle (un produit vendu moins cher) : seulement le cadeau total.
- Pas de cadeau ajouté dans la note d'une séance au salon (une ligne à 0 FCFA) (mon choix ; à revoir après les tests).
- Pas de choix « Offert » dans la vente Boutique (mon choix ; à revoir après les tests).
- Pas de plafond ni de budget mensuel d'offerts (mon choix).
- Pas d'import Excel du prix de revient.

## Ce qui serait un échec, même si « ça marche »

- Un cadeau qui fait bouger l'argent d'une caisse (recette, dépense, solde).
- Un associé qui peut offrir dans le rayon de l'autre, ou un gérant qui peut offrir, même en appelant l'API directement.
- Un cadeau dont on ne sait pas qui l'a fait.
- Un cadeau qui fait passer le stock sous zéro.
- Un total « au prix de revient » qui change tout seul quand le prix de revient du produit est modifié plus tard.

## Contraintes

- Durable Object SQLite, migrations dans `worker/schema.js` (la prochaine est V28). Une contrainte CHECK ne se modifie
  pas en SQLite : ajouter un type de mouvement de stock demande de reconstruire la table, comme l'ont fait des
  migrations précédentes.
- Montants en centimes (entiers), comme partout.
- Tests serveur avec `node:test` et `test/harness.js` ; pas d'outillage de test d'interface.
- Textes en français, vouvoiement, sans jargon.
- Le dépôt est public : aucun nom ni numéro réel dans le code ou les tests.

## Laissé au constructeur

- La forme exacte des tables et de la migration V28 (nouvelle table des cadeaux, lien avec le mouvement de stock), les
  noms des routes, la place exacte des boutons, les noms des tests.

## Tests attendus

- Un associé offre un produit de son rayon : stock baissé, ligne enregistrée avec son nom, le prix de revient copié,
  aucune caisse ne bouge (soldes identiques avant et après).
- Refus : gérant, administrateur, associé de l'autre rayon (403) ; stock insuffisant (409) ; produit désactivé ; jour
  fermé et mois clôturé (409) ; rien n'est écrit dans chaque cas.
- Annulation : le stock revient, la ligne est marquée annulée, elle ne compte plus dans les totaux ; refus pour un autre
  associé et pour le gérant ; une deuxième annulation est refusée.
- Le prix de revient modifié après coup ne change pas la valeur des cadeaux déjà faits.
- La page « Offerts » : un associé ne voit que son rayon, l'administrateur les deux ; totaux par associé corrects ;
  le gérant est refusé (403).
- Le gérant ne reçoit pas le prix de revient dans les réponses des produits (liste, fiche, historique du stock, espace
  démo compris) : une seule fonction centrale le retire, plutôt qu'un oubli possible route par route.
