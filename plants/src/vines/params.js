export const defaults = () => ({
  // Growth
  speed: 12, // growth steps per second (lead shoot)
  sideSpeed: 0.3, // side shoots grow this much slower
  stepLength: 0.22,
  follow: 0.9, // how hard the lead shoot heads for the cursor
  climb: 0.16, // how hard side shoots head for the light
  wander: 0.24,
  cling: 0.55, // pull towards a nearby surface
  reach: 1.2, // how far away a surface can be felt
  grip: 0.3, // how close a node must be to take hold
  branching: 0.09, // chance per step of a side shoot
  branchAngle: 55,
  branchLife: 55, // steps a side shoot lives, on average
  maxTips: 26,
  activeRadius: 6, // side shoots only start this close to the lead shoot
  maxHang: 4,
  twining: 'Mixed', // which way round the vine winds
  twine: 0.7, // how hard it turns around things it can get round
  nutation: 0.28, // how widely a shoot in mid-air circles
  nutationRate: 1.1,
  tendrilDensity: 0.13,
  tendrilLength: 1.3, // a shoot gives up after this much growth in mid-air
  // Stem
  stemWidth: 0.11,
  stiffness: 0.5,
  damping: 0.95, // how quickly swinging dies down (1 = never)
  stick: 2.5, // chance per second that a strand resting on the surface takes hold
  // Leaves
  leafDensity: 0.3,
  leafOverlap: 1, // how many neighbours a new leaf may overlap
  leafPush: 1, // how hard leaves push each other apart
  leafShare: 1, // how much neighbouring leaves share their sway
  clipPatience: 25, // seconds of cutting through a neighbour before a leaf is given up (0 = never)
  translucency: 1,
  leafGrowTime: 42, // seconds for a well-lit leaf to reach full size
  lightNeed: 0.15, // a leaf getting less sun than this is on borrowed time (0 = shade never kills)
  shadePatience: 12, // seconds a leaf survives short of light
  leafSize: 1.15,
  leafLife: 110, // seconds before a leaf turns and dies (0 = never)
  evergreen: 0.45, // share of leaves that never die of age
  detachWind: 1.25, // a gust this strong pulls dead leaves off
  leafDrop: 0.12, // stems thicker than this have shed their leaves
  lobes: 5,
  lobeDepth: 0.45,
  teeth: 0.075, // how jagged the leaf edge is
  // World
  gravity: 1,
  wind: 1.2,
  windDirection: 60,
});
