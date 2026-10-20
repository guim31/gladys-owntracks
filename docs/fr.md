# OwnTracks

Amène dans Gladys les téléphones suivis par [OwnTracks](https://owntracks.org),
l'application de localisation libre et respectueuse de la vie privée pour
Android et iOS, au travers de votre propre **OwnTracks Recorder**. Chaque
téléphone devient un appareil Gladys qui dit s'il est à la maison, à quelle
distance de la maison il se trouve, dans quelle région OwnTracks il est et ce
qu'il lui reste de batterie ; des scènes peuvent réagir quand un téléphone
rentre ou part, entre dans une région ou en sort, ou n'envoie plus de position ;
un téléphone à la maison peut piloter la présence d'un utilisateur Gladys.

Testée contre un vrai OwnTracks Recorder 1.0.4 avec des téléphones simulés
(positions envoyées par son API HTTP), pas avec des téléphones sur la route :
vos retours sont les bienvenus.

## Prérequis

- Gladys 5.1 ou plus récent.
- Un [OwnTracks Recorder](https://github.com/owntracks/recorder) que Gladys
  peut joindre sur votre réseau, en général sur le port 8083 (par exemple
  l'image Docker `owntracks/recorder`).
- L'application OwnTracks sur chaque téléphone, qui envoie ses positions au
  Recorder : par votre broker MQTT, ou en mode HTTP directement au Recorder
  (`/pub`). Gladys lit seulement le Recorder ; il ne parle jamais aux
  téléphones.

## Configuration

1. Dans Gladys, ouvrez l'onglet **Configuration** de l'intégration :
   - **Adresse du Recorder** : telle que vous l'ouvrez dans votre navigateur,
     par exemple `http://192.168.1.20:8083`. Sans port, 8083 est utilisé. Un
     Recorder derrière un proxy inverse fonctionne aussi, avec son chemin
     (`https://example.com/owntracks`).
   - **Utilisateur du proxy** et **Mot de passe du proxy** : seulement si un
     proxy inverse protège le Recorder par un mot de passe (Basic auth). Le
     Recorder lui-même n'en a pas.
2. Enregistrez. Le bouton **Tester la connexion** affiche la version du
   Recorder, le nombre d'utilisateurs et de téléphones qui ont une position.
3. Ouvrez l'onglet **Découverte** et ajoutez les téléphones voulus dans Gladys.

**Maison et présence** (facultatif) :

- La **maison** est un rayon (150 m par défaut) autour de l'emplacement de
  votre maison Gladys (**Paramètres → Maisons**). Avec plusieurs maisons,
  indiquez le nom de celle à utiliser ; par défaut, la première qui a un
  emplacement.
- Ou indiquez une **région OwnTracks** (une région définie dans l'application,
  par exemple `Maison`) : un téléphone est alors à la maison quand
  l'application dit qu'il y est, et le rayon est ignoré. Les régions sont
  surveillées par le téléphone lui-même : c'est le choix le plus fiable et le
  plus économe en batterie.
- **Présence : dernière position au plus** : un téléphone à la maison ne
  continue de dire « vu à la maison » que tant que sa dernière position date de
  moins que ce délai (2 heures par défaut). Un iPhone en mode _Significatif_
  n'envoie rien tant qu'il ne bouge pas : gardez un délai long.
- **Partager les coordonnées avec Gladys** : désactivé par défaut, voir Vie
  privée ci-dessous.
- **Langue** : la langue des noms de fonctionnalités et des textes écrits par
  l'intégration (régions, phrases). Français par défaut.

## Vie privée

Par défaut, les coordonnées des téléphones ne sortent jamais de
l'intégration : Gladys reçoit la présence, la distance de la maison, le nom des
régions et la batterie, rien de plus. Avec **Partager les coordonnées avec
Gladys**, le widget et les scènes reçoivent aussi un lien vers la position sur
OpenStreetMap. Coordonnées et noms de régions ne sont jamais écrits dans les
logs.

## Appareils

Un appareil par téléphone du Recorder (un utilisateur et un nom d'appareil dans
OwnTracks), nommé d'après sa carte OwnTracks quand il en a une.
Fonctionnalités :

| Fonctionnalité        | Ce qu'elle affiche                                                        |
| --------------------- | ------------------------------------------------------------------------- |
| À la maison           | Oui ou non, selon la règle de la maison ci-dessus                         |
| Présence              | Un signal « vu à la maison » pour la présence d'un utilisateur (ci-après) |
| Distance de la maison | En km, jusqu'à la maison Gladys                                           |
| Batterie              | En % du téléphone                                                         |
| Dernière position     | Date et heure de la dernière position                                     |
| Région OwnTracks      | Les régions où se trouve le téléphone, ou « Hors région »                 |

La distance demande une maison Gladys située ; À la maison et Présence
demandent une règle de maison (rayon ou région).

Les mises à jour sont en direct : le Recorder pousse chaque nouvelle position à
l'intégration par son WebSocket (`/ws/last`). Si le lien tombe, l'intégration
lit le Recorder toutes les minutes jusqu'à son retour : la dernière position de
chaque téléphone est rattrapée, pas les positions intermédiaires.

### Présence d'un utilisateur

Gladys décide qui est à la maison avec des scènes. Deux façons, qui se
combinent bien :

- **Simple** : une scène déclenchée quand la fonctionnalité **À la maison** du
  téléphone passe à 1, avec l'action **Utilisateur vu à la maison** ; une
  seconde quand elle passe à 0, avec **Utilisateur parti de la maison**. Les
  déclencheurs **Un téléphone arrive à la maison** et **Un téléphone quitte la
  maison** de l'intégration font de même.
- **Robuste** : la fonctionnalité **Présence** envoie un signal « vu à la
  maison » à chaque position à la maison, puis toutes les 5 minutes tant que la
  dernière position est récente. Une scène planifiée (toutes les 5 ou 10
  minutes) avec l'action **Vérifier la présence** (l'utilisateur, la maison, la
  fonctionnalité **Présence** de son téléphone, un délai comme 15 minutes)
  marque l'utilisateur absent quand le téléphone n'a pas été vu à la maison
  depuis ce délai — même s'il n'a plus de batterie au bureau.

## Widget du tableau de bord

Le widget **Téléphones et présence** liste chaque téléphone (huit au plus) avec
sa région, l'heure de sa dernière position et sa présence en pastille de
couleur (à la maison, absent, inconnu). Touchez un téléphone pour voir sa
batterie, sa distance de la maison, la précision de la position et un lien vers
la carte quand les coordonnées sont partagées.

## Scènes

**Déclencheurs** (catégorie Intégrations de l'éditeur de scènes) :

- **Un téléphone arrive à la maison** et **Un téléphone quitte la maison** : le
  téléphone était absent et il est maintenant à la maison, ou l'inverse.
  Filtre : le téléphone (vide : n'importe lequel). Informations transmises : le
  nom du téléphone, l'heure de la position.
- **Un téléphone entre dans une région** et **Un téléphone sort d'une
  région** : l'application OwnTracks signale le téléphone dans l'une de ses
  régions, ou hors d'elle. Filtres : le téléphone et le nom de la région,
  exactement comme dans OwnTracks (vide : n'importe lequel). Informations
  transmises : le nom du téléphone, la région, l'heure, le lien vers la carte
  (si partagé).
- **Plus de position reçue** : aucune nouvelle position du téléphone depuis 1,
  2, 3, 6, 12, 24 ou 48 heures (obligatoire) : l'application s'est peut-être
  arrêtée, ou le téléphone est éteint. Une seule fois par silence ; une
  nouvelle position remet à zéro. Informations transmises : le nom du
  téléphone, l'heure de la dernière position.

Seuls les téléphones ajoutés à Gladys déclenchent des scènes. Un passage qui a
eu lieu pendant que Gladys ou le Recorder était injoignable déclenche en
retard, au retour du lien.

**Action** **Lire la position d'un téléphone** : une phrase toute faite
(« Alice (phone) est à la maison, position de 16:08. ») et les valeurs, pour un
message ou une condition : présence, à la maison (oui/non), région, distance de
la maison (km, -1 si inconnue), batterie (%, -1 si inconnue), heure de la
position, lien vers la carte (si partagé).

## Exemples de scènes

- **Bienvenue** : déclencheur **Un téléphone arrive à la maison** (téléphone
  d'Alice) → allumer la lumière de l'entrée s'il fait nuit.
- **Le dernier sorti** : déclencheur **Un téléphone quitte la maison** →
  condition « personne à la maison » → armer l'alarme et baisser le chauffage.
- **Les enfants à l'école** : déclencheur **Un téléphone entre dans une
  région** (région `École`) → envoyer un message avec le nom du téléphone et
  l'heure (insérés depuis le sélecteur de variables).
- **Suivi arrêté** : déclencheur **Plus de position reçue** (6 heures) →
  envoyer un message : l'application a sans doute été coupée par l'économiseur
  de batterie.

## Dépannage

- **« Le Recorder ne répond pas »** : ouvrez l'adresse dans un navigateur
  depuis la machine de Gladys ; vérifiez le port (8083 par défaut) et que le
  Recorder écoute sur le réseau (`OTR_HTTPHOST=0.0.0.0` en Docker).
- **« Refusé le nom d'utilisateur et le mot de passe »** : le proxy inverse
  devant le Recorder les a refusés. Sans proxy, laissez les deux champs vides.
- **Aucun appareil dans Découverte** : le Recorder n'a encore aucune position.
  Vérifiez dans sa page web (`/last`) que les téléphones apparaissent.
- **Un téléphone n'est jamais à la maison** : vérifiez l'emplacement de la
  maison Gladys, ou le nom exact de la région OwnTracks (majuscules
  indifférentes). Avec un rayon, une position peut être fausse de sa précision
  (affichée dans le widget).
- **Pas de mise à jour en direct** : un proxy inverse doit laisser passer le
  WebSocket `/ws/last`. Sans lui, les positions arrivent quand même, toutes les
  minutes.
- **Le téléphone n'envoie rien pendant des heures** : dans OwnTracks, le mode
  _Significatif_ n'envoie une position qu'après un déplacement de plusieurs
  centaines de mètres ; l'économiseur de batterie d'Android peut aussi arrêter
  l'application. Voir la documentation d'OwnTracks.

## Limites

- Lecture seule : l'intégration n'envoie jamais rien aux téléphones (ni
  configuration à distance, ni demande de position).
- Pas d'historique : seulement la dernière position. Pour l'historique et les
  statistiques, voir l'intégration Dawarich.
- Les déclencheurs de région suivent les régions définies dans l'application
  OwnTracks ; les points et les amis du Recorder ne sont pas utilisés.
- Les positions sont comparées à la maison Gladys telles quelles, sans tenir
  compte de leur précision.
- Développée sans téléphone sur la route : testée contre un vrai Recorder avec
  des positions simulées. Vos retours sont les bienvenus.
