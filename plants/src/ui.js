import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { GENE_RANGES } from './sim/genome.js';
import { COLOR_MODES } from './view.js';

const FATES = ['xylem', 'phloem', 'parenchyma', 'epidermis', 'mesophyll', 'roothair'];
const pretty = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

// Turns the genome object into nested folders of sliders, one per gene.
function addGenes(folder, genes) {
  for (const [key, value] of Object.entries(genes)) {
    if (typeof value === 'number') {
      const [min, max, step] = GENE_RANGES[key] ?? [0, Math.max(1, value * 4), 0.01];
      folder.add(genes, key, min, max, step).name(pretty(key));
    } else if (key === 'fates') {
      value.forEach((_, i) => folder.add(value, i, FATES).name(i === 0 ? 'Fate: centre' : `Fate: layer ${i}`));
    } else if (value && typeof value === 'object') {
      addGenes(folder.addFolder(pretty(key)).close(), value);
    }
  }
}

export function createUI(params, genome, { container, actions }) {
  const gui = new GUI({ container, title: 'Controls' });

  const sim = gui.addFolder('Simulation');
  sim.add(params.simulation, 'running').name('Running');
  sim.add(params.simulation, 'speed', 0.1, 20, 0.1).name('Speed');
  sim.add(params.simulation, 'seed', 1, 9999, 1).name('Seed');
  sim.add(actions, 'replant').name('Replant');

  const env = gui.addFolder('Environment');
  env.add(params.environment, 'dayLength', 0, 24, 0.5).name('Day length (h)');
  env.add(params.environment, 'sunlight', 0, 2, 0.05).name('Sunlight');
  env.add(params.environment, 'temperature', 0, 40, 0.5).name('Temperature (°C)');
  env.add(params.environment, 'watering', 0, 1200, 10).name('Watering / day');
  env.add(params.environment, 'wind', 0, 2, 0.05).name('Wind');
  env.add(params.environment, 'pathogens', 0, 5, 0.1).name('Pathogens');
  env.add(actions, 'water').name('Water now');
  env.add(actions, 'fertilise').name('Add minerals');
  env.add(params.environment, 'moisture', 0, 1, 0.05).name('Starting moisture');
  env.add(params.environment, 'minerals', 0, 7000, 100).name('Starting minerals');

  const dna = gui.addFolder('DNA');
  addGenes(dna, genome);
  dna.add(actions, 'resetGenome').name('Reset DNA');

  const view = gui.addFolder('View');
  view.add(params.view, 'colorBy', Object.keys(COLOR_MODES)).name('Colour by');
  view.add(params.view, 'smooth').name('Smooth tissue');
  view.add(params.view, 'soilOpacity', 0, 1, 0.05).name('Soil opacity');
  view.add(params.view, 'daylight').name('Sun & day/night sky');
  view.add(params.view, 'cellWalls').name('Cell walls');
  view.add(params.view, 'water').name('Water');
  view.add(params.view, 'minerals').name('Minerals');
  view.add(params.view, 'photons').name('Photons');
  view.add(actions, 'frame').name('Frame plant');

  return gui;
}
