import { createRng } from './math.js';
import { Soil } from './soil.js';
import { Plant } from './plant.js';

const FLUX = 15; // photons per unit width per hour at full sun
const MAX_SUN_ANGLE = 1.05; // radians from vertical at sunrise and sunset

// Ties the world together. One step is one hour.
export class Simulation {
  constructor(params, genome) {
    this.params = params;
    this.genome = genome;
    this.reset();
  }

  reset() {
    const env = this.params.environment;
    this.rng = createRng(this.params.simulation.seed);
    this.soil = new Soil(this.rng);
    this.soil.fill(env.moisture, env.minerals);
    this.plant = new Plant(this.genome, this.rng, this.soil);
    this.hour = 0;
    this.waterDebt = 0;
    this.mineralDebt = 0;
    this.lean = 0;
    this.sun = { x: 0, y: 1, light: 0 };
    this.env = { temperature: env.temperature, wind: env.wind, lightX: 0, lightY: 1 };
  }

  get day() {
    return this.hour / 24;
  }

  step() {
    const p = this.params.environment;
    const { sun, env, plant, soil } = this;

    // The sun crosses the sky from left to right during the lit hours.
    const phase = ((this.hour % 24) - (12 - p.dayLength / 2)) / p.dayLength;
    if (phase > 0 && phase < 1) {
      const angle = (phase - 0.5) * 2 * MAX_SUN_ANGLE;
      sun.x = Math.sin(angle);
      sun.y = Math.cos(angle);
      sun.light = p.sunlight * Math.pow(Math.sin(Math.PI * phase), 0.6);
    } else {
      sun.light = 0;
    }

    this.waterDebt += p.watering / 24;
    const drops = Math.floor(this.waterDebt);
    if (drops > 0) {
      soil.addWater(drops);
      this.waterDebt -= drops;
    }
    // Minerals are slowly released as soil organic matter breaks down.
    this.mineralDebt += 0.5;
    if (this.mineralDebt >= 1) {
      soil.addMinerals(1);
      this.mineralDebt -= 1;
    }

    plant.rebuildHash();
    if (sun.light > 0.02) plant.trace(sun.x, sun.y, FLUX * sun.light);
    else plant.photonCount = 0;

    // Shoots sense where the light has mostly been coming from.
    this.lean += (sun.x * sun.light - this.lean) * 0.05;
    const l = Math.hypot(this.lean, 1);
    env.lightX = this.lean / l;
    env.lightY = 1 / l;
    env.temperature = p.temperature;
    env.wind = p.wind;

    plant.step(1, env);
    const [water, minerals] = soil.step(1, 0.3 + 0.7 * sun.light, plant.waterRoom, plant.mineralRoom);
    plant.uptakeWater += water;
    plant.uptakeMinerals += minerals;

    if (this.rng() < p.pathogens * 0.04) plant.infect();
    this.hour++;
  }
}
