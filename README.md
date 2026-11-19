# INGA — Léandre · galerie d'art interactive (v4 légère)

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
- Hall agrandi (24 m), îlots de mousse bas et doux sur lesquels on peut marcher.
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
