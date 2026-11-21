# Suite du travail — note pour la prochaine session

Dernière session : 22 novembre 2026. Prochaine étape : la 3 (textures en relief). Aussi fait depuis : néons au sol en rubans de lumière, poussière dans les rayons, archipel aléatoire, oiseaux, brouillard des îles, boule du temps, balcon (voir README). Branche de travail : `inga-lele-dev`
(poussée aussi sur `main`). Le site public (inga-proto.art) est servi par le
NAS d'une amie : il ne se met à jour que lorsqu'elle le reconstruit depuis
`main` (l'action GitHub « Deploy » échoue faute de secrets Tailscale).

## Le plan « lumière » en cours

Proposé après une recherche (ombres, textures en relief, ciel, AO) et validé :

1. **Ciel et lumière unifiés** — FAIT : temps du monde (`src/worldTime.js`),
   ciel, lune, géante gazeuse (`src/sky.js`), ambiance recalculée depuis le
   ciel, exposition, néons, tableau de bord Échap → MONDE.
2. **Meilleures ombres** — FAIT (session du 21-22 novembre) :
   - ombres du soleil à pénombre variable **PCSS** en MOYEN/ÉLEVÉ (bloc
     « Ombres du soleil à pénombre variable » en haut de `src/main.js`,
     injecté dans `THREE.ShaderChunk.shadowmap_pars_fragment` ; réglages :
     `PCSS_SOFT`, `PCSS_SEARCH`, nombre d'échantillons) ; LÉGER garde le PCF ;
   - **micro-ombres** des trous de banche (croissant d'ombre selon le soleil)
     dans `src/beton.js` (BT_Q > 0) ;
   - reste possible : cadrer plus serré la caméra d'ombre (`setSunRig`).
3. **Textures vraiment en 3D** (COMPLET seulement) : parallax occlusion
   mapping avec auto-ombrage à partir des cartes de hauteur des bétons
   (ambientCG fournit `Displacement`) ; limites : silhouette plate, ombres
   portées et AO ne suivent pas le relief.
4. **Occlusion ambiante N8AO** à la place de GTAO (mode demi-résolution,
   plus léger sur le Mac Intel) — à mesurer sur les deux machines.
5. Plus tard : **lightmaps précalculées dans Blender** quand l'architecture
   sera figée.

## À vérifier sur une vraie carte graphique

Les tests de cette session ont été faits en rendu logiciel (Brave headless) :
- l'effet réel des néons la nuit et leur amorçage ;
- la luminosité de nuit (curseurs « Adaptation de l'œil », « Intensité des
  néons » dans MONDE) et du sol (« Reflets » dans BÉTON, touche P) ;
- la fluidité réelle sur le MacBook Pro Intel (qualité LÉGER) et sur le PC
  puissant (COMPLET) — le compteur d'images par seconde est en haut à droite.

## Repères

- Domaines (Tab) : GALERIE, ÎLES FLOTTANTES, FUMÉE, BÉTON, ATELIER, PLANTES.
- Galerie : création en pause (`CREATIVE_PAUSED` dans `src/main.js`).
- BÉTON : arrivée en avatar, X construire (`src/craft.js`), P réglages
  (`src/beton.js`), qualité LÉGER / MOYEN / COMPLET.
- T dans les domaines : marcher avec l'avatar.
- Téléphone : écran épuré, joystick sous le pouce, caméra automatique.
