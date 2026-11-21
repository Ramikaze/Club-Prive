# Remise et prix par lot (Boutique)

Date : 2026-11-21. Statut : à valider par l'utilisateur. Chaque choix qui n'a pas été dit par l'utilisateur est marqué
**(mon choix)**.

## Pourquoi

Demande de l'utilisateur (2026-11-21), à partir de l'écran « Vente de cigares » de la Boutique :

- pouvoir **appliquer une remise**, soit **en pourcentage**, soit **en montant à retirer du total** ;
- le **coupe-cigare** coûte 5 000 FCFA l'unité, mais **3 coupes reviennent à 10 000** ; au-delà de 3, **chaque coupe
  en plus est facturée 3 000** : 4 coupes = 13 000, 5 coupes = 16 000, et ainsi de suite ;
- ces changements valent **aussi chez le gérant**.

Réponses de l'utilisateur pendant la conception :

- remise et prix par lot : **la Boutique uniquement** (l'écran Vente) ;
- façon de faire : **l'option A** (chaque ligne de vente garde le montant vraiment payé, voir « Façons de faire ») ;
- contrôle des remises (question posée après relecture, en rappelant que seuls les associés peuvent « Offrir ») : un
  **plafond pour le gérant**, 10 % du total au départ, réglable dans Paramètres ; l'administrateur et les associés
  sans plafond.

Grille du coupe-cigare telle que dite (2 coupes coûtent autant que 3 : c'est la grille de l'utilisateur, gardée telle
quelle) :

| Coupes | 1 | 2 | 3 | 4 | 5 | 6 | n ≥ 3 |
|---|---|---|---|---|---|---|---|
| Prix | 5 000 | 10 000 | 10 000 | 13 000 | 16 000 | 19 000 | 10 000 + (n − 3) × 3 000 |

## Ce qui existe déjà

- `worker/shop.js` `createShopSale` : une vente Boutique = **un seul rayon** (`cigares` ou `alcool`, donc un seul compte),
  1 à 30 produits, quantité 1 à 99. Une ligne `charges` par produit (`insertCharge` : `amount = quantity × unit_price`,
  `unit_price = products.price`), sortie de stock par ligne (`moveStock`), puis `recordPayment` (la carte du membre
  d'abord) ou, pour un client régulier, vente **à crédit** (`on_credit`, plafond vérifié par `assertCreditAllowed` sur
  le total). Vendeurs : `canSellIn` (administrateur, associé du rayon, gérant dans les deux rayons).
- `src/components/shop/SalePanel.jsx` : acheteur, lignes (− quantité +, montant = prix × quantité), « Total », moyens de
  paiement, bouton « Encaisser X ». `src/pages/Shop.jsx` garde un panier par rayon dans le store (`shopCarts` : `key`,
  `lines`, `buyer`, `order_id`) et affiche sur téléphone « Panier · n · montant » (prix × quantité).
- Table `charges` (V1) : `CHECK (amount = quantity * unit_price)` et `CHECK (amount > 0)`. **SQLite ne peut pas retirer
  un CHECK** : il faut reconstruire la table. Colonnes ajoutées depuis : `consumer_member_id` (V6), `deposit` (V12),
  `shop_sale_id` (V18), `settled` (V21), `carryover` (V29), `unit_cost` (V30). Index : `charges_reservation`,
  `charges_member`, `charges_created`, `charges_consumer`, `charges_shop_sale`, `charges_product`. Aucun déclencheur.
- Tables qui pointent vers `charges(id)` : `payment_allocations`, `refunds`, `stock_movements`. **Aucune clé étrangère
  du schéma n'a d'action `ON DELETE` / `ON UPDATE`.** Reconstructions déjà faites de la même façon : V15
  (`reservations`), V18 (`users`), V19 (`products`), V20 (`ledger_entries`), V21 (`payment_allocations`, `refunds`),
  V28 (`stock_movements`) : `PRAGMA defer_foreign_keys = ON`, copie simple, `DROP`, `CREATE`, réinsertion avec les
  mêmes `id` (le commentaire de V15 explique pourquoi on ne renomme pas).
- Montants en **centièmes** (`UM = 100`) ; le FCFA s'affiche sans décimales.
- Tout ce qui compte l'argent lit `charges.amount` ou les montants de `payment_allocations` / `payments` (une
  quarantaine de `SUM(...amount...)` dans `worker/`) : recette du jour, argent encaissé, Caisse › Boutique
  (`shopSummary`), bénéfice réel (`worker/profit.js` : ventes = `amount`, coût = `quantity × unit_cost`), créances et
  compte des clients réguliers (`worker/credit.js`), annulation d'une vente (`writeRefund` rembourse `c.amount` et remet
  `c.quantity` en stock), historique des achats, relevés, export.
- Ticket : `paymentDTO` donne les `allocations` (libellé, quantité, montant alloué) ; `TicketSheet.jsx` les affiche
  (« 4 × Coupe-cigare … montant »), puis « TOTAL » ; même chose dans le texte WhatsApp (`shared/ticket.js`
  `ticketWhatsAppText`) et la page publique de vérification (`publicTicket`, `src/pages/PublicTicket.jsx`).
- Caisse › Boutique (`src/components/cash/ShopTab.jsx`, réservée à l'administrateur et aux associés) : une colonne par
  rayon (total, par type d'acheteur, par moyen, ventes, annulations).
- Fiche produit (`src/pages/Products.jsx`, `productFields` / `updateProduct`) : prix de vente, prix de revient, seuil.

## Objectifs

1. Une remise sur le total d'une vente Boutique, en pourcentage ou en montant FCFA, faite par tout vendeur du rayon
   (administrateur, associé, gérant) ; le gérant dans la limite de son plafond.
2. Un prix par lot réglable sur la fiche produit, appliqué à l'écran Vente de la Boutique.
3. Les deux se cumulent : le prix par lot d'abord, la remise ensuite sur le total.
4. Tous les chiffres de l'app (recette, argent encaissé, bénéfice réel, créances, annulations, relevés, export) restent
   justes **sans réécrire leurs calculs** : chaque ligne garde le montant vraiment payé.
5. Chaque remise reste visible : sur le ticket, dans le journal (avec le nom du vendeur), dans Caisse › Boutique.

## Non-objectifs

- Pas de remise ni de prix par lot **en séance** (consommations d'une réservation), ni sur le temps supplémentaire, les
  abonnements, les règlements de crédit ou les recharges de carte.
- Pas de prix par lot affiché dans l'**espace client** : un client qui commande en ligne voit le prix unitaire ; le lot
  s'applique quand sa commande est encaissée à l'écran Vente (il paie alors moins que le montant affiché, jamais plus).
  **(mon choix)**
- Pas de remise ligne par ligne : la remise porte sur le total de la vente. **(mon choix)**
- Pas de motif obligatoire, pas de validation par un associé ; pas de plafond pour l'administrateur ni pour les
  associés (choix de l'utilisateur).
- Pas de lots répétés (« 2 lots de 3 ») : au-delà du lot, chaque unité au prix « en plus », comme dit par
  l'utilisateur.
- Pas de remise à 100 % : pour donner un produit, il y a « Offert » (`worker/gifts.js`).

## Anti-objectifs (ce qui serait un échec même si ça marche)

- Un chiffre faux quelque part (recette, bénéfice, créance, remboursement) parce qu'un calcul ignore la remise.
- Une ligne, un paiement, un remboursement ou un mouvement de stock perdu ou détaché pendant la reconstruction de
  `charges`.
- Un total affiché à l'écran Vente différent du total enregistré par le serveur.
- Une annulation qui rembourse plus que ce qui a été payé, ou qui remet en stock moins de pièces que vendues.
- Un bénéfice faussé parce qu'un lot de 3 pièces compterait le coût d'une seule.

## Contraintes

- Le serveur **recalcule tout** (prix par lot, remise, répartition) : l'écran envoie le choix de remise (type et
  valeur) et, **seulement comme contrôle**, le total qu'il affiche. L'écran et le serveur utilisent **la même fonction
  partagée** (`shared/`), mais les produits de l'écran peuvent être anciens (prix ou lot changé par un associé pendant
  qu'un panier est ouvert ; page restée ouverte avec l'ancien code après une mise en ligne) : le contrôle du total
  empêche alors une caisse fausse (voir § 3). **(mon choix, après relecture)**
- Durable Object : une instruction SQL par appel ; la migration passe sur ClubDO (vrai club) et DemoDO (démo).
- Une vente touche un seul rayon : la remise reste dans le compte de ce rayon.

## Façons de faire envisagées

1. **A — Chaque ligne garde le montant vraiment payé** (choisie par l'utilisateur). On reconstruit `charges` sans le
   `CHECK (amount = quantity * unit_price)` et avec une colonne `discount`. Une ligne Boutique garde le prix catalogue
   (`unit_price`), la vraie quantité, le montant payé (`amount`) et sa part de remise (`discount`). Tous les calculs
   existants lisent `amount` et restent justes. Coût : une reconstruction de la plus grosse table, testée sur une copie.
2. **B — Découper les lignes sans toucher la table.** 3 coupes pour 10 000 deviennent « 2 × 3 333 + 1 × 3 334 », une
   remise est découpée de même. Pas de migration, mais tickets et historiques remplis de prix bizarres, et le prix
   catalogue comme le montant de la remise sont perdus.
3. **C — Noter la remise à part** (montant négatif sur la vente, lignes au prix plein). Pas de reconstruction, mais
   chacun des ~40 calculs d'argent doit apprendre à retirer la remise : un oubli donne un chiffre faux.

## Conception

### 1. Données : migration V31

**`charges` reconstruite** (même méthode que V15 / V20 / V21 / V28) :

- toutes les colonnes actuelles, dans le même ordre, plus `discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0)` ;
- on garde `CHECK (quantity > 0)`, `CHECK (unit_price >= 0)`, `CHECK (amount > 0)`, les CHECK des colonnes ajoutées
  (`deposit`, `settled`, `carryover`, `unit_cost`) et toutes les clés étrangères ;
- `CHECK (amount = quantity * unit_price)` est remplacé par deux règles :
  - `CHECK (shop_sale_id IS NOT NULL OR (discount = 0 AND amount = quantity * unit_price))` : seule une ligne Boutique
    peut s'écarter de quantité × prix ; tout le reste garde la règle d'aujourd'hui ;
  - `CHECK (amount + discount <= quantity * unit_price)` : le lot et la remise ne font que baisser le prix ;
- les lignes existantes sont recopiées avec les mêmes `id` et `discount = 0` ; les six index sont recréés.

Sens des colonnes d'une ligne Boutique :

| Colonne | Contenu |
|---|---|
| `unit_price` | prix catalogue du produit au moment de la vente |
| `quantity` | nombre réel de pièces (stock, coût, bénéfice) |
| `amount` | montant vraiment payé pour la ligne (après lot et remise) |
| `discount` | part de la remise de la vente portée par cette ligne |
| (calculé) | réduction du lot = `quantity × unit_price − amount − discount` |
| (calculé) | prix de la ligne avant remise = `amount + discount` |

**`shop_sales`** : `discount_kind TEXT` (`NULL`, `'pourcentage'` ou `'montant'`) et `discount_value INTEGER` (le
pourcentage entier, ou le montant en centièmes), pour afficher « Remise 10 % » sur le ticket. Le montant de la remise
d'une vente se lit toujours depuis ses lignes (`SUM(discount)`), jamais en double. **(mon choix)**

**`products`** : `lot_qty INTEGER`, `lot_price INTEGER`, `extra_price INTEGER`, tous `NULL` = pas de prix par lot.
Exemple du coupe-cigare : `lot_qty = 3`, `lot_price = 10 000`, `extra_price = 3 000` (en FCFA, stockés en centièmes).

### 2. Calcul partagé : `shared/pricing.js` (pur, utilisé par le Worker et l'écran)

- **Prix d'une ligne** pour `n` pièces d'un produit :
  - sans lot, ou `n < lot_qty` : `n × price` ;
  - sinon : `lot_price + (n − lot_qty) × extra_price`.
- **Sous-total** = somme des prix des lignes.
- **Remise** :
  - en pourcentage : un entier de 1 à 99 ; remise = sous-total × % arrondi **au franc le plus proche** ;
  - en montant : un nombre entier de francs, au moins 1 franc ;
  - refusée si elle ne laisse pas **au moins 1 franc par ligne** (« Remise trop forte : le total doit rester
    positif. ») ;
  - sans remise : `discount_kind = NULL`, rien ne change.
- **Répartition sur les lignes** : au prorata du prix de chaque ligne, en francs entiers, par la méthode du plus grand
  reste (ordre des lignes en cas d'égalité), chaque ligne gardant au moins 1 franc. La somme des parts est exactement
  la remise.

### 3. Vente (`worker/shop.js` `createShopSale`)

- L'entrée accepte `discount: { kind: 'pourcentage' | 'montant', value }` (absente ou `null` = pas de remise),
  validée par le serveur (type connu, valeur entière, bornes ci-dessus).
- L'entrée porte aussi **`expected_total`, obligatoire** : le total que l'écran affiche (après lot et remise). Le
  serveur ne s'en sert pas pour compter ; si son propre total diffère, il refuse la vente (409 `TOTAL_CHANGE`,
  « Les prix ont changé : vérifiez le panier avant d'encaisser. ») et l'écran recharge les produits (le chemin
  `onRefused` existe déjà). Une page ancienne qui n'envoie pas ce champ est refusée (409 `PAGE_A_RECHARGER`,
  « Rechargez la page avant d'encaisser. ») : ainsi un appareil resté ouvert depuis avant la mise en ligne ne peut pas encaisser 20 000 à
  l'écran pendant que le serveur enregistre 13 000. **(mon choix, après relecture)**
- Pour chaque produit : prix de la ligne (lot) puis part de remise ; `insertCharge` reçoit `unit_price = price`,
  `quantity`, `amount` et `discount` (pour les autres appelants, rien ne change : `amount = quantity × unit_price`,
  `discount = 0`).
- **Plafond du gérant** (voir § 7 bis) : quand le vendeur est le gérant, la remise ne peut pas dépasser le plafond en
  pourcentage du sous-total (en pourcentage : valeur ≤ plafond ; en montant : montant ≤ sous-total × plafond, arrondi
  au franc inférieur). Au-delà : refus 409 `PLAFOND_REMISE` (« Remise au-delà du plafond du gérant : 10 % du total au
  maximum. »). L'administrateur et les associés n'ont pas de plafond.
- `assertCreditAllowed` reçoit le **total après lot et remise**.
- `shop_sales` garde `discount_kind` / `discount_value`.
- Paiement inchangé : `recordPayment` additionne les `amount`, donc encaisse le total net ; la carte du membre paie le
  total net ; une vente à crédit ajoute le total net au compte du client.
- Commande en ligne encaissée à l'écran Vente : le lot et la remise s'appliquent comme pour toute vente.
- Journal `boutique.vente` : en plus d'aujourd'hui, le sous-total, la remise (type, valeur, montant) quand il y en a
  une, et les produits vendus au prix par lot. `src/lib/audit.js` l'affiche en clair (« remise 10 % : −3 400 FCFA »).
- `shopSaleDTO` : chaque ligne donne `discount` ; la vente donne `discount` (total), `discount_kind`, `discount_value`.
- Vendeurs : inchangé (`canSellIn`), le gérant compris.

### 4. Écran Vente (`SalePanel.jsx`, `Shop.jsx`)

- Une ligne affiche son prix après lot ; quand le lot s'applique, une petite mention dessous : « prix par lot
  (3 pour 10 000) ». **(mon choix)**
- Sous les lignes : « Sous-total », la remise, puis « Total ». Sans remise, l'écran reste comme aujourd'hui avec un
  petit bouton « + Remise » ; il ouvre la ligne de remise : un choix « % | FCFA », un champ, le montant retiré, et
  « Retirer » pour l'annuler. **(mon choix)**
- Pour le gérant, la ligne de remise rappelle son plafond (« 10 % au maximum ») et une remise au-delà bloque le bouton
  avec un message ; un plafond à 0 % cache le bouton « + Remise ». Le serveur refuse de toute façon.
- « Encaisser X » et « Vendre à crédit X » montrent le total net ; le crédit disponible et le solde de la carte sont
  comparés au total net.
- La remise vit dans le panier du rayon (`shopCarts`), comme l'acheteur : gardée en changeant d'onglet ou d'acheteur,
  effacée avec le panier après une vente. **(mon choix)**
- Le bouton téléphone « Panier · n · montant » montre le total net.

Croquis :

```
Coupe-cigare          [−] 4 [+]        13 000 FCFA
  prix par lot (3 pour 10 000)
Barreda O21           [−] 1 [+]        12 500 FCFA
Sous-total                              25 500 FCFA
Remise   [ % | FCFA ]  [ 10 ]          −2 550 FCFA   Retirer
Total                                   22 950 FCFA
[            Encaisser 22 950 FCFA            ]
```

### 5. Ticket (`TicketSheet.jsx`, texte WhatsApp, page publique)

- Chaque ligne montre son prix avant remise (`amount + discount`), donc « 4 × Coupe-cigare 13 000 ».
- Si la vente a une remise : « Sous-total », « Remise 10 % » (ou « Remise ») en négatif, puis « TOTAL » (le montant
  payé). Sans remise, le ticket ne change pas.
- `paymentDTO` donne pour chaque allocation `discount` de la ligne, et pour une vente Boutique `shop_discount_kind` /
  `shop_discount_value`. La page publique de vérification affiche la même chose.

### 6. Caisse › Boutique (`ShopTab.jsx`, `shopSummary`)

- Chaque colonne de rayon ajoute « Remises accordées » : la somme des remises des ventes de la période, ventes
  annulées exclues. **(mon choix)**
- Une vente avec remise l'indique dans sa ligne (« remise −2 550 »).
- Aucun autre chiffre ne change : ils lisent déjà les montants nets.

### 7. Fiche produit (`Products.jsx`, `productFields`, `productDTO`)

- Bloc facultatif « Prix par lot » : « Lot de [3] pour [10 000] FCFA, puis [3 000] FCFA par unité en plus ». Vide = pas
  de lot.
- Validation : les trois champs ensemble ou aucun ; lot de 2 à 99 pièces ; prix du lot au moins 1 franc et **moins
  cher** que lot × prix de vente ; prix « en plus » au moins 1 franc et pas plus cher que le prix de vente.
- Mêmes droits que pour modifier le produit aujourd'hui. Le journal `produit.modifier` montre avant / après.
- La carte du produit dans la Boutique affiche sous le prix « 3 pour 10 000 ». **(mon choix)**
- Le lot du vrai coupe-cigare n'est pas posé par le code : après la mise en ligne, l'administrateur ou l'associé
  des cigares le règle sur la fiche (3 / 10 000 / 3 000).

### 7 bis. Plafond du gérant (Paramètres)

- Nouveau réglage `gerant_discount_cap_pct` (entier de 0 à 99, **10 par défaut**) dans les réglages du club
  (`worker/club.js` : valeur par défaut, `normalizeSetting`), envoyé à l'écran avec les autres réglages.
- Modifié dans Paramètres, comme les autres réglages : par l'administrateur seul (`PUT /api/settings` est réservé à
  l'administrateur ; les associés le lui demandent). **(mon choix)** Libellé : « Remise maximale du gérant (% du
  total) ». 0 = le gérant ne fait pas de remise.
- Le changement est noté au journal comme les autres réglages.

### 8. Tests

- Migration V31 sur une base à la version 30 remplie de vrais enregistrements (comme `test/credit-v21.test.js`) :
  vente Boutique payée par carte puis annulée, vente à crédit puis règlement, séance avec consommation, mouvements de
  stock, offerts. Après migration : mêmes `id`, mêmes montants, `discount = 0`, références intactes,
  `PRAGMA foreign_key_check` vide, les six index présents.
- `shared/pricing.js` : la grille du coupe-cigare de 1 à 6 coupes ; arrondi du pourcentage ; répartition (somme
  exacte, chaque ligne ≥ 1 franc) ; refus (remise trop forte, % hors 1–99, montant non entier).
- Vente : lot + remise + carte ; lot + remise à crédit (plafond comparé au total net) ; annulation (remboursement =
  montant payé, stock remis = vraie quantité) ; bénéfice réel (ventes nettes, coût de toutes les pièces) ; ticket et
  texte WhatsApp avec sous-total et remise ; refus d'une ligne hors Boutique qui s'écarterait de quantité × prix ;
  refus `TOTAL_CHANGE` quand `expected_total` diffère, et refus quand il manque.
- Plafond : gérant au plafond accepté, au-dessus refusé (`PLAFOND_REMISE`, en % et en montant) ; plafond à 0 ; associé
  et administrateur au-delà du plafond acceptés ; réglage hors 0–99 refusé ; seul l'administrateur le modifie.

### 9. Mise en ligne

- La migration V31 tourne au premier accès après le déploiement, sur le vrai club et sur la démo.
- Avant de déployer : vérifier que la restauration à un instant passé de Cloudflare (déjà utilisée le 2026-11-10) est
  disponible pour le vrai club.
- Après : régler le lot du coupe-cigare sur sa fiche, puis faire une vente test de 4 coupes avec une remise et
  l'annuler.

## Laissé au constructeur

- L'apparence exacte de la ligne de remise et de la mention « prix par lot » (dans le style actuel du panneau).
- Le libellé exact des messages d'erreur, en français simple.
- L'ajout ou non d'une colonne « Remise » dans l'export des lignes (`worker/club.js`, export CSV).
- Le découpage du travail en tâches.
