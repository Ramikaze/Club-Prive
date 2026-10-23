# Catalogue de cigares avec photos — conception

Date : 2026-10-23 · Projet : Club Privé (club « Limen ») · Branche : `feat/catalogue-cigares` (partie de `main`)

## Pourquoi

Le propriétaire a fourni la liste des 61 cigares réellement vendus au club, avec leur prix de vente (fichier Excel, non versionné). Il veut :
- qu'ils entrent **automatiquement** dans le site des clients, sans import manuel de sa part ;
- une photo du produit sur chaque fiche, trouvée en ligne ;
- une description du produit, d'après les informations du fabricant ;
- les mêmes produits dans la démo, pour l'entraînement.

Les prix d'achat viendront plus tard : un champ « prix d'achat » sera ajouté à ce moment-là, ce n'est pas dans ce chantier.

## Objectifs

1. Une photo par produit. Elle s'affiche en vignette dans la liste des produits et en grand sur la fiche. Les administrateurs peuvent l'ajouter, la changer ou la retirer.
2. Les 61 cigares créés sur le vrai site par un import automatique fait depuis l'ordinateur du propriétaire. Chacun porte :
   - le nom officiel corrigé ;
   - le prix de vente du fichier ;
   - la catégorie « cigare » et une référence automatique `CIG-001`… ;
   - un stock à 0 ;
   - la photo et une description courte en français.
3. Les vrais produits recopiés dans la démo, avec leurs photos.

## Hors sujet

- Un bouton d'import dans l'interface. Il pourra venir plus tard, mais l'import de maintenant est automatique.
- Les prix d'achat et les marges.
- La nouvelle carte de membre noire, qui attend le logo.

## À éviter absolument

- Des photos ou des textes de tiers dans le dépôt GitHub (public). Les photos restent dans `photos-cigares/` (ignoré par git) et dans la base du club.
- Recopier le texte marketing du fabricant. La description est rédigée dans nos propres mots, à partir des faits : origine, feuilles, format, force, arômes.
- Une porte d'écriture sur le vrai site qui reste ouverte après l'import.
- Effacer ou casser des données existantes. Les éventuels anciens produits fictifs (`is_demo = 1`) du vrai site sont **désactivés**, jamais supprimés.

## Décisions (propriétaire, puis choix de Claude marqués *)

- **Import automatique**, sans action du propriétaire, par une porte d'import temporaire :
  - elle est protégée par un code secret créé pour l'occasion, rangé dans un fichier local `*.local` (ignoré par git) et dans un secret Cloudflare (`IMPORT_TOKEN`) ;
  - le secret est supprimé chez Cloudflare juste après l'import : la porte ne répond alors plus.
- **Produits en démo** : les vrais produits apparaissent dans la démo et sur le vrai site.
  - *Ils sont recopiés à la création de la démo et à chaque « Remettre la démo à neuf », avec les mêmes identifiants que sur le vrai site.
  - *Leur stock en démo est fictif : 10 par produit. Les produits fictifs de la démo restent, car l'historique fictif en dépend.
  - *Les vrais produits gardent leur référence en démo. Si l'un d'eux porte déjà la référence d'un produit fictif (`CIG-DEMO-01`…), le produit fictif prend la suivante libre de sa série.
- *Les photos sont rangées dans une table à part, `product_photos`, liée au produit :
  - types JPEG, PNG ou WebP ;
  - 200 Ko au plus après réduction ;
  - la réduction se fait dans le navigateur pour les ajouts manuels, et sur l'ordinateur pour l'import (macOS `sips`).
- *Les photos sont servies par `GET /api/products/:id/photo` à tout utilisateur connecté :
  - la fiche produit porte `photo_version` (date de mise à jour) ;
  - l'interface demande `…/photo?v=<version>`, mis en cache longtemps puisque l'adresse change avec la photo ;
  - une balise `<img>` ne peut pas porter l'en-tête de la démo, donc la photo vient toujours du vrai club. C'est pour cela que les produits recopiés en démo gardent les mêmes identifiants.
- *En démo, ajouter ou retirer une photo est refusé (403 `MODE_DEMO`, « Les photos se gèrent hors du mode démo. »).
- *À l'import, un produit qui existe déjà sous le même nom (sans tenir compte des majuscules ni des espaces autour) voit son prix, sa description et sa photo mis à jour. Sinon il est créé.
  - *Le reste ne change pas : référence, stock, catégorie, et un produit retiré de la vente le reste.
  - *Si le produit existant est d'une autre catégorie, l'import le refuse (409 `CATEGORIE_DIFFERENTE`) sans rien écrire.
- *La description est un texte court (environ 250 caractères au plus) en français.

## Comment ça marche (orientation technique)

- **Schéma** : nouvelle table `product_photos (product_id INTEGER PRIMARY KEY REFERENCES products(id), mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')), data BLOB NOT NULL, bytes INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id))`, ajoutée à la suite des migrations de `worker/schema.js`.
- **API** :
  - `GET /api/products/:id/photo` : tout utilisateur connecté ; renvoie l'image avec son type, sinon 404.
  - `PUT /api/products/:id/photo` (ADMIN) : JSON `{ mime, data }` en base64, au plus 200 Ko décodés.
  - `DELETE /api/products/:id/photo` (ADMIN).
  - `productDTO` reçoit `photo_version`, qui vaut `null` sans photo.
- **Porte d'import** : `POST /api/admin/catalog-import`, route publique côté session, mais exigeant l'en-tête `x-import-token`.
  - La comparaison se fait par empreinte SHA-256, comme pour le code d'installation, avec le même frein aux tentatives répétées.
  - Le code est vérifié avant la lecture du corps : un appel sans le bon code ne fait pas lire jusqu'à 300 Ko au serveur.
  - Elle répond 503 si `IMPORT_TOKEN` n'est pas configuré, et n'existe que pour le vrai club (404 en démo).
  - Corps : `{ item?: { name, price, category: 'cigare', description?, photo?: { mime, data } }, deactivate_demo_products?: true }`.
  - Le prix est en francs CFA entiers, stocké ×100 comme les autres montants.
  - Une seule fiche par appel : la porte accepte 300 Ko par requête (comme les routes photo), assez pour une photo de 200 Ko en base64.
  - Chaque action est notée dans le journal (`produit.importer`, qui garde le prix et la description d'avant pour une mise à jour ; `produits.desactiver_fictifs`).
- **Démo** :
  - `demoConfig` ajoute `products` (vrais produits actifs, `is_demo = 0`, sans les photos).
  - `seedDemo` les insère avec les mêmes `id`, avant les produits fictifs, avec un stock de 10.
  - Les photos restent dans le vrai club et s'affichent par l'adresse ci-dessus.
- **Interface** (`src/pages/Products.jsx` et la fiche produit) :
  - vignette dans la liste, grande photo sur la fiche ;
  - pour les administrateurs hors démo, « Ajouter une photo », « Changer la photo » et « Retirer la photo ». Le fichier est réduit dans le navigateur (canvas, 800 px au plus, JPEG) avant l'envoi.
- **Programme d'import** : un script local dans `scripts/` (versionné, sans aucune donnée) lit le fichier Excel et les manifestes de `photos-cigares/`, réduit les photos, puis appelle la porte d'import une fiche à la fois.
- **Tests** : les tests Node couvrent :
  - les routes photo (droits, taille, types, démo refusée) ;
  - la porte d'import (sans code, mauvais code, code absent, création, mise à jour par nom, désactivation des produits fictifs, 404 en démo) ;
  - la copie des produits dans la démo (mêmes identifiants, stock 10) ;
  - `photo_version`.
