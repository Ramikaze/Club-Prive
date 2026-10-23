# Mode démo d'entraînement — conception

Date : 2026-10-23 · Projet : Club Privé (club « Limen »), site des clients https://club-prive.ramikaze.workers.dev

## Pourquoi

Le site de test séparé (club-prive-test) a été supprimé : le propriétaire le jugeait inutile. Le besoin réel est ailleurs : **le gérant (l'employé) doit pouvoir apprendre à se servir de l'application sur le vrai site, sans risque pour les vraies données du club.** Le mode démo est un espace d'entraînement intégré au site des clients, avec des données fictives rangées à part.

Comptes du site : les administrateurs sont les associés et le propriétaire (qui construit le site) ; il n'existe qu'un compte supplémentaire, le gérant.

## Objectifs

- Depuis le vrai site, une fois connecté, un clic sur une icône ouvre un espace démo aux données fictives ; un clic en sort.
- Rien de ce qui se fait en mode démo ne touche les vraies données, et inversement.
- Impossible de confondre le mode démo avec la vraie version, d'un coup d'œil, sur n'importe quelle page.
- Un seul espace démo, partagé et durable : chacun y retrouve les essais des autres (décision du propriétaire).
- Accessible au gérant **et** aux administrateurs (décision du propriétaire).

## Hors sujet

- Pas de comptes de démonstration aux mots de passe connus en ligne (le dépôt GitHub est public et `worker/seed.js` contient les mots de passe de démo). On entre en démo avec son vrai compte.
- Pas de nouveau site ni de nouveau Worker Cloudflare.

## À éviter absolument (échec même si « ça marche »)

- Une action faite en démo qui modifie le vrai club : réservation, encaissement, membre, réglage, **compte utilisateur** ou mot de passe.
- Un gérant qui se croit sur la vraie version alors qu'il est en démo, ou l'inverse.
- Des données fictives qui apparaissent dans le vrai club (chiffres, exports, journal).

## Ce que le propriétaire a décidé

1. **Signalement : version C.** En mode démo, un cadre orange épais entoure tout l'écran ; le mot « DÉMO » est écrit en grand, en filigrane transparent, derrière le contenu ; un bandeau rayé orange « MODE DÉMO » avec un bouton « Quitter » reste en haut de chaque page. Les couleurs normales de l'application restent. Maquettes : `.superpowers/brainstorm/*/content/signal-demo.html` et `entree-demo.html`.
2. **Entrée : icône en bas à gauche du menu latéral**, dans la rangée de boutons du bloc utilisateur (`.side-user` de `src/components/layout/AppShell.jsx`, à côté de Mot de passe, Thème et Déconnexion). Icône orange 🎓, info-bulle « Mode démo (entraînement) ». En démo, ce bouton devient « Quitter la démo ».
3. **Données durables et partagées** : les essais restent d'une personne à l'autre.
4. **Accès** : gérant et administrateurs.
5. **L'ancien « Mode démonstration » disparaît** : la section « Mode démonstration » de Paramètres (bascule `demo_mode`, chargement des données fictives dans le vrai club via `POST /api/admin/demo`) est supprimée. Le site des clients est toujours en utilisation réelle. Le bouton « Effacer les données » (`POST /api/admin/reset`, mot `EFFACER`) reste.
6. **La démo reprend les vrais réglages du club** : prix, formules, salles, moyens de paiement, règles de réservation, catégories. Ils sont copiés depuis le vrai club à la création de la démo et à chaque « Remettre la démo à neuf ». Les membres, réservations, ventes et mouvements d'argent de la démo restent fictifs (`seedDemo`).
7. **Le vrai site ne contient encore rien de réel.** Il sera vidé une fois à la mise en ligne (voir plus bas).
8. **Tarifs : mise en ligne sans attendre.** L'abonnement annuel n'a pas de prix et le tarif des dépassements n'est pas validé. Après la mise en ligne, ces ventes sont refusées sur le vrai site, avec les messages existants, jusqu'à ce qu'un administrateur les règle dans Paramètres. C'est accepté.

## Choix faits par Claude (à vérifier par le propriétaire)

- **Sur téléphone**, le menu latéral n'existe pas : la même entrée « Mode démo » / « Quitter la démo » est ajoutée au menu ☰ (`AccountMenu`).
- **Persistance** : on reste en démo après un rechargement de page ; on en sort avec « Quitter » ou à la déconnexion. La reconnexion ramène toujours à la vraie version.
- **Remise à neuf** : un bouton réservé aux administrateurs, « Remettre la démo à neuf », vide l'espace démo et le recharge avec les données fictives d'origine (confirmation demandée). Visible seulement en mode démo, dans Paramètres.
- **Règles souples en démo** : les tarifs non validés sont utilisables en démo (comportement de l'ancien `demo_mode`), jamais sur le vrai site.
- **Visite guidée** : à la première entrée en démo dans un navigateur, la visite guidée existante se propose (elle s'ouvrait jusqu'ici quand `demo_mode` était actif).
- **Comptes utilisateurs en démo** : la gestion des comptes (Utilisateurs, changement de mot de passe) est bloquée en démo, avec le message « Les comptes se gèrent hors du mode démo ». Raison : ces actions toucheraient le vrai club.
- **Exports en démo** : les fichiers exportés portent le préfixe `DEMO_` dans leur nom.
- **Nettoyage du site de test supprimé** : retirer `env.test` de `wrangler.jsonc`, le script `deploy:test` de `package.json`, et le bandeau `instanceLabel` / `INSTANCE_LABEL` devenu inutile.

## Comment ça marche (orientation technique)

Les données du club vivent dans un Durable Object `ClubDO` avec sa base SQLite, joint par `env.CLUB.idFromName('club')` dans `worker/index.js`. Toute l'API (`worker/api.js`) tourne dans ce Durable Object ; la session est un cookie `sid` dont le hash est dans la table `sessions` du vrai club.

Orientation retenue : **un second Durable Object de la même classe, `idFromName('demo')`**, avec sa propre base. Le vrai club ne voit jamais ses données.

- **Choix de l'espace** : le navigateur signale le mode démo à chaque requête (par exemple un en-tête `X-Club-Espace: demo` ajouté par `src/lib/api.js`). Le Worker d'entrée oriente la requête vers le bon Durable Object.
- **Identité** : la session reste celle du vrai club. Pour une requête démo, le Worker vérifie d'abord la session auprès du vrai club, puis transmet la requête au Durable Object démo avec l'identité vérifiée (id, nom, rôle). L'en-tête interne qui porte cette identité est toujours retiré des requêtes venant du navigateur. Le Durable Object démo ne fait jamais confiance au navigateur.
- **Utilisateurs dans la base démo** : de nombreuses tables référencent `users(id)`. La base démo tient une copie minimale de l'utilisateur (id, nom, rôle, sans mot de passe), mise à jour à chaque requête. Personne ne peut se connecter directement à la démo.
- **Routes toujours réelles** : connexion, déconnexion, installation (`/api/setup*`) et `/api/me/password` vont toujours au vrai club. En démo, les routes de gestion des comptes (`/api/users*`, `/api/me/password`) sont refusées.
- **Remplissage** : au premier accès, si la base démo est vide, le Worker lit la configuration du vrai club (réglages sauf `demo_mode` et `opening_balances`, formules et prix, salles, catégories), l'applique à la base démo, puis la remplit avec `seedDemo` (`worker/seed.js`) sous un auteur fictif. « Remettre la démo à neuf » vide entièrement la base démo et refait la même chose. *(Choix de Claude : les changements de réglages faits ensuite sur le vrai club n'atteignent la démo qu'à la prochaine remise à neuf.)* Le constructeur vérifie que `seedDemo` fonctionne avec des réglages réels, par exemple des salles ou des moyens de paiement différents, ou une formule sans prix.
- **`demo_mode`** : la notion ne dépend plus d'un réglage modifiable. Elle vaut « vrai » dans le Durable Object démo et « faux » dans le vrai club, y compris si l'ancien réglage stocké valait « vrai ». `demo_mode` est retiré de `PUT /api/settings` et de l'écran Paramètres.
- **Interface** : l'état « en démo » vit dans le store (`src/store/useStore.js`), mémorisé dans le navigateur pour survivre au rechargement, et effacé à la déconnexion. Entrer ou sortir recharge les données affichées (`/api/me`). Le cadre, le filigrane et le bandeau sont rendus par `AppShell`.
- **Tests** : les tests Node (`test/*.test.js`, `test/harness.js`) appellent `createApi` directement. Ils doivent couvrir l'isolation : une écriture en démo n'apparaît pas dans le vrai club, la gestion des comptes est refusée en démo, et une identité forgée par le navigateur est ignorée.

Laissé au constructeur : le nom exact de l'en-tête et le mécanisme de transmission de l'identité (en-tête interne ou appel RPC du Durable Object), le choix de l'icône dans la bibliothèque existante (`Icon`), le détail du CSS (en suivant les variables de `src/club.css`, orange proche de `#e07b00`, lisible en thème clair et sombre), et la forme de la confirmation de remise à neuf.

## Mise en ligne

Mise en ligne sur le site des clients seulement (`npm test`, puis `npm run deploy`), sans attendre le réglage des tarifs.

Juste après la mise en ligne, un administrateur vide une fois le vrai site avec « Effacer les données » dans Paramètres (saisir `EFFACER`). Les comptes, réglages et formules sont gardés. Ce nettoyage retire les données fictives éventuelles, ainsi que les réservations ou ventes enregistrées sous l'ancien mode démonstration avec des tarifs non validés : celles-ci resteraient sinon bloquées à la caisse pour toujours (`tariff_validated` est figé à la création). Le propriétaire l'a accepté, car le vrai site ne contient encore rien de réel. C'est une action irréversible : la reconfirmer avec lui au moment de la faire. Aucun code de migration n'est nécessaire.

Ensuite, un administrateur fixe le prix de l'abonnement annuel et valide les tarifs (formules, dépassements) dans Paramètres. Jusque-là, ces ventes sont refusées sur le vrai site.
