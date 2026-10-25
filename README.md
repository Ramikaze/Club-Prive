
# Club Privé

Gestion d’un cigar lounge privé : membres, abonnements, réservations de salle, conservation des cigares, stock, encaissements et suivi financier. Interface en français, adaptée aux mobiles, avec thèmes clair et sombre.

## Démarrer en local

Prérequis : **Node.js 24 ou supérieur**, npm. Les tests utilisent `node:sqlite`.

```sh
npm ci
```

Pour travailler en local avec des **comptes fictifs**, créer un fichier `.dev.vars` (ignoré par Git) :

```dotenv
DEMO_ACCOUNTS=1
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

```sh
npm start
```

Ouvrir `http://localhost:8787`. Sur macOS, `start.command` lance également l’interface et l’API. Les données locales persistent dans `.wrangler/`.

Comptes **fictifs, réservés au développement local** :

| Identifiant | Mot de passe fictif | Rôle |
| --- | --- | --- |
| proprietaire | demo-proprio-2026 | Administrateur |
| associe | demo-associe-2026 | Administrateur |
| gerant | demo-gerant-2026 | Gérant |
| admin | admin-club-2026 | Administrateur (accès rapide en local) |

`DEMO_ACCOUNTS=1` ne crée que ces comptes, et seulement dans une base sans utilisateurs : le club reste vide. Une base existante reste inchangée. Pour s’exercer sur des données fictives, se connecter puis ouvrir le mode démo (voir « Mode démo (entraînement) »).

Pour développer avec rechargement immédiat, lancer dans deux terminaux :

```sh
npm run dev:api
npm run dev
```

Ouvrir ensuite `http://localhost:5173`. Les appels `/api` sont transmis au serveur local sur le port 8787. Si Vite utilise un autre port, adapter `ALLOWED_ORIGINS` dans `.dev.vars` puis relancer l’API.

## Fonctionnalités

- **Membres et cartes** : fiches, cartes physiques ou virtuelles avec QR code et logo The Limen, formules, renouvellements, crédit individuel et historique des séances comme titulaire ou accompagnant.
- **Salles et salons** : capacités, disponibilités, participants, installation, consommations, fermeture temporaire et réouverture.
- **Agenda** : vues jour, semaine et liste, devis, arrivées, prolongations, annulations et protection contre les chevauchements de salles et de membres.
- **Cave** : plusieurs caves, seuils d’humidité et de température propres à chaque cave, fréquence des contrôles, relevés manuels horodatés, graphiques et journal exportable.
- **Produits et caisse** : cigares et bouteilles, avec leur photo (les administrateurs l’ajoutent, la changent ou la retirent depuis la fiche du produit), entrées de stock, ventes liées aux réservations, encaissements, remboursements et ventilation par activité. Chaque encaissement donne un ticket de caisse (voir « Ticket de caisse »).
- **Administration** : dépenses, trésorerie, grand livre, clôtures mensuelles, rôles, journal d’audit, paramètres et exports Excel.
- **Carte de débit** : un crédit en FCFA rechargé sur la carte du membre, qui paie les consommations, les salles et le renouvellement de l’abonnement (voir « Carte de débit »).
- **Mode démo** : un espace d’entraînement aux données fictives, séparé du vrai club.

### Fonctionnement de la cave

Les relevés sont **manuels** : aucun capteur connecté ni notification externe n’est configuré. Un relevé hors seuils déclenche une alerte dans l’application ; un relevé absent ou trop ancien déclenche une demande de contrôle. Les écrans du lounge et le tableau de bord se rafraîchissent chaque minute lorsque l’onglet est visible, ainsi qu’au retour dans l’onglet. Le bouton Actualiser permet un contrôle immédiat.

Les seuils sont choisis par l’administrateur et sont obligatoires lors de la création d’une cave. Les valeurs des exemples sont fictives, à adapter au matériel et aux collections. Les graphiques utilisent les **seuils actuels** et les 30 derniers relevés valides parmi les 60 derniers contrôles affichés. L’annulation d’une saisie erronée exige un motif, conserve le relevé et réévalue la situation à partir du dernier contrôle valide.

| Action sur le lounge | Gérant | Administrateur |
| --- | --- | --- |
| Consulter les caves et les relevés ; exporter | Oui | Oui |
| Saisir un relevé | Oui | Oui |
| Créer/configurer une cave, annuler un relevé | Non | Oui |

### Réservations et salles

Le club n’a pas d’horaires d’ouverture : la salle se réserve à toute heure, de jour comme de nuit, sans autorisation particulière. Une séance dure au plus 24 heures. La journée commence à l’heure réglée dans les paramètres (06:00 par défaut) : une séance commencée avant cette heure compte, pour l’agenda et la caisse, dans la journée de la veille. Une réservation dure au moins une heure, deux heures le vendredi et le samedi à partir de 18 h, nuit comprise.

Chaque réservation dispose d’un titulaire et peut accueillir plusieurs membres, avec un engagement de crédit propre à chacun. Les prolongations engagent le crédit disponible des participants ; la clôture le consomme, tandis que l’annulation ou le retrait d’un accompagnant libère son engagement. Les suppléments et consommations restent facturés au titulaire. Un abonnement rattaché à une séance active, même comme accompagnant, ne peut pas être annulé.

L’effectif total, invités compris, respecte la capacité de la salle lors d’une création, d’un ajout de membre ou d’un transfert. Aucun membre ne peut participer à deux réservations qui se chevauchent, quelle que soit la salle. Une séance terminée conserve son effectif et sa salle.

Deux réservations d’une même salle sont séparées d’au moins 30 minutes, le temps de remettre la salle en état : une réservation, une prolongation ou un changement de salle qui laisserait moins de temps avec une autre réservation de la même salle est refusé. Ces minutes ne sont ni facturées ni retirées des heures de l’abonnement. La durée se règle dans Paramètres, onglet « Club & Horaires », champ « Battement entre deux réservations » (de 0 à 240 minutes ; 0 désactive la règle) ; les réservations déjà enregistrées sont conservées telles quelles, même collées. Quinze minutes avant la fin d’une séance en cours, une alerte orange apparaît sur la page Salles et sur l’Accueil : elle invite le gérant à proposer une prolongation au client et lui dit si elle est possible et jusqu’à quelle heure, ou pourquoi elle ne l’est pas (par exemple parce que la séance suivante est déjà réservée).

Après une réservation, le gérant envoie lui-même la confirmation au client sur WhatsApp, en un clic : le bouton ouvre WhatsApp avec le message déjà écrit pour le numéro du membre, et il ne reste qu’à appuyer sur « Envoyer » (rien ne part automatiquement, et le mode démo montre seulement le texte). Le numéro du club qui termine ce message se règle dans Paramètres, onglet « Club & Horaires », champ « Numéro WhatsApp du club » (par exemple +242 06 000 00 00) : il se saisit dans l’application, jamais dans le code.

La configuration des salles est réservée aux administrateurs. Fermer une salle ou réduire sa capacité exige de traiter au préalable les réservations actives concernées. Une salle fermée reste visible dans « Salles fermées » pour être rouverte. La suppression retire la salle de l’exploitation et conserve ses réservations historiques dans leur salle d’origine. Au moins une salle reste ouverte.

Le QR code d’une carte ouvre la fiche du membre après authentification du personnel. L’URL complète ou le code de carte peut aussi être saisi dans la recherche des membres. Le QR code ne constitue pas une connexion ni une autorisation d’accès autonome.

### Ticket de caisse

Après chaque encaissement, l’application ouvre la page du ticket (`#/caisse/ticket/…`), à imprimer sur un rouleau 80 mm (la longueur du papier suit celle du ticket) ou à envoyer par WhatsApp. Le ticket est la vue d’un paiement enregistré par le serveur : il ne se saisit, ne se modifie et ne se supprime pas. Il porte un numéro (`T-000123`), la mention **Original** ou **Duplicata n°X**, un QR code et un code de contrôle en clair, ainsi qu’un en-tête et un pied de page réglables.

- **Impression** : seul le bouton « Imprimer » de la page imprime un exemplaire numéroté et l’enregistre. La commande d’impression du navigateur (Ctrl+P ou menu) n’imprime qu’un avis, « Impression non enregistrée : utilisez le bouton Imprimer de la page. ». Une impression annulée compte quand même comme un exemplaire : le suivant est un duplicata.
- **WhatsApp** : le bouton ouvre WhatsApp avec le texte du ticket pour le numéro du membre ; il ne reste qu’à envoyer. Chaque envoi est tracé comme une impression.
- **Réimpression** : bouton « Ticket » dans le journal des encaissements et sur chaque paiement de la fiche du membre. Tous les rôles peuvent rouvrir un ticket ; chaque sortie est tracée (qui, quand, quel exemplaire).
- **Vérification publique** : le QR code (ou la saisie du numéro et du code sur `#/ticket`) ouvre une page sans connexion qui dit si le ticket est authentique et en montre le contenu : club, numéro, date, lignes, total, moyen de paiement, statut (valide, partiellement remboursé, remboursé), devise et fuseau du club, et seulement les initiales du client. Elle n’affiche jamais le téléphone, le nom complet, le numéro de membre, l’encaisseur ni la référence MoMo, et répond de la même façon qu’un numéro existe ou non. Après 5 essais ratés, il faut attendre une minute. Elle ne lit jamais l’espace démo.
- **Historique des tickets** (administrateurs) : bouton « Historique des tickets » sur la Caisse (`#/caisse/historique-tickets`), avec filtres par période et par employé ; un ticket sorti trois fois ou plus est signalé.
- **Réglages** : Paramètres › Club & Horaires, carte « Ticket de caisse » : texte d’en-tête (4 lignes, 200 caractères) et pied de ticket (2 lignes, 120 caractères, « Merci de votre visite » par défaut).
- **Mode démo** : le ticket porte le filigrane « DÉMO — SANS VALEUR », sans QR code ni code de contrôle, et WhatsApp montre le message sans rien ouvrir.

### Carte de débit (crédit en FCFA)

Chaque membre a, en plus de son temps de salle, un **crédit en FCFA** : il appartient au membre (pas à la carte, qu’on peut remplacer sans perdre le solde), ne descend jamais sous zéro, ne se rembourse jamais en espèces et n’expire pas. Tout se fait depuis la tuile « Carte » de la fiche du membre, qui montre la carte en 3D (un clic la retourne), le temps disponible, le crédit CFA et le détail des mouvements.

- **Recharger** : bouton « Recharger » de la tuile. Saisir le montant, le moyen de paiement (espèces, MoMo, etc.) et une référence. Le crédit est ajouté tout de suite et un ticket est créé, à faire signer au client : le club garde l’exemplaire signé, le client reçoit le sien par WhatsApp. L’argent compte en trésorerie **à la recharge**, et en recette **quand le crédit est consommé**.
- **Payer par la carte** : à l’encaissement d’une note, « Carte membre » est le premier choix dès que le solde est positif. Si le solde ne couvre pas tout, la carte paie ce qu’elle peut et le reste se règle par un autre moyen. Un paiement par la carte n’est pas une entrée d’argent : le ticket indique la part payée par la carte et le nouveau solde.
- **Réserver sans abonnement** : un membre sans formule en cours, ou sans temps restant, peut réserver une salle en la payant avec le crédit : cocher « Payer avec la carte » dans la réservation (la case est cochée d’office dans ce cas). Le prix est celui du réglage « Tarif du temps supplémentaire » (Paramètres : l’heure, et la demi-heure restante). Une annulation ou un remboursement rend la part payée par la carte sur le crédit, jamais en espèces.
- **Repas extérieur** : bouton « Repas extérieur ». Un client en salle commande chez un restaurant : le club paie le livreur depuis la caisse (la sortie d’argent est tracée), puis le même montant, sans frais de service, est débité du crédit du membre.
- **Annuler une recharge ou un repas (administrateurs)** : dans « Mouvements de la carte », « Annuler la recharge » ; sur un paiement de repas, « Annuler le repas ». Un motif de 3 à 300 caractères est obligatoire. Rien n’est effacé : l’annulation est un mouvement inverse, avec le motif et l’auteur, et la ligne annulée reste visible, barrée. Une recharge dont le crédit est déjà dépensé ne peut pas être annulée. Une erreur de montant se corrige en annulant la recharge puis en rechargeant ; il n’y a pas d’ajustement manuel du crédit CFA.
- **Renouvellement automatique** : tout abonnement en cours se renouvelle seul à son échéance, **avec la même formule, au prix actuel de la formule**, si le crédit suffit. Si le crédit ne suffit pas, rien n’est pris : une alerte apparaît sur l’Accueil et sur la fiche, avec un bouton WhatsApp qui prépare le message « il manque X FCFA ». Le même avertissement est donné **3 jours avant** l’échéance quand le solde ne suffira pas. Dès que le client recharge assez, le renouvellement se fait seul (pendant 30 jours après l’échéance) et le nouvel abonnement commence **le jour de la recharge** : le client ne paie pas les jours sans abonnement. « Annuler l’abonnement » arrête le renouvellement.
- **Tâche planifiée** : le contrôle des renouvellements est une tâche planifiée de Cloudflare qui s’exécute **chaque jour à 06:00** (heure de Brazzaville, soit 05:00 UTC, réglée dans `wrangler.jsonc`). Elle se lance aussi après chaque recharge. Rien d’autre à faire côté club ; en cas d’oubli, la première visite de l’Accueil le jour même rattrape ce qui était dû.
- **Imprimer la carte** : « Imprimer la carte » (page « Carte & QR ») imprime le **recto** (logo The Limen, nom, numéro) et le **verso** (QR code) côte à côte, au format carte bancaire (85,6 × 54 mm), sans effet 3D. Une carte désactivée n’imprime que son recto.
- **Mode démo** : tout fonctionne dans la démo (recharge, paiement par la carte, renouvellement) sans toucher au vrai club ; WhatsApp y montre le message sans rien ouvrir.

### Mode démo (entraînement)

Le mode démo est un espace d’entraînement intégré au site : on y apprend l’application, ou on essaie une manipulation, sans risque pour le vrai club. Il a sa **propre base de données**. On y retrouve le **catalogue réel du club** (les mêmes produits, avec leurs photos et un stock fictif de 10 pour chacun), à côté de données fictives : membres « Client Test », réservations, encaissements, relevés de cave et quelques produits d’exemple. Il reprend aussi les réglages du club : prix, formules, salles, moyens de paiement et catégories.

- **Qui** : le gérant et les administrateurs, avec leur propre compte. Aucun compte à mot de passe connu n’existe en ligne.
- **Entrer** : une fois connecté, cliquer sur le chapeau de diplômé orange « Mode démo (entraînement) », en bas du menu latéral ; sur téléphone, il se trouve dans le menu en haut à droite. La démo se crée et se remplit toute seule à la première entrée, et la visite guidée se propose à la première entrée dans un navigateur.
- **Reconnaître la démo** : un cadre orange entoure l’écran, le mot « DÉMO » apparaît en filigrane, un bandeau rayé « MODE DÉMO » reste en haut de chaque page et le titre de l’onglet commence par « [DÉMO] ». Les fichiers exportés en démo commencent par `DEMO_`.
- **Quitter** : le bouton « Quitter » du bandeau, ou « Quitter la démo » à la place du bouton d’entrée. Une page rechargée reste en démo ; se déconnecter ramène toujours au vrai site à la connexion suivante.
- **Rien de réel n’est touché** : ce qui se fait en démo (réservations, encaissements, réglages, exports) reste dans la démo, et rien de ce qui se fait dans le vrai club n’y apparaît. Du vrai club, la démo ne copie que les réglages, le nom et le rôle des comptes, et les produits en vente (sans leur stock, fictif en démo). Les photos restent dans le vrai club, qui les affiche aussi dans la démo ; elles se gèrent hors du mode démo. Le vrai site n’est jamais en mode démo : un tarif non validé y est refusé, alors que la démo l’accepte.
- **Comptes** : la gestion des comptes (créer ou modifier un compte, changer un mot de passe) se fait hors du mode démo ; Paramètres le rappelle : « Les comptes se gèrent hors du mode démo. » L’effacement complet des données n’existe pas non plus en démo, qui a sa propre remise à neuf.
- **Remettre la démo à neuf** (administrateurs) : dans Paramètres, onglet « Équipe & Système », carte « Espace démo ». Après confirmation, la démo est vidée puis remplie de nouveau de données fictives, avec les réglages et le catalogue actuels du vrai club. Il n’y a qu’une démo, la même pour tous : chacun y retrouve les essais des autres, jusqu’à la prochaine remise à neuf. C’est aussi le seul moment où un changement de réglage ou de produit du vrai club passe dans la démo.

## Architecture et validation

React 18 + Vite, React Router et Zustand pour l’interface. L’API tourne dans un **Cloudflare Worker**, avec SQLite dans un **Durable Object** ; un second Durable Object, avec sa propre base, porte le mode démo. La même logique métier s’exécute dans les tests Node.

- `worker/schema.js` : migrations transactionnelles et contraintes SQL. La v2 ajoute caves et relevés ; la v3 supprime les anciennes tables de casiers ; la v4 ajoute salles et participants ; la v5 conserve les salles retirées pour l’historique et met à niveau les premières bases v4 sans table de participants.
- `worker/api.js` : authentification, contrôle des rôles, vérification des origines et idempotence.
- `worker/club.js`, `worker/ledger.js`, `worker/lounge.js` : règles métier côté serveur.
- `worker/space.js` : aiguille chaque requête vers le vrai club ou vers la démo (en-tête `X-Club-Espace`). La session reste celle du vrai club, qui garantit à la démo l’identité de la personne connectée ; la démo n’ouvre jamais de session.
- `worker/seed.js` : données fictives de la démo et comptes du développement local.
- `test/` : scénarios API, montants, crédits, concurrence, rôles, conservation, migration, redémarrage et isolation de la démo.

```sh
npm test
npm run build
```

Les écritures et leur audit sont atomiques. Les requêtes rejouées avec la même clé d’idempotence n’appliquent pas deux fois une opération.

Le workflow GitHub vérifie les tests et la compilation. Il ne déploie pas le site : **GitHub Pages ne peut pas héberger cette API ni sa base SQLite**.

## Installation sur Cloudflare

La mise en ligne se fait explicitement, après configuration de l’accès Cloudflare : `npm test`, puis `npm run deploy`. Il n’y a qu’un seul site, celui des clients (`https://club-prive.ramikaze.workers.dev`) ; pour s’exercer ou essayer une manipulation, on utilise le mode démo, intégré à ce site. Le fichier `wrangler.jsonc` configure les ressources (les Durable Objects du club et de la démo) et la distribution de `dist/`.

Pour une installation réelle, ne pas définir `DEMO_ACCOUNTS`. Configurer le secret d’installation avant de créer le premier administrateur :

```sh
npx wrangler secret put SETUP_TOKEN
```

Ouvrir l’application et créer le premier compte avec ce code. Le même code sert si l’identifiant ou le mot de passe est perdu : sur la page de connexion, « Identifiant ou mot de passe oublié ? » donne un nouvel identifiant et un nouveau mot de passe au compte du premier administrateur et ferme ses sessions ouvertes. Ce code doit donc rester secret. Valider ensuite les tarifs et les paramètres avant l’utilisation réelle : sur le vrai site, une vente fondée sur un tarif non validé ou sur un prix non défini est refusée par le serveur. Seul le mode démo, qui a sa propre base, les accepte.

L’effacement des données depuis les paramètres inclut caves et relevés. Il conserve les utilisateurs, les paramètres, les formules et les catégories. Cette opération est définitive et ne remplace pas une sauvegarde. Elle ne concerne que le vrai club : l’espace démo a sa propre remise à neuf.
