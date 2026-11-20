// The plant's instruction set.
//
// Nothing here describes the finished plant. Every entry is a rule that a
// single cell follows using only what it can sense locally: its own stores,
// its hormone levels, its position in its tissue, light, gravity, moisture.
// The shape of the fern is whatever those rules add up to.
//
// Defaults are loosely modelled on Ceratopteris richardii (the "C-fern", the
// standard lab model fern): a short upright rhizome, pinnate fronds, and
// branching roots. Values are plausible, not measured.

// How finely the plant is divided into cells. 1 is the reference; 2 halves
// every cell's size, so the same plant is built from about twice as many
// cells (and costs about twice as much to simulate). Everything that depends
// on cell size is rescaled from this one number.
export const DETAIL = 2;

export function createGenome() {
  const genome = baseGenome();
  const s = 1 / DETAIL;
  for (const organ of Object.values(genome.organs)) {
    organ.cellSize *= s;
    organ.cycle *= s; // smaller cells, divided more often: same growth speed
    // More, thinner layers, so the organ keeps its thickness. The fate of
    // each new layer is taken from the layer it subdivides.
    const layers = Math.floor(((2 * organ.layers + 1) * DETAIL - 1) / 2);
    const fates = [organ.fates[0]];
    for (let d = 1; d <= layers; d++) {
      fates.push(organ.fates[Math.min(organ.fates.length - 1, Math.ceil((d * organ.layers) / layers))]);
    }
    organ.layers = layers;
    organ.fates = fates;
  }
  const m = genome.metabolism;
  // Cells per area go up with the square of DETAIL, so per-cell budgets go
  // down by the same factor and the plant as a whole costs the same.
  m.photosynthesis *= s * s;
  m.respiration *= s * s;
  m.divisionCost *= s * s;
  m.expansionCost *= s * s;
  genome.hormones.auxinProduction /= s;
  genome.hormones.cytokininProduction /= s;
  genome.hormones.auxinDecay *= s;
  return genome;
}

// Values at DETAIL = 1.
function baseGenome() {
  return {
    // One entry per kind of organ. An organ is built by a single apical cell
    // (as in real ferns) that divides and leaves a trail of daughter cells.
    organs: {
      rhizome: {
        kind: 'shoot',
        cellSize: 0.075, // mature cell radius
        layers: 2, // rings of cells added around the central file
        cycle: 35, // hours between divisions of the apical cell
        vitality: 0, // hours the apical cell stays active (0 = forever)
        window: 36, // hours a young cell stays able to divide
        competence: 6000, // hours a surface cell can still found a new organ
        gravitropism: 0.5, // + grows up, - grows down
        phototropism: 0.1,
        hydrotropism: 0,
        wander: 0.03, // random drift in growth direction
        lifespan: 0, // days before the organ senesces (0 = never)
        stipe: 0,
        // Cell fate by layer, from the central file outwards.
        fates: ['xylem', 'phloem', 'epidermis'],
      },
      frond: {
        kind: 'shoot',
        cellSize: 0.07,
        layers: 1,
        cycle: 1.5,
        vitality: 380,
        window: 30,
        competence: 120,
        gravitropism: 0.035,
        phototropism: 0.03,
        hydrotropism: 0,
        wander: 0.02,
        lifespan: 50,
        stipe: 0.28, // fraction of its life the frond grows a bare stalk
        fates: ['xylem', 'epidermis'],
      },
      pinna: {
        kind: 'shoot',
        cellSize: 0.07,
        layers: 1,
        cycle: 2.5,
        vitality: 190,
        window: 30,
        competence: 220,
        gravitropism: 0.015,
        phototropism: 0.02,
        hydrotropism: 0,
        wander: 0.02,
        lifespan: 0,
        stipe: 0.08,
        fates: ['xylem', 'mesophyll'],
      },
      // The leaflets on each pinna. This is the level that carries most of
      // the green tissue.
      pinnule: {
        kind: 'shoot',
        cellSize: 0.065,
        layers: 2,
        cycle: 2.5,
        vitality: 32,
        window: 30,
        competence: 60,
        gravitropism: 0.01,
        phototropism: 0.02,
        hydrotropism: 0,
        wander: 0.02,
        lifespan: 0,
        stipe: 0.2,
        fates: ['xylem', 'mesophyll', 'mesophyll'],
      },
      root: {
        kind: 'root',
        cellSize: 0.05,
        layers: 1,
        cycle: 2,
        vitality: 0,
        window: 24,
        competence: 300,
        gravitropism: -0.06,
        phototropism: 0,
        hydrotropism: 0.12,
        wander: 0.1,
        lifespan: 0,
        stipe: 0,
        fates: ['xylem', 'roothair'],
      },
      lateral: {
        kind: 'root',
        cellSize: 0.045,
        layers: 1,
        cycle: 2,
        vitality: 220,
        window: 24,
        competence: 0,
        gravitropism: -0.03,
        phototropism: 0,
        hydrotropism: 0.15,
        wander: 0.1,
        lifespan: 0,
        stipe: 0,
        fates: ['xylem', 'roothair'],
      },
    },

    // When may a surface cell of one organ found the apical cell of another?
    // spacing: no closer than this to another organ founded by the same rule
    //   (every young organ keeps a zone around itself clear of rivals)
    // auxinMin: only where auxin (arriving from the shoot) is above this
    // rate: chance per hour once the conditions hold
    // lean: 0 = straight out from the surface, 1 = along the parent organ
    // taper: how much the child's lifetime shrinks as the parent tip ages
    // scale: child lifetime multiplier; for a rule whose parent and child are
    //   the same organ it compounds, so each generation is smaller
    rules: {
      rhizomeFrond: { parent: 'rhizome', child: 'frond', where: 'any', spacing: 0.45, auxinMin: 0, rate: 0.03, lean: 0.25, taper: 0 },
      rhizomeRoot: { parent: 'rhizome', child: 'root', where: 'below', spacing: 0.4, auxinMin: 0.02, rate: 0.02, lean: -0.5, taper: 0 },
      frondPinna: { parent: 'frond', child: 'pinna', where: 'above', spacing: 1.5, auxinMin: 0, rate: 0.12, lean: 0.25, taper: 0.85 },
      pinnaPinnule: { parent: 'pinna', child: 'pinnule', where: 'above', spacing: 0.42, auxinMin: 0, rate: 0.2, lean: 0.25, taper: 0.8, scale: 1 },
      // Self-similar branching: raise `rate` and leaflets grow leaflets of
      // their own, each generation `scale` times the size of the last.
      pinnulePinnule: { parent: 'pinnule', child: 'pinnule', where: 'above', spacing: 0.3, auxinMin: 0, rate: 0, lean: 0.25, taper: 0.5, scale: 0.55 },
      rootLateral: { parent: 'root', child: 'lateral', where: 'below', spacing: 1.4, auxinMin: 0.01, rate: 0.04, lean: 0.2, taper: 0 },
    },

    hormones: {
      auxinProduction: 4, // made by shoot apical cells, flows towards the roots
      auxinDecay: 0.02,
      cytokininProduction: 4, // made by root apical cells, carried up in the xylem
      cytokininDecay: 0.04,
      abaSensitivity: 1, // how strongly drought hormone closes stomata
    },

    metabolism: {
      photosynthesis: 0.05, // max sugar per mesophyll cell per hour
      respiration: 0.00015, // sugar burned per living cell per hour
      divisionCost: 0.0375,
      expansionCost: 0.0625,
      waterUse: 1, // water lost per sugar made
      reserve: 300, // sugar the young plant starts with
    },

    immunity: {
      cuticle: 0.85, // chance the epidermis blocks a spore
      sensitivity: 0.12, // chance per hour an infected cell detects it
      priming: 0.6, // extra resistance from salicylic acid
    },
  };
}

// Slider ranges for the UI: [min, max, step].
export const GENE_RANGES = {
  cellSize: [0.02, 0.4, 0.005],
  layers: [0, 12, 1],
  cycle: [1, 120, 0.5],
  vitality: [0, 800, 10],
  window: [6, 100, 1],
  competence: [0, 8000, 50],
  gravitropism: [-0.6, 0.6, 0.005],
  phototropism: [0, 0.5, 0.005],
  hydrotropism: [0, 0.5, 0.01],
  wander: [0, 0.4, 0.01],
  lifespan: [0, 200, 1],
  stipe: [0, 0.9, 0.01],
  spacing: [0.05, 6, 0.05],
  auxinMin: [0, 0.5, 0.005],
  rate: [0, 0.5, 0.005],
  lean: [-1, 1, 0.05],
  taper: [0, 1.5, 0.05],
  scale: [0.1, 1, 0.05],
  auxinProduction: [0, 12, 0.1],
  auxinDecay: [0.005, 0.5, 0.005],
  cytokininProduction: [0, 12, 0.1],
  cytokininDecay: [0.005, 0.5, 0.005],
  abaSensitivity: [0, 3, 0.05],
  photosynthesis: [0, 0.2, 0.005],
  respiration: [0, 0.003, 0.00005],
  divisionCost: [0.01, 1, 0.005],
  expansionCost: [0.01, 1, 0.005],
  waterUse: [0, 4, 0.05],
  reserve: [5, 200, 1],
  cuticle: [0, 1, 0.01],
  sensitivity: [0, 1, 0.01],
  priming: [0, 2, 0.05],
};
