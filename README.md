
# Club Privé

Gestion d’un cigar lounge privé : membres, abonnements, réservations de salle, conservation des cigares, casiers personnels, stock, encaissements et suivi financier. Interface en français, adaptée aux mobiles, avec thèmes clair et sombre.

## Démarrer en local

Prérequis : **Node.js 24 ou supérieur**, npm. Les tests utilisent `node:sqlite`.

```sh
npm ci
```

Pour une **base locale de démonstration**, créer un fichier `.dev.vars` (ignoré par Git) :

```dotenv
DEMO_ACCOUNTS=1
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

```sh
npm start
```

Ouvrir `http://localhost:8787`. Sur macOS, `start.command` lance également l’interface et l’API. Les données locales persistent dans `.wrangler/`.

Comptes **fictifs, réservés au développement local** :

| Identifiant | Mot de passe de démonstration | Rôle |
| --- | --- | --- |
| proprietaire | demo-proprio-2026 | Administrateur |
| associe | demo-associe-2026 | Administrateur |
| gerant | demo-gerant-2026 | Gérant |

`DEMO_ACCOUNTS=1` ne crée ces comptes et les exemples que dans une base sans utilisateurs. Une base existante reste inchangée.

Pour développer avec rechargement immédiat, lancer dans deux terminaux :

```sh
npm run dev:api
npm run dev
```

Ouvrir ensuite `http://localhost:5173`. Les appels `/api` sont transmis au serveur local sur le port 8787. Si Vite utilise un autre port, adapter `ALLOWED_ORIGINS` dans `.dev.vars` puis relancer l’API.

## Fonctionnalités

- **Membres et cartes** : fiches, cartes physiques ou virtuelles, formules, renouvellements, crédit de réservation et historique.
- **Agenda** : vues jour, semaine et liste, devis, arrivées, prolongations, annulations et protection contre les chevauchements.
- **Cave & casiers** : plusieurs caves, seuils d’humidité et de température propres à chaque cave, fréquence des contrôles, relevés manuels horodatés, graphiques et journal exportable.
- **Collections privées** : attribution d’un casier à un membre, échéance, renouvellement, dépôts et retraits par référence, restitution et historique des occupants. Les casiers sont accessibles depuis les fiches membres.
- **Produits et caisse** : cigares et bouteilles, entrées de stock, ventes liées aux réservations, encaissements, remboursements et ventilation par activité.
- **Administration** : dépenses, trésorerie, grand livre, clôtures mensuelles, rôles, journal d’audit, paramètres et exports Excel.

### Fonctionnement de la cave

Les relevés sont **manuels** : aucun capteur connecté ni notification externe n’est configuré. Un relevé hors seuils déclenche une alerte dans l’application ; un relevé absent ou trop ancien déclenche une demande de contrôle. Les écrans du lounge et le tableau de bord se rafraîchissent chaque minute lorsque l’onglet est visible, ainsi qu’au retour dans l’onglet. Le bouton Actualiser permet un contrôle immédiat.

Les seuils sont choisis par l’administrateur et sont obligatoires lors de la création d’une cave. Les valeurs des exemples sont fictives, à adapter au matériel et aux collections. Les graphiques utilisent les **seuils actuels** et les 30 derniers relevés valides parmi les 60 derniers contrôles affichés. L’annulation d’une saisie erronée exige un motif, conserve le relevé et réévalue la situation à partir du dernier contrôle valide.

### Fonctionnement des casiers

L’attribution commence à la date civile locale et reste en place après son échéance. Le renouvellement permet de reprendre les dépôts ; les retraits restent autorisés lorsque l’attribution est échue. Un casier ne peut être libéré qu’une fois tous les cigares restitués. Une attribution terminée n’accepte plus de mouvements, même depuis un ancien écran resté ouvert.

Les cigares personnels sont indépendants du stock commercial. Les dépôts et retraits n’enregistrent ni vente ni facturation. L’abonnement du membre n’est pas une condition d’attribution du casier. La location payante des casiers et sa facturation automatique ne sont pas implémentées.

Le journal et son export présentent les 100 derniers mouvements d’un casier, et l’historique affiche les 30 dernières attributions. Tous les enregistrements restent conservés en base.

| Action sur le lounge | Gérant | Administrateur |
| --- | --- | --- |
| Consulter les caves, casiers et historiques ; exporter | Oui | Oui |
| Saisir un relevé, attribuer/renouveler/libérer un casier, déposer/retirer | Oui | Oui |
| Créer/configurer une cave, annuler un relevé | Non | Oui |
| Créer un casier, le mettre hors service ou le remettre en service | Non | Oui |

## Architecture et validation

React 18 + Vite, React Router et Zustand pour l’interface. L’API tourne dans un **Cloudflare Worker**, avec SQLite dans un **Durable Object**. La même logique métier s’exécute dans les tests Node.

- `worker/schema.js` : migrations transactionnelles et contraintes SQL. La migration v2 ajoute caves, relevés et casiers sans modifier les données v1.
- `worker/api.js` : authentification, contrôle des rôles, vérification des origines et idempotence.
- `worker/club.js`, `worker/ledger.js`, `worker/lounge.js` : règles métier côté serveur.
- `test/` : scénarios API, montants, crédits, concurrence, rôles, conservation, casiers, migration et redémarrage.

```sh
npm test
npm run build
```

Les écritures et leur audit sont atomiques. Les requêtes rejouées avec la même clé d’idempotence n’appliquent pas deux fois une opération. Une contrainte SQL empêche la double attribution d’un casier.

Le workflow GitHub vérifie les tests et la compilation. Il ne déploie pas le site : **GitHub Pages ne peut pas héberger cette API ni sa base SQLite**.

## Installation sur Cloudflare

Le déploiement se fait explicitement avec `npm run deploy` après configuration de l’accès Cloudflare. Le fichier `wrangler.jsonc` configure les ressources et la distribution de `dist/`.

Pour une installation réelle, ne pas définir `DEMO_ACCOUNTS`. Configurer le secret d’installation avant de créer le premier administrateur :

```sh
npx wrangler secret put SETUP_TOKEN
```

Ouvrir l’application et créer le premier compte avec ce code. Valider les tarifs et paramètres, puis désactiver le mode démonstration avant l’utilisation réelle. Le mode démonstration autorise les tarifs non validés ; il ne constitue pas une séparation entre bases de données.

L’effacement des données depuis les paramètres inclut caves, relevés, casiers et collections privées. Il conserve les utilisateurs, les paramètres, les formules et les catégories. Cette opération est définitive et ne remplace pas une sauvegarde.
