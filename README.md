
# Club Privé

Gestion d’un cigar lounge privé : membres, abonnements, réservations de salle, conservation des cigares, stock, encaissements et suivi financier. Interface en français, adaptée aux mobiles, avec thèmes clair et sombre.

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
| admin | admin-club-2026 | Administrateur (accès rapide en local) |

`DEMO_ACCOUNTS=1` ne crée ces comptes et les exemples que dans une base sans utilisateurs. Une base existante reste inchangée.

Pour développer avec rechargement immédiat, lancer dans deux terminaux :

```sh
npm run dev:api
npm run dev
```

Ouvrir ensuite `http://localhost:5173`. Les appels `/api` sont transmis au serveur local sur le port 8787. Si Vite utilise un autre port, adapter `ALLOWED_ORIGINS` dans `.dev.vars` puis relancer l’API.

## Fonctionnalités

- **Membres et cartes** : fiches, cartes physiques ou virtuelles avec QR code, formules, renouvellements, crédit individuel et historique des séances comme titulaire ou accompagnant.
- **Salles et salons** : capacités, disponibilités, participants, installation, consommations, fermeture temporaire et réouverture.
- **Agenda** : vues jour, semaine et liste, devis, arrivées, prolongations, annulations et protection contre les chevauchements de salles et de membres.
- **Cave** : plusieurs caves, seuils d’humidité et de température propres à chaque cave, fréquence des contrôles, relevés manuels horodatés, graphiques et journal exportable.
- **Produits et caisse** : cigares et bouteilles, entrées de stock, ventes liées aux réservations, encaissements, remboursements et ventilation par activité.
- **Administration** : dépenses, trésorerie, grand livre, clôtures mensuelles, rôles, journal d’audit, paramètres et exports Excel.

### Fonctionnement de la cave

Les relevés sont **manuels** : aucun capteur connecté ni notification externe n’est configuré. Un relevé hors seuils déclenche une alerte dans l’application ; un relevé absent ou trop ancien déclenche une demande de contrôle. Les écrans du lounge et le tableau de bord se rafraîchissent chaque minute lorsque l’onglet est visible, ainsi qu’au retour dans l’onglet. Le bouton Actualiser permet un contrôle immédiat.

Les seuils sont choisis par l’administrateur et sont obligatoires lors de la création d’une cave. Les valeurs des exemples sont fictives, à adapter au matériel et aux collections. Les graphiques utilisent les **seuils actuels** et les 30 derniers relevés valides parmi les 60 derniers contrôles affichés. L’annulation d’une saisie erronée exige un motif, conserve le relevé et réévalue la situation à partir du dernier contrôle valide.

| Action sur le lounge | Gérant | Administrateur |
| --- | --- | --- |
| Consulter les caves et les relevés ; exporter | Oui | Oui |
| Saisir un relevé | Oui | Oui |
| Créer/configurer une cave, annuler un relevé | Non | Oui |

### Réservations et salles

Chaque réservation dispose d’un titulaire et peut accueillir plusieurs membres, avec un engagement de crédit propre à chacun. Les prolongations engagent le crédit disponible des participants ; la clôture le consomme, tandis que l’annulation ou le retrait d’un accompagnant libère son engagement. Les suppléments et consommations restent facturés au titulaire. Un abonnement rattaché à une séance active, même comme accompagnant, ne peut pas être annulé.

L’effectif total, invités compris, respecte la capacité de la salle lors d’une création, d’un ajout de membre ou d’un transfert. Aucun membre ne peut participer à deux réservations qui se chevauchent, quelle que soit la salle. Une séance terminée conserve son effectif et sa salle.

La configuration des salles est réservée aux administrateurs. Fermer une salle ou réduire sa capacité exige de traiter au préalable les réservations actives concernées. Une salle fermée reste visible dans « Salles fermées » pour être rouverte. La suppression retire la salle de l’exploitation et conserve ses réservations historiques dans leur salle d’origine. Au moins une salle reste ouverte.

Le QR code d’une carte ouvre la fiche du membre après authentification du personnel. L’URL complète ou le code de carte peut aussi être saisi dans la recherche des membres. Le QR code ne constitue pas une connexion ni une autorisation d’accès autonome.

## Architecture et validation

React 18 + Vite, React Router et Zustand pour l’interface. L’API tourne dans un **Cloudflare Worker**, avec SQLite dans un **Durable Object**. La même logique métier s’exécute dans les tests Node.

- `worker/schema.js` : migrations transactionnelles et contraintes SQL. La v2 ajoute caves et relevés ; la v3 supprime les anciennes tables de casiers ; la v4 ajoute salles et participants ; la v5 conserve les salles retirées pour l’historique et met à niveau les premières bases v4 sans table de participants.
- `worker/api.js` : authentification, contrôle des rôles, vérification des origines et idempotence.
- `worker/club.js`, `worker/ledger.js`, `worker/lounge.js` : règles métier côté serveur.
- `test/` : scénarios API, montants, crédits, concurrence, rôles, conservation, migration et redémarrage.

```sh
npm test
npm run build
```

Les écritures et leur audit sont atomiques. Les requêtes rejouées avec la même clé d’idempotence n’appliquent pas deux fois une opération.

Le workflow GitHub vérifie les tests et la compilation. Il ne déploie pas le site : **GitHub Pages ne peut pas héberger cette API ni sa base SQLite**.

## Installation sur Cloudflare

Le déploiement se fait explicitement avec `npm run deploy` après configuration de l’accès Cloudflare. Le fichier `wrangler.jsonc` configure les ressources et la distribution de `dist/`.

Pour une installation réelle, ne pas définir `DEMO_ACCOUNTS`. Configurer le secret d’installation avant de créer le premier administrateur :

```sh
npx wrangler secret put SETUP_TOKEN
```

Ouvrir l’application et créer le premier compte avec ce code. Valider les tarifs et paramètres, puis désactiver le mode démonstration avant l’utilisation réelle. Le mode démonstration autorise les tarifs non validés ; il ne constitue pas une séparation entre bases de données.

L’effacement des données depuis les paramètres inclut caves et relevés. Il conserve les utilisateurs, les paramètres, les formules et les catégories. Cette opération est définitive et ne remplace pas une sauvegarde.

### Version de test

Une seconde installation, séparée du site des clients, sert à essayer chaque changement avant sa mise en ligne. C’est l’environnement `test` de `wrangler.jsonc` : son propre Worker (`club-prive-test`), sa propre base et ses propres comptes. Un bandeau « Version de test » l’identifie à l’écran et dans le titre de l’onglet.

| Site | Adresse | Mise en ligne |
| --- | --- | --- |
| Clients | `https://club-prive.ramikaze.workers.dev` | `npm run deploy` |
| Test | `https://club-prive-test.ramikaze.workers.dev` | `npm run deploy:test` |

Ordre conseillé : `npm test`, puis `npm run deploy:test`, vérification sur le site de test, puis `npm run deploy`. Le secret d’installation du site de test se configure à part :

```sh
npx wrangler secret put SETUP_TOKEN --env test
```
