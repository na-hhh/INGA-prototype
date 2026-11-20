// Everything about the world the plant lives in, and how it is displayed.
// The plant's own instructions live in src/sim/genome.js.
export const params = {
  simulation: {
    running: true,
    speed: 1, // 1 = one simulated day every two seconds
    seed: 1,
  },
  environment: {
    dayLength: 14, // hours of light per day
    sunlight: 1,
    temperature: 26, // °C
    watering: 280, // water particles added to the soil surface per day
    wind: 0.3,
    pathogens: 0.3, // how often fungal spores land on the plant
    moisture: 0.6, // starting soil moisture (applies on replant)
    minerals: 2600, // starting mineral particles (applies on replant)
  },
  view: {
    colorBy: 'Natural',
    soilOpacity: 0.7,
    smooth: true, // join neighbouring cells into continuous tissue
    daylight: true, // show the sun and the sky brightening and darkening
    water: true,
    minerals: true,
    photons: true,
    cellWalls: true,
  },
};
