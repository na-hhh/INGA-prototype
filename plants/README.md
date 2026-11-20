# Plants

Procedural plants for games, grown in the browser with [three.js](https://threejs.org/). The plants themselves use no photographs or scans: shape, colour and shading all come from rules. (The rock and concrete the vine climbs are scanned.)

## Run

```sh
npm install
npm run dev
```

Open the URL Vite prints, then `/plants/`. Drag to orbit, scroll to zoom.

## How it works

A plant is a small grammar. Constants at the top become sliders; rules rewrite a string of symbols step by step; a 3D turtle walks the result and builds tubes for stems and blades for leaves and petals.

```
fronds = 10 [1, 30]
axiom: C(0)
C(i) : i < 2*fronds*vigor && i % 2 == 0 -> [ /(i*68.75) &(tilt) R(0) ] C(i+1)
```

Edit the grammar in the sidebar and press Apply (Ctrl+Enter). The syntax and the turtle commands are documented at the top of `src/lsys/lsystem.js` and `src/lsys/turtle.js`.

The environment shapes the result in two ways:

- **Rules can read it.** `light`, `water`, `nutrients` and `vigor` (the scarcest of the three) are available in every condition and expression, so a starved fern makes fewer fronds and a shaded one stretches.
- **Physics bends it.** Gravity makes thin stems droop (more so when short of water), stems lean towards the sun and downwind, and a stem that reaches the ground runs along it.

"Play growth" animates the plant from seed; "Copies" grows several from different seeds; "Export .glb" saves the mesh with vertex colours.

### Layout

- `src/lsys/presets.js` — the starting plants (fern, tree, flowering herb)
- `src/lsys/lsystem.js` — grammar parser and rewriting
- `src/lsys/turtle.js` — turns a generation into geometry, applying the physical forces
- `src/lsys/main.js` — scene, lighting, controls, export

## Vines (`/plants/vines.html`)

A vine that grows live over a cliff, a concrete wall, a pillar, an arch, a trellis or a boulder. Its lead shoot chases the cursor; a click plants another vine.

The cliff and the concrete wall use photoscanned rock, concrete and metal from [Poly Haven](https://polyhaven.com) (CC0). They are large (about 260 MB) and are not in the repository; fetch them once with:

```sh
npm run fetch-scans
```

Without them the page loads the same files from Poly Haven directly (`src/vines/scans.js`), which is what the public site does.

- **Supports**: the cliff is built from scanned cliff faces and boulders, about 2.5 million triangles, with a fine layer of rock grain over the scans so they stay crisp close up (`src/vines/cliff.js`). The concrete wall has ledges, piers, a balcony with a railing, pipes, bars sticking out and lamps (`src/vines/supports.js`). Whatever the support, the vine feels it through one function: the distance to the nearest surface. For the cliff that is worked out on a grid from the scans' own points.
- **Growth**: each tip steps towards its goal while clinging to the nearest surface and sliding along it. Side shoots fork off and head for the light.
- **Physics**: any part not holding on to the surface is a rope with weight, stiffness and wind, and takes hold again where it comes to rest.
- **Twining**: where a surface curves, shoots turn across it, always the same way round, so they wind around poles, bars and railings. A shoot in mid-air circles as it grows, feeling for support.
- **Tendrils**: thin feelers that sweep in circles; one that touches something takes hold, coils into a spring and draws its stem in, and one that finds nothing curls up on itself.
- **Leaves**: five variants of a lobed, toothed leaf, each with its own outline and vein pattern. The colour, normal and growth maps are generated from the same description as the mesh (`src/vines/leaf.js`). A leaf starts as a coiled bud, unrolls, and grows as far as its light allows.
- **Leaves and each other**: leaves that are about to cut through each other push apart, and neighbours share their sway so a patch moves together. A leaf that still spends its time cutting through a neighbour is, after a while, given up by the vine, so the canopy that survives is one that fits together.
- **Dying**: a leaf that is old, starved of light or in the way turns yellow, then dries and curls on the vine, passing through shapes worked out by actually drying that leaf (see the drying leaf below). A strong gust snaps it off.
- **Ageing**: stems thicken and turn woody, their surface fading from ribbed green shoot to cracked bark (`src/vines/bark.js`).
- **Weather** (`src/vines/weather.js`): clear, overcast, rain or storm, each with its own sky, haze, light and wind. Rain slants with the wind, taps the leaves, and leaves everything dark and glossy until it dries.
- **Air** (`src/vines/air.js`): the wind is worked out on a coarse grid as moving air that cannot pass through the support and is held back by foliage, so it slows against a wall, slides along it, speeds up round corners and leaves sheltered leaves alone (Stam, *Stable Fluids*, 1999).

- **Walking about** (`src/vines/player.js`, `src/vines/abilities.js`): press P to walk the scene as a third-person character, with the mannequin, movement and camera of the INGA prototype. The lead shoot grows towards wherever the character looks. Click to use an ability: a smoke ball (a ball of air that blows leaves about, tears off dead ones and bursts against surfaces), a bouncing ball, or planting a vine. The smoke is the gallery's own (`/src/smoke3d.js`, shared with it, drawn with its `overlay` option): it runs in a transparent WebGL layer over the vine's picture (`src/vines/smoke.js`), with the support voxelised so smoke cannot pass through it, and its settings are in the Smoke folder. Leaves and stems do not hide it; the support and the character do. The mannequin is Quaternius's "Universal Animation Library" (CC0), shared with the gallery (`public/assets/dummy/`).

Growth and physics are in `src/vines/vine.js`, drawing in `src/vines/view.js`, and every tunable value in `src/vines/params.js`. The simulation runs on the CPU and takes well under a millisecond a frame; what costs is drawing.

## Drying leaf (`/plants/leaf.html`)

One leaf, drying out and curling up, to study how a dead leaf should look and to make dried-leaf meshes for the vine and for export.

The blade is treated as a fabric of soft tissue stretched over a frame of veins. Tissue shrinks a lot as it loses water; veins hardly shrink along their length; the thin margin dries before the middle; and the upper face shrinks more than the lower. A flat sheet cannot do all of that at once, so it cups, crinkles between its veins and rolls up. Nothing about the final shape is drawn by hand. Wetting the leaf swells it again, though not all the way.

- **Model**: two layers of points (the two faces of the blade) braced to each other, after Jeong, Park and Kim, *Simulation of morphology changes in drying leaves* (Computer Graphics Forum, 2013). Every link has a length it wants to be, which follows the water in the tissue there; the points are moved to fit (position-based dynamics, Müller et al. 2007). The blade cannot pass through itself.
- **Water**: leaves through the surface, fastest at the margin, and moves through the blade, fastest along the veins. "Water from stalk" keeps the base supplied, as on a living plant.
- **Controls**: air humidity, drying speed, how much tissue and veins shrink, which way and how hard the blade curls, how much wetting undoes. The leaf can hang from its stalk or lie on a table.
- **Export**: the current shape, or one mesh with four morph targets from fresh to crisp (`.glb`).

`src/leaf/dry.js` is the simulation and has no drawing code; `dryingStages()` in it dries a leaf and returns its shape at even stages, which is how the vine gets its dead leaves.

## The cell simulation (`/plants/cells.html`)

An earlier, much more detailed approach, kept for reference: a 2D fern grown cell by cell. It is too slow to be the way plants get made, but it runs.

```sh
node plants/scripts/headless.mjs 60            # 60 days, numbers only
```


- **Cells** divide, expand and specialise into epidermis, xylem, phloem, mesophyll, root hairs and storage tissue. Each organ is built by a single apical cell at its tip.
- **Hormones**: auxin (made in shoot tips, pumped towards the roots), cytokinin (made in root tips, carried up), abscisic acid (drought) and salicylic acid (immune alarm).
- **Transport**: water and minerals move up the xylem, sugar is shared along the vascular strand and pulled towards growing cells.
- **Light**: photons are fired along the sun's direction; cells that catch them make sugar, and shade the cells behind them.
- **Soil**: water and mineral particles that drain, spread, evaporate and leach. Roots grow towards moisture and absorb what they touch.
- **Branching**: a surface cell can found a new organ (frond, pinna, leaflet, root) if no rival founded by the same rule is within its spacing distance.
- **Physics**: cell walls hold tissue in shape; limp, thirsty cells make a frond sag.
- **Immunity**: spores land on the plant; infected cells that detect it kill themselves and warn their neighbours.

### Layout

- `src/sim/genome.js` — the instruction set, and the place to start. `DETAIL` at the top sets how finely the plant is divided into cells
- `src/sim/plant.js` — cells: metabolism, transport, growth, physics, immunity, light
- `src/sim/soil.js` — water and mineral particles
- `src/sim/simulation.js` — day and night, watering, one step per hour
- `src/view.js`, `src/main.js`, `src/ui.js` — drawing and controls
- `src/params.js` — environment and display settings

Rendering uses three.js's `WebGPURenderer`, which runs on WebGPU where available and falls back to WebGL 2. The simulation itself runs on the CPU.
