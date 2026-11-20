# INGA — Léandre · galerie d'art interactive (branche inga-lele-dev)

Galerie d'art 3D navigable dans le navigateur, réalisée avec Three.js et Vite.

## À propos de cette version

**Cette v4 est la suite de la version « légère » de la v3** (la v3 de la branche `dev`, plus le mode qualité LÉGER / MOYEN / ÉLEVÉ).

⚠️ **Elle a été entièrement réalisée et testée sur un MacBook Pro 13" 2020 à puce Intel (Intel Iris Plus 645, 8 Go).** Tous les réglages ont été pensés pour rester fluides en mode LÉGER sur cette machine : résolution réduite, ombres et effets simplifiés, géométrie allégée. **Il faudrait reprendre et affiner le code sur un ordinateur avec plus de puissance de calcul**, pour monter en résolution et vérifier les modes MOYEN et ÉLEVÉ (reflets, brouillard volumétrique, ombres des lianes…), qui n'ont presque pas été testés.

## Nouveautés de la v4

**Page d'accueil**
- Fond uni couleur « minéral » de la palette, grand mot INGA barré, « LÉANDRE », « GALERIE D'ART », « SON NON FACULTATIF ».
- *Slide to unlock* : la petite flèche posée sur le N se glisse vers la gauche. Une fissure brutaliste (traits droits, angles droits) grandit avec le geste et traverse presque toute la page ; la galerie s'ouvre au seuil. Un souffle d'air doux accompagne la fissure.
- Poussée trop à droite, la flèche tombe (gravité, rebonds) : il faut la ramasser et la reposer sur la barre.

**Galerie**
- Hall agrandi, deux couloirs étroits et très hauts qui partent des coins sud.
- Salon de mousse : un grand sol de mousse plat et doux sur tout le côté droit de la galerie (en regardant la baie). Le ruisseau du milieu le traverse, sans pont. La mousse reprend sur la terrasse, derrière la vitre, et monte un peu sur le pied du pilier. Côté gauche : seulement le sol en pierre et le ruisseau.
- Canapé en cuir sombre, galet-lit en pierre, banc.
- Marche : on peut aller partout. On entre et on sort du ruisseau, on monte sur les ponts, on saute par-dessus le ruisseau, on grimpe sur le banc ou le canapé d'un saut. On ne traverse plus les ponts ni le battant de la porte, et on ne reste plus bloqué quand la porte s'ouvre.
- Ruisseau intérieur (canal) retravaillé : ~35 cm d'eau, fond de gravier et galets aux couleurs de la palette (certains moussus), eau transparente/réfléchissante avec reflets lumineux au fond et sur le bas des murs, herbes aquatiques, feuilles qui flottent. On peut marcher dans l'eau.
- 20 poissons de ruisseau japonais et poissons-chats (orange, jaune, bruns) qui ondulent, laissent un sillage, accélèrent parfois et sautent de temps en temps.
- Baie vitrée sur toute la largeur du mur du fond (grands panneaux, fins montants acier) et grande porte pivotante interactive (E sur ordinateur, toucher le pop-up sur téléphone).
- Terrasse couverte de 9 m : toit en béton brut à poutres, gros pilier rond, rideau de lianes, bassin d'eau.
- Plafond : fines fentes droites d'origine, mousse et plantes sur le toit, beaucoup de lianes qui pendent.
- Lumière d'aube en montagne, poussière dans les rayons.
- Palette de matières appliquée à l'interface (béton clair, béton ombré, mousse, pierre chaude, minéral, bois sombre, lumière, ombre).

**Extérieur**
- La vallée est l'extérieur de la galerie : un seul espace. La galerie est posée sur des piliers au-dessus du ruisseau, qui a de l'eau en mouvement. Ciel d'aube et fine brume au sol.

**Son (toujours actif, tout est synthétisé)**
- Brise légère (esprit jardin japonais), oiseaux lointains rares, murmure du ruisseau extérieur entendu doucement à travers la baie (plus fort porte ouverte et sur la terrasse), air qui passe par les fentes du plafond.
- Canal : bulles et remous seulement quand un poisson bouge, petits « ploufs » des sauts, gouttes.
- Pas en chaussons sur le béton, appuis feutrés sur la mousse, pas dans l'eau ; léger frottement au sol de la porte qui pivote.

## Fumée et physique (reprises de la branche `smoke`)

Le comportement vient de la branche `smoke`, le visuel de la galerie reste celui d'`inga-lele-dev`.

- **Brouillard / fumée 3D** (`src/smoke3d.js`) : volume simulé sur le GPU ; le brouillard du hall est lourd, tombe sous la gravité et coule le long des murs.
- **Vitesses de la fumée** (`src/smokeVelWorker.js`) : solveur spectral (FFT 3D) dans un worker, avec murs, sol et plafond pris en compte.
- **Bac à fumée** (niveau « smoke ») : coupe 2D (`src/smoke2d.js`) ou volume 3D, plusieurs algorithmes (Stam, MacCormack, advection-réflexion, particules de vorticité…), boutons « lâcher une bouffée » / « vider le bac ».
- **Panneaux de réglages** : viscosité, dissipation, poids, tourbillons, résolution, sources et aspirateurs de fumée, occlusion ambiante, soleil… Les réglages sont gardés dans le navigateur (localStorage).
- **Autres niveaux** : carte brutaliste (`src/brutal.js`), atelier, mannequin (`src/dummy.js`), décalques de peinture (`src/paintDecals.js`), outil de construction (`src/builder.js`).
- La marche d'`inga-lele-dev` (règle de hauteur de pas, ponts, porte) s'applique aussi aux nouveaux niveaux.
- `node fftcheck.mjs` vérifie la FFT de la simulation (les deux derniers nombres doivent être très petits).

## Lancer la galerie

1. Installer Node.js (version LTS) depuis https://nodejs.org
2. Dans le dossier du projet : `npm install`, puis `npm run dev`
3. Ouvrir l'adresse affichée (généralement `http://localhost:5173`)

Forcer un niveau de qualité : `http://localhost:5173/?q=low` (ou `medium`, `high`).

## Commandes

- ZQSD ou WASD : se déplacer · Souris : regarder · Espace : léviter
- E : interagir (porte, œuvres, portail, fenêtre « champ de phase »)
- Mobile : joystick à gauche, glisser à droite pour regarder, toucher le pop-up pour interagir

Les œuvres et matières sont encore provisoires. Aucun paiement ni présence multi-utilisateur n'est actif.

## Éditeur de niveau (F2) et atelier des îles

- **F2** (ou Échap → onglet ÉDITEUR) ouvre l'éditeur dans la galerie et dans le niveau **ÎLES** (atelier des îles flottantes).
- Caméra : clic droit maintenu pour regarder, ZQSD/WASD pour voler, E/A monter/descendre, Maj rapide, molette avancer, clic milieu glisser, Alt+glisser orbiter, F cadrer.
- Objets : clic pour sélectionner, 1 sélection · 2 déplacer · 3 tourner · 4 échelle, X grille, Suppr effacer, ⌘D dupliquer, ⌘Z / ⌘⇧Z annuler / rétablir.
- « ＋ Ajouter » : îles, modèles d'îles, buissons, arbres, rochers, lumières, cascades, brume, lianes pendantes, lianes entre deux îles (Maj+clic pour en poser plusieurs).
- Chaque île a ~50 paramètres (forme, relief des parois, roche, végétation, eau / brume / flottement) ; « Enregistrer comme modèle » crée un modèle réutilisable partout.
- Les modifications sont gardées en brouillon dans le navigateur ; **Enregistrer** (⌘S) les écrit dans le projet : `src/data/world-hall.json`, `src/data/world-isles.json`, `src/data/isle-presets.json` (serveur de dev seulement, plugin dans `vite.config.js`).
- Code : `src/editor.js` (éditeur générique), `src/worlds.js` (lien éditeur ↔ niveau, modèles), `src/skyIsles.js` (îles pilotées par les données), `src/props.js` (objets posés).
