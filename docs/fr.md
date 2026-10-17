# Bosch Indego

Connecteur non officiel, sans lien avec Bosch. Indego et Bosch sont des
marques de leur propriétaire.

Cette intégration lit vos tondeuses robots **Bosch Indego** par le cloud
Bosch, avec le compte Bosch SingleKey ID de l'application Bosch Indego, et
permet à Gladys de les faire tondre, de les mettre en pause et de les
renvoyer à leur station.

> **Jamais testée sur un vrai compte ni une vraie tondeuse pour l'instant.**
> Elle suit ce que font l'intégration Home Assistant (sander1988/Indego) et
> sa bibliothèque (sander1988/pyIndego), et n'a été testée que sur des
> réponses d'exemple. Si quelque chose semble faux, ouvrez un ticket avec
> les logs de l'intégration.

## Ce que vous obtenez

Un appareil par tondeuse du compte :

| Fonction                    | Ce qu'elle montre                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------ |
| État                        | En marche, en pause, retour à la station, en charge, à la station, erreur, arrêtée   |
| Tondre / pause              | Choix : _Tondre_ lance la tonte, _Pause_ arrête la tondeuse là où elle est           |
| Retour à la station         | Bouton : renvoie la tondeuse à sa station                                            |
| Batterie                    | Niveau en %                                                                          |
| Activité                    | L'état détaillé, en texte (« Tonte, relocalisation », « Bloquée sur la pelouse »...) |
| Code d'état                 | Le code d'état brut de Bosch (pour les scènes et le dépannage)                       |
| Progression de la tonte (%) | La part de la pelouse tondue pendant la tonte en cours                               |
| Prochaine tonte             | La prochaine tonte prévue par SmartMowing, à l'heure du jardin, ou « Aucune prévue » |
| Alertes non lues            | Nombre d'alertes non lues du cloud Bosch pour cette tondeuse                         |
| Dernière alerte             | Titre et message de l'alerte la plus récente                                         |
| En ligne                    | 0 quand le cloud signale la tondeuse hors ligne                                      |

Un déclencheur de scène, **Alerte Indego**, se déclenche une fois pour chaque
nouvelle alerte non lue (bloquée, soulevée, rappel de lame...), avec la
tondeuse, le code d'erreur, le titre, le message et le niveau en variables.
Les alertes déjà présentes au démarrage de l'intégration ne le déclenchent
jamais.

## Se connecter

Bosch SingleKey ID ne renvoie la connexion qu'à l'application Bosch Indego
(une adresse qui commence par `com.bosch.indegoconnect://`), qu'aucun
navigateur ne sait ouvrir. L'intégration se connecte donc en deux temps,
sans extension de navigateur :

1. Dans l'onglet **Configuration**, cliquez sur **Connecter** à côté de
   « Compte Bosch SingleKey ID » (ou sur l'action **Démarrer la connexion**
   en bas, qui affiche le même genre d'adresse en texte). Ouvrez l'adresse
   dans le navigateur d'un ordinateur (Chrome, Edge, Firefox).
2. **Avant de vous connecter**, ouvrez les outils de développement du
   navigateur : **F12**, puis l'onglet **Console**.
3. Connectez-vous avec votre Bosch SingleKey ID (l'e-mail et le mot de passe
   de l'application Indego). À la fin, la page s'arrête et la console affiche
   une ligne comme :
   `Failed to launch 'com.bosch.indegoconnect://login?state=…&code=…' because the scheme does not have a registered handler.`
   Si la console n'affiche rien (Firefox), ouvrez plutôt l'onglet **Réseau**,
   cliquez sur la dernière requête nommée `authresp` et copiez la valeur de
   son en-tête de réponse **Location**.
4. Copiez cette adresse (ou toute la ligne de la console : l'intégration y
   trouve l'adresse) dans l'action **Terminer la connexion**, puis cliquez
   dessus, **dans les 15 minutes** (le code expire vite et ne sert qu'une
   fois).

L'action répond « Connecté : N tondeuses trouvées ». Les tondeuses
apparaissent alors dans l'onglet **Découverte** : ajoutez-les.

### Ce qui est gardé, et où

L'intégration ne voit jamais votre mot de passe : c'est la page de Bosch qui
le reçoit. Après la connexion, Gladys garde un **jeton de renouvellement**
(et le jeton d'accès, de courte durée) dans sa base de données, **en clair**
comme toute valeur de configuration d'une intégration (et donc dans ses
sauvegardes) : il n'est jamais réaffiché dans l'interface et n'est envoyé
qu'à Bosch. Toute personne qui peut lire la base de Gladys ou une sauvegarde
peut s'en servir pour accéder à votre compte Indego : protégez-les en
conséquence. Pour le révoquer, changez le mot de passe de votre Bosch
SingleKey ID ou fermez la session depuis votre compte Bosch.

Le jeton est renouvelé tout seul, 5 minutes avant son expiration. Si Bosch
refuse le renouvellement (mot de passe changé, session révoquée, inutilisée
trop longtemps), l'intégration cesse d'appeler Bosch et l'état de la
connexion vous demande de vous reconnecter : reprenez à l'étape 1.

## Réglages

- **Intervalle de relecture pendant la tonte** (5 min par défaut, de 2 à 60) : à quel rythme l'état et la progression de la tonte sont relus quand
  la tondeuse est hors de sa station (et tout le temps quand l'état en direct
  est coupé).
- **État en direct (longue interrogation)** (activé par défaut) : le cloud
  Bosch garde une requête par tondeuse et répond dès que l'état change, ou au
  bout de 4 minutes environ. Coupez-le si votre réseau interrompt les
  requêtes longues : l'état est alors relu à l'intervalle ci-dessus.
- **Langue** des noms des fonctions (fixés à l'ajout de la tondeuse) et des
  textes (activité, prochaine tonte, dernière alerte).

## Usage du cloud Bosch

Le cloud Bosch ne documente aucune limite. L'intégration reste en dessous de
ce que fait l'intégration Home Assistant :

- la longue interrogation : une requête en attente par tondeuse, jamais deux
  en moins de 30 secondes ;
- l'état toutes les 5 minutes (réglage) quand la tondeuse est sortie, pour la
  progression ;
- la batterie toutes les 10 minutes quand la tondeuse est sortie ou en
  charge, toutes les 6 heures sinon ;
- alertes et prochaine tonte toutes les 10 minutes ; la liste des tondeuses
  toutes les 12 heures et à chaque recherche dans Découverte ;
- autour d'une commande : l'état relu juste avant, puis 10 s et 45 s après.

En cas d'erreur, elle attend 30 s, 1, 2, 5, 10 puis 15 minutes entre les
essais. Un HTTP 429 (trop de requêtes) met en pause **tous** les appels,
commandes comprises, le temps que Bosch demande (de 1 minute à 6 heures ;
5 minutes s'il ne le précise pas).

## Commandes

Le choix **Tondre / pause** et le bouton **Retour à la station** envoient
les commandes `mow`, `pause` et `returnToDock` du cloud Bosch. Pour chaque
commande, l'intégration :

- n'exécute qu'une commande à la fois par tondeuse ;
- relit l'état de la tondeuse juste avant, et n'envoie **pas** la commande
  si l'état ne peut pas être lu, si la tondeuse est hors ligne, ou si la
  commande ne changerait rien (retour à la station alors qu'elle y est) ;
- refuse la commande, avant d'envoyer quoi que ce soit, quand le cloud est
  trop lent pour répondre en 3,5 secondes (Gladys abandonne au bout de
  5 secondes) : Gladys affiche alors une erreur et rien n'a été envoyé ;
  réessayez ;
- relit l'état 10 et 45 secondes après.

## Actions de l'écran de configuration

- **Démarrer la connexion** : affiche une adresse de connexion (voir plus
  haut).
- **Terminer la connexion** : reçoit l'adresse collée.
- **Tester Indego** : lit les tondeuses du compte et affiche l'état et la
  batterie de chacune.

## Dépannage

- _« Cette adresse ne correspond à aucune connexion démarrée dans les 15
  dernières minutes »_ : cliquez à nouveau sur **Démarrer la connexion** (ou
  Connecter) et utilisez la nouvelle adresse ; chaque adresse ne sert qu'une
  fois.
- _« Connexion refusée par Bosch (invalid_grant …) »_ : le code a expiré ou a
  déjà servi : recommencez.
- _« La passerelle du cloud Indego refuse les appels »_ (HTTP 403) : la
  passerelle Azure devant l'API bloque certaines requêtes ; l'intégration
  réessaie toute seule.
- Les logs ne contiennent jamais de jeton, de code ni de mot de passe.
  Passez `LOG_LEVEL=debug` pour plus de détails.

## Crédits

L'API, la connexion, les codes d'état et l'échelle de batterie viennent de
[sander1988/pyIndego](https://github.com/sander1988/pyIndego) (MIT) et de
[sander1988/Indego](https://github.com/sander1988/Indego) (Apache-2.0),
l'intégration Home Assistant. Voir `THIRD_PARTY_NOTICES.md`.
