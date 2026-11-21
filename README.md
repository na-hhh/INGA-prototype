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
- **Autres niveaux** : atelier, mannequin (`src/dummy.js`), décalques de peinture (`src/paintDecals.js`), outil de construction (`src/builder.js`).
- La marche d'`inga-lele-dev` (règle de hauteur de pas, ponts, porte) s'applique aussi aux nouveaux niveaux.
- `node fftcheck.mjs` vérifie la FFT de la simulation (les deux derniers nombres doivent être très petits).

## Lancer la galerie

1. Installer Node.js (version LTS) depuis https://nodejs.org
2. Dans le dossier du projet : `npm install`, puis `npm run dev`
3. Ouvrir l'adresse affichée (généralement `http://localhost:5173`)

Forcer un niveau de qualité : `http://localhost:5173/?q=low` (ou `medium`, `high`).

## Plantes (`/plants/`)

Des plantes procédurales qui poussent dans le navigateur, sans aucune photo : L-systèmes (`/plants/`), une liane vivante qui grimpe sur une falaise scannée ou un mur de béton (`/plants/vines.html`), une feuille qui sèche et s'enroule (`/plants/leaf.html`) et l'ancienne simulation cellule par cellule (`/plants/cells.html`). La liane partage la fumée 3D et le mannequin de la galerie. Détails dans [plants/README.md](plants/README.md).

**Dans l'atelier** (la création est en pause dans la galerie) : l'outil 1 · PLANTE plante la liane là où l'on vise ; pendant 20 secondes sa pousse suit le regard, puis elle pousse seule vers la lumière (6 lianes au plus). Les îles flottantes portent aussi les blocs scannés de la liane (réglages « Roches scannées » de chaque île dans l'éditeur, F2 ; `src/scanRocks.js`).

Les roches scannées de la liane (Poly Haven, CC0, ~260 Mo) ne sont pas dans le dépôt : sans elles la page les charge directement depuis Poly Haven. Pour les avoir en local : `npm run fetch-scans`.

## Mise en ligne

Chaque push sur `main` déclenche `.github/workflows/deploy.yml`, qui construit `main` sur le serveur et le met en ligne.

## Béton (domaine BÉTON)

Le domaine **BÉTON** (Tab puis 4) est une pièce d'essai qui utilise exactement les matériaux de la galerie : tout changement s'y voit aussitôt dans la galerie. **On y arrive en avatar.**

- **X : construire** avec l'avatar (il fait le geste à chaque pièce). 1–9 ou molette choisissent la pièce — MURS : grande plaque 2,4 × 4,8 m, mur bas, voile étroit ; VOLUMES : bloc, banc, pilier ; DALLES : dalle, plafond, marche. Clic : poser (un fantôme vert montre l'emplacement, rouge si impossible) ; clic droit : retirer la pièce visée ; R : tourner. On peut empiler et monter sur ce qu'on construit. X à nouveau : terminer. Code : `src/craft.js`.
- **P : réglages** du sol et des murs (panneau affiché seulement sur demande ; il libère la souris, P le referme).
- **T** : caméra libre autour de la pièce, ou retour à l'avatar.

- **Sol** : une seule coulée lisse, sans joint ; texture, teinte, luminosité, marbrures, pores, rugosité, relief, ciré, reflets.
- **Murs** : grandes plaques de coffrage dessinées dans le shader (`src/beton.js`) — colonnes alternées (2,4 m / 0,7 m), rangée basse de 2,6 m puis haute de 4,8 m, joints fins avec coulures, 4 trous de banche dans les grandes plaques et 2 dans les étroites, pores en grappes. Tout est réglable.
- Textures : 7 bétons CC0 (ambientCG, Poly Haven) en 1024 px dans `public/assets/beton/` (crédits dans `LICENCE.txt`).
- Brouillon gardé dans le navigateur ; **Enregistrer** (panneau P) écrit `src/data/beton.json` avec les réglages et les pièces construites (serveur de dev).
- **Qualité** en haut du panneau, qui agit aussi sur la galerie : **LÉGER** (textures 1K, sans pores, coulures ni relief des trous, sol sans vernis ni reflets : pour les portables), **MOYEN** (tous les effets, 1K), **COMPLET** (textures 2K, filtrage maximal). Par défaut, elle suit `?q=low|medium|high`.

## Marcher dans les domaines (T)

Dans les ÎLES FLOTTANTES, la FUMÉE et le BÉTON, **T** fait descendre l'avatar (troisième personne) : ZQSD marcher, **Maj** courir, **Espace** sauter. On monte seul les petites marches, et en sautant ce qui fait jusqu'à environ 1 m (escalier, banc et bloc dans la pièce du BÉTON). La marche est fluide (accélération et freinage doux, élan conservé en saut), aussi dans la galerie. Sur les îles, l'avatar se pose là où l'on regarde (sur le dessus de l'île visée) et revient à son point de départ s'il tombe. **T** à nouveau rend la caméra du domaine ; dans l'éditeur des îles, T ou le bouton « Marcher » font descendre directement.


## Commandes

**La galerie expose les travaux finis ; on les prépare dans les domaines.** Domaines : GALERIE · ÎLES FLOTTANTES · FUMÉE · BÉTON · ATELIER · PLANTES (pages `/plants/`).

- **Galerie : visite.** On y marche, regarde, ouvre la porte et découvre les œuvres (E) ; **F2** ouvre l'éditeur pour placer les îles finies. Le mode créatif (outils 1–9, plantes, fumée, construction) est **en pause** dans la galerie : `CREATIVE_PAUSED` dans `src/main.js` le rouvre (touche X).
- **Tab** : sélecteur de domaines en haut de l'écran, avec un aperçu de ce qu'on peut faire dans le domaine visé ; **1–6** (ou ← → et Entrée) pour y aller, Tab pour refermer. Fonctionne aussi dans l'éditeur (bouton ⌂ Stations).
- **Échap** (ou MENU) : **DOMAINES** (aller ailleurs, et ce qu'on peut faire ici), **GUIDE** (tout ce qu'on peut changer dans chaque domaine), **TOUCHES**, **RÉGLAGES**, **INFOS**.
- **H** : aide des touches du domaine (repliée en une ligne par défaut).
- À la première arrivée dans un domaine, une carte présente ce qu'on peut y faire.
- Entrée directe sans page d'accueil : `/?station` (dernier domaine) ou `/?station=smoke` (`hall`, `isles`, `smoke`, `beton`, `atelier`).

**Outils en main** (atelier ; 1–9 ou molette, clic pour utiliser) :
CRÉER · 1 plante, 2 peinture — FUMÉE · 3 boule d'air, 4 gomme, 5 tornade — JOUER · 6 balle, 7 pistolet, 8 mousquet, 9 hadoken.

| Où | Touches |
|---|---|
| Partout | Tab domaines · Échap menu et guide · H aide |
| Galerie | ZQSD/WASD se déplacer · Souris regarder · Espace sauter · Maj courir · E interagir · T troisième personne · F2 placer les îles finies |
| Atelier | 1–9 outils · G vol libre (Espace/C monter/descendre) · B construction · F pinceau de brouillard · V sources de fumée |
| Îles flottantes | F2 éditeur (ouvert à l'arrivée) · clic droit + ZQSD voler · E/A monter/descendre · 1–4 choisir/déplacer/tourner/échelle · ⌘S enregistrer · « ➜ Envoyer vers la galerie » dans l'inspecteur |
| Fumée | Glisser tourner · Clic droit décaler · Molette zoom · Espace lâcher une bouffée · R vider le bac |

Les lettres suivent la position des touches : ZQSD en AZERTY = WASD en QWERTY.

- **Téléphone (à une main)** : poser le pouce n'importe où dans le bas de l'écran fait apparaître le joystick (dalle de béton) sous le pouce. Avant / arrière : marcher ; gauche / droite : la vue tourne dans cette direction, et le regard revient seul à l'horizontale en marchant. Le pouce se pose n'importe où sur l'écran ; la caméra est entièrement automatique (regard à l'horizontale). Écran épuré : INGA, MENU et le joystick ; toucher le pop-up pour interagir.

Les œuvres et matières sont encore provisoires. Aucun paiement ni présence multi-utilisateur n'est actif.

## Éditeur de niveau (F2) et atelier des îles

- **F2** (ou Échap → onglet ÉDITEUR) ouvre l'éditeur dans la galerie et dans le niveau **ÎLES** (atelier des îles flottantes).
- **⌂ Stations** (en haut à gauche, ou **Tab** puis 1–6) : quitter l'éditeur vers la galerie ou une autre station. **▤** replie la liste de la scène ; l'inspecteur n'apparaît qu'avec un objet sélectionné. En fenêtre étroite, la barre n'affiche plus que les icônes et les touches.
- Caméra : glisser dans le vide (clic gauche ou droit), deux doigts ← → au trackpad ou flèches pour tourner la vue, ZQSD/WASD pour voler, E/A monter/descendre, Maj rapide, molette avancer, clic milieu glisser, Alt+glisser orbiter, F cadrer.
- Objets : clic pour sélectionner, 1 sélection · 2 déplacer · 3 tourner · 4 échelle, X grille, Suppr effacer, ⌘D dupliquer, ⌘Z / ⌘⇧Z annuler / rétablir.
- « ＋ Ajouter » : îles, modèles d'îles, buissons, arbres, rochers, lumières, cascades, brume, lianes pendantes, lianes entre deux îles (Maj+clic pour en poser plusieurs).
- Chaque île a ~50 paramètres (forme, relief des parois, roche, végétation, eau / brume / flottement) ; « Enregistrer comme modèle » crée un modèle réutilisable partout.
- Les modifications sont gardées en brouillon dans le navigateur ; **Enregistrer** (⌘S) les écrit dans le projet : `src/data/world-hall.json`, `src/data/world-isles.json`, `src/data/isle-presets.json` (serveur de dev seulement, plugin dans `vite.config.js`).
- Code : `src/editor.js` (éditeur générique), `src/worlds.js` (lien éditeur ↔ niveau, modèles), `src/skyIsles.js` (îles pilotées par les données), `src/props.js` (objets posés).
