# Prix de revient et bénéfice réel — conception

Date : 2026-11-18. Demande du propriétaire (administrateur) :

> « Tu dois mettre, pour chaque article, son prix de revient, c'est-à-dire son prix d'achat. Même si tu n'as pas encore
> le prix, il faut que l'option soit mise. Afin qu'on sache combien on a vendu, mais quel est le bénéfice réel ? »

Il a choisi de lire le bénéfice réel dans **Trésorerie & Bilans** et **aussi sur la page Caisse** (option B), et de
**déduire les produits offerts** du bénéfice.

## Pourquoi

Aujourd'hui l'application dit combien on a encaissé (recette) et ce qu'on a dépensé, mais pas ce que les produits
vendus ont rapporté une fois leur prix d'achat retiré. Le propriétaire veut voir, pour chaque produit et chaque caisse,
**ventes − prix d'achat = bénéfice réel**.

## Ce qui existe

- `products.cost_price` (V28, conception « Offert » du 2026-11-10) : prix de revient unitaire, facultatif (`NULL` =
  pas encore connu). Saisi dans le formulaire produit (« Prix de revient (FCFA, facultatif) »), affiché sur la fiche
  produit (« à renseigner » s'il manque). Envoyé seulement à l'administrateur et aux associés (`isBoss`) ; le gérant ne
  le reçoit jamais.
- `charges` : une ligne par vente (`kind = 'produit'`, `product_id`, `quantity`, `unit_price`, `amount`, `account`
  `cigares` ou `alcool`, `status` `due` / `payee` / `annulee` / `remboursee`, `created_at`). Une ligne ne change jamais
  de quantité ni de prix ; un remboursement porte sur la ligne entière. Toutes les ventes de produits (Boutique et
  produits servis pendant une séance) passent par l'unique `INSERT INTO charges` de `worker/club.js` (vers la
  ligne 2706). `worker/credit.js` insère aussi des lignes « Dette reprise » (`carryover = 1`, sans produit).
- `gifts` (V28) : produits offerts, avec `unit_cost` copié au moment du cadeau (`NULL` si inconnu), `quantity`,
  `account`, `biz_date`, `cancelled_at`.
- « Trésorerie & Bilans » (`src/pages/Treasury.jsx`) montre un **Résultat de la période** = encaissé net − dépenses
  (les achats aux fournisseurs y sont des dépenses). C'est un résultat de trésorerie, différent du bénéfice réel.
- Page Caisse des chefs (`AdminCash`, `src/pages/Cash.jsx`) : tuile « Recette du jour par catégorie »
  (`CategoryColumns.jsx`), période choisie (jour par défaut). Le gérant a sa propre page (`ManagerCash`), jour en cours
  seulement.

## Objectifs

1. Chaque produit montre son prix de revient, ou « à renseigner » s'il manque, là où on le cherche : la liste du
   catalogue, pas seulement la fiche.
2. Le bénéfice réel d'une période, par caisse et par produit, dans Trésorerie & Bilans.
3. Le bénéfice réel du jour (ou de la période choisie) sur la page Caisse des chefs.
4. Un prix de revient changé plus tard ne réécrit pas le bénéfice des ventes déjà faites avec l'ancien prix.

## Non-objectifs

- Pas de prix moyen pondéré ni de lien entre les achats fournisseurs et les produits : les achats sont des dépenses
  par catégorie, pas par produit.
- Pas de bénéfice pour les réservations de séance, le temps supplémentaire ni les abonnements (pas de prix d'achat).
- Le « Résultat de la période » existant ne change pas.
- Pas d'export Excel du bénéfice dans cette version.

## Anti-objectifs (ce qui serait un échec même si ça marche)

- Un bénéfice qui paraît plus gros qu'en vrai parce que des ventes sans prix de revient comptent pour un coût de 0
  sans le dire.
- Le bénéfice d'un mois passé qui change tout seul parce qu'on a modifié le prix d'achat d'un produit aujourd'hui.
- Le gérant qui voit les prix de revient ou le bénéfice.
- Additionner le bénéfice réel et le « Résultat de la période » (les achats compteraient deux fois).

## Façons de faire envisagées

1. **Copier le prix de revient sur chaque vente au moment où elle est faite** (choisie). Une colonne `unit_cost` sur
   `charges`, remplie à l'insertion depuis `products.cost_price`, comme `gifts.unit_cost`. Le bénéfice d'une vente ne
   bouge plus quand le prix du produit change. Coût : une migration et une colonne.
2. **Toujours prendre le prix de revient actuel du produit.** Aucune migration, mais changer un prix d'achat réécrit
   tous les mois passés, mois clôturés compris : contraire à l'objectif 4.
3. **Calculer depuis les achats aux fournisseurs.** Impossible : un achat est une dépense par catégorie
   (`achat_champagne`, `achat_cigares`…), sans produit ni quantité.

Le propriétaire a laissé le « comment » à Claude ; la façon 1 est retenue.

## La conception

### 1. Données (migration V30)

- `ALTER TABLE charges ADD COLUMN unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0)`.
- Reprise des ventes passées : chaque ligne `kind = 'produit'` avec un `product_id` prend le `cost_price` **actuel** de
  son produit (`NULL` s'il n'est pas connu). C'est la meilleure information disponible pour le passé (mon choix).
- À chaque nouvelle ligne de produit, `unit_cost` = `products.cost_price` du moment (`NULL` s'il manque). Les autres
  lignes (temps supplémentaire, abonnement, dette reprise) gardent `NULL` : elles ne comptent pas dans le bénéfice.

### 2. Prix de revient saisi plus tard

Quand le prix de revient d'un produit passe de vide à un montant, ou change, les ventes et les cadeaux de ce produit
dont `unit_cost` est encore `NULL` le prennent (`UPDATE … WHERE product_id = ? AND unit_cost IS NULL`). Ceux qui avaient
déjà un prix ne changent pas. Choix du propriétaire (« dès que vous le saisissez, ces ventes-là le prennent »).

Cela remplace, pour les cadeaux, la règle de la conception « Offert » (« le prix de revient renseigné plus tard ne
change pas les cadeaux déjà faits ») **seulement pour les cadeaux dont le prix manquait** : un cadeau qui avait un prix
le garde (mon choix, par cohérence avec les ventes).

Le remplissage touche aussi les jours fermés et les mois clôturés : il ne déplace pas d'argent, il complète un chiffre
de rapport qui était signalé comme incomplet (mon choix).

### 3. Ce qui compte

- **Une vente** : ligne `kind = 'produit'`, comptée le **jour où elle est faite** (`created_at`, jour d'exploitation
  comme les colonnes de la caisse), payée ou non, quel que soit son statut aujourd'hui. Raison : une vente à crédit
  réglée en plusieurs fois ne doit pas étaler son bénéfice sur les jours des règlements.
- **Une annulation ou un remboursement** compte **en moins le jour où il a lieu** (mon choix, pour qu'un mois passé ne
  change jamais tout seul, même clôturé) :
  - annulation d'une ligne (`status = 'annulee'`, jour de `cancelled_at`) : − son montant, + son prix d'achat (la
    bouteille revient toujours en stock, `voidCharge`) ; une vente Boutique annulée en entier suit la même règle
    pour chacune de ses lignes ;
  - remboursement (`refunds`, jour de `created_at`) : − le montant remboursé ; + le prix d'achat **seulement si** la
    marchandise est remise en stock (`restocked = 1`). Sans remise en stock, la bouteille est perdue : son prix
    d'achat reste compté.
  - Une vente annulée le jour même s'annule donc d'elle-même dans le bénéfice du jour.
- **Ventes** = Σ `amount` des ventes − annulations et remboursements de la période. **Prix d'achat** = Σ
  `quantity × unit_cost` des ventes − celui des marchandises revenues en stock, lignes au prix connu seulement.
- **Un cadeau** : ligne de `gifts`, comptée à sa `biz_date` pour Σ `quantity × unit_cost` ; son annulation compte en
  moins le jour de `cancelled_at` (même règle que les ventes).
- **Bénéfice réel** = ventes des lignes au prix connu − leur prix d'achat − offerts au prix connu.
- **Prix inconnu** : la ligne n'entre ni dans les ventes du bénéfice ni dans le prix d'achat ; elle est comptée à part
  (« 3 ventes pour 45 000 FCFA sans prix de revient, hors bénéfice »), et de même pour les cadeaux. Le bénéfice affiché
  porte alors la mention « incomplet ». Jamais un coût de 0 silencieux.
- **Par caisse** : `alcool` (affichée « Champagne et autres boissons ») et `cigares`, d'après le compte de la ligne.
  Les produits n'existent que dans ces deux comptes.

### 4. Serveur

- `GET /api/finance/profit?from=&to=` réservé à l'administrateur et aux associés (`CLUB`). Réponse :
  - par caisse (`alcool`, `cigares`) et au total : `sales` (ventes au prix connu), `cost`, `gifts_cost`, `profit`,
    `missing_sales` (nombre et montant des ventes sans prix), `missing_gifts` (nombre de cadeaux sans prix) ;
  - `products` : une ligne par produit vendu ou offert sur la période : `product_id`, `name`, `reference`, `category`,
    `quantity` vendue, `sales`, `cost`, `gifts_quantity`, `gifts_cost`, `profit`, `margin` (bénéfice ÷ ventes, `null`
    sans vente au prix connu), `cost_missing` (le produit a des lignes sans prix sur la période).
- Un associé voit les **deux** caisses et les cadeaux des deux rayons, comme l'administrateur : règle du propriétaire
  (2026-10-28, « chacun gère ses produits mais voit ceux de l'autre ») ; Trésorerie et Caisse montrent déjà les deux
  caisses à chaque associé. Pas de filtre par rayon.
- Les réponses produits (`/api/products`, fiche, historique) continuent de cacher `cost_price` au gérant ; aucune
  réponse lisible par le gérant ne contient `unit_cost`.

### 5. Écrans

**Catalogue (`src/pages/Products.jsx`, administrateur et associés seulement)**

- Nouvelle colonne triable « Prix de revient » après « Prix » : le montant, ou « à renseigner » en orange.
- En haut de la liste, quand il en manque : « 7 produits sans prix de revient » ; un clic filtre la liste sur eux
  (mon choix : le moyen le plus court de tout compléter).
- Formulaire produit : le champ reste facultatif ; son aide dit « nécessaire pour calculer le bénéfice réel ».

```
Produit              Catégorie        Prix          Prix de revient   Stock
Belvedere            Autre boisson    26 000 FCFA   21 000 FCFA       0
Horacio Colosso      Cigare           12 000 FCFA   à renseigner      56
```

**Trésorerie & Bilans (`src/pages/Treasury.jsx`)** — nouvelle carte « Bénéfice réel des produits », période de la page :

```
Bénéfice réel des produits                                  incomplet
                         Ventes      Prix d'achat   Offerts    Bénéfice
Champagne et autres b.   450 000     −320 000       −21 000    109 000
Cigare                   300 000     −180 000           0      120 000
Total                    750 000     −500 000       −21 000    229 000
3 ventes (45 000 FCFA) sans prix de revient ne sont pas comptées. Voir les produits à compléter.

Par produit   Qté   Ventes    Prix d'achat   Offerts   Bénéfice   Marge
Hennessy        4   120 000    −92 000            0     28 000      23 %
```

Le tableau par produit est triable (comme les autres tableaux). Une phrase rappelle que ce bénéfice ne s'additionne pas
au « Résultat de la période » (les achats aux fournisseurs y sont déjà des dépenses).

**Page Caisse des chefs (`AdminCash`)** — une bande « Bénéfice réel du jour » (« de la période » sur plusieurs jours)
sous les colonnes de « Recette du jour par catégorie », sur toutes caisses seulement (comme la ligne vers l'argent
encaissé) :

```
Bénéfice réel du jour : Champagne et autres boissons 52 000 · Cigare 31 000 · Offerts −8 500 · Total 74 500 FCFA
1 vente sans prix de revient, hors bénéfice.                                          Détail dans Bilans
```

Le gérant (`ManagerCash`) ne voit pas cette bande et ne fait pas l'appel.

### 6. Les 7 bouteilles de la feuille du propriétaire

Elles **existent déjà** sur le site des clients : importées le 2026-11-09 (PR #71), BOU-001 à BOU-007, catégorie
« Autre boisson », avec comme prix de vente **provisoire** le prix fournisseur (« en attendant les vrais »), c'est-à-dire
les prix d'achat de la feuille. On **met à jour** ces 7 fiches, sans en créer : nouveau prix de vente et prix de
revient ; noms, références, photos, descriptions et stock inchangés. Prix en FCFA :

| Fiche existante | Sur la feuille | Prix de vente (nouveau) | Prix de revient |
|---|---|---|---|
| Belvedere | Belvedere | 26 000 | 21 000 |
| Stolichnaya | Stoly | 15 000 | 8 500 |
| Hennessy VS | Henesy | 30 000 | 23 000 |
| Martell VSOP | Martel | 50 000 | 45 000 |
| Zacapa 23 | Zacapa | 45 000 | 40 000 |
| Chivas 18 | Chivas 18 | 50 000 | 45 000 |
| JW Black 12 | Black | 20 000 | 15 000 |

Les fiches sont retrouvées par leur référence BOU (le nom exact affiché sur le site fait foi). La mise à jour se fait
sur le site des clients après la mise en ligne, avec l'accord du propriétaire, par le formulaire produit (7 fiches ;
pas besoin de la porte d'import). Une vente déjà faite au prix provisoire montrera un bénéfice proche de 0 : c'est
le vrai chiffre, la bouteille ayant été encaissée à ce prix.

## Laissé au constructeur

- Le découpage du code (fichier `worker/profit.js` ou ajout à un fichier existant), les noms internes, le style exact
  des cartes et bandes dans le respect des classes existantes.
- Les tests : migration (reprise des ventes passées), copie à la vente, remplissage quand le prix est saisi, calcul
  (annulée, remboursée, à crédit non payée, cadeau, prix inconnu), droits (gérant refusé sur `/api/finance/profit`,
  jamais de `unit_cost` ni `cost_price` dans ses réponses).
