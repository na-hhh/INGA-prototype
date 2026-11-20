// Starting plants. Each is an L-system: constants (which become sliders),
// an axiom and rewriting rules. Rules can read the environment through
// `light`, `water`, `nutrients` and `vigor` (the scarcest of the three).

const fern = `# Fern: a rosette of fronds, each frond a small L-system of its own
# (crown -> rachis -> pinna -> leaflet).
fronds = 10 [1, 30]
rachis = 26 [4, 60]
stipe = 5 [0, 20]
tilt = 16 [0, 90]
arch = 1.9 [0, 10]
pinnaAngle = 64 [10, 90]
pinnaLength = 12 [2, 30]
seg = 0.9 [0.2, 3]
leafLength = 1.7 [0.2, 5]
leafWidth = 0.55 [0.1, 2]
leafAngle = 52 [10, 90]
width = 0.3 [0.05, 1]
droop = 0.006 [0, 0.1]
phototropism = 0.01 [0, 0.2]
mature = 7 [1, 20]
unfurl = 34 [0, 90]

axiom: C(0)

# Crown: a new frond every other step, each turned by the golden angle.
# A plant short of light, water or nutrients makes fewer fronds.
C(i) : i < 2*fronds*vigor && i % 2 == 0 -> [ /(i*68.75 + rnd(-12,12)) &(tilt + rnd(-7,7)) !(width) R(0) ] C(i+1)
C(i) : i < 2*fronds*vigor && i % 2 == 1 -> C(i+1)

# Rachis: first a bare stalk, then a pinna on each side at every joint.
# In poor light the stalk stretches.
R(n) : n < stipe -> F(seg*(1.6 - 0.6*min(1,light))) &(arch*0.4) R(n+1)
R(n) : n >= stipe && n < rachis -> !(width*(1 - 0.8*n/rachis)) F(seg) &(arch) [ +(pinnaAngle) P(0, 0.12 + 0.88*sin(PI*pow((n-stipe)/(rachis-stipe), 0.62))) ] [ -(pinnaAngle) P(0, 0.12 + 0.88*sin(PI*pow((n-stipe)/(rachis-stipe), 0.62))) ] R(n+1)

# Pinna: a leaflet on each side, shrinking towards the tip.
P(m, s) : m < pinnaLength*s -> !(width*0.3*s) F(seg*0.5) [ +(leafAngle) L(leafLength*s*(1 - 0.6*m/(pinnaLength*s))*(0.6+0.4*vigor), leafWidth) ] [ -(leafAngle) L(leafLength*s*(1 - 0.6*m/(pinnaLength*s))*(0.6+0.4*vigor), leafWidth) ] P(m+1, s)
P(m, s) : m >= pinnaLength*s -> L(leafLength*s*0.5, leafWidth)
`;

const tree = `# Tree: a trunk that keeps a leader and throws side branches,
# which themselves fork left and right.
trunk = 9 [2, 20]
shrink = 0.88 [0.5, 1]
sideShrink = 0.7 [0.4, 1]
branchAngle = 32 [5, 80]
forkAngle = 48 [5, 80]
spin = 137.5 [0, 180]
thin = 0.72 [0.5, 0.95]
width = 1.5 [0.2, 4]
twig = 1.1 [0.3, 3]
leafLength = 1.7 [0.3, 5]
leafWidth = 0.75 [0.1, 3]
droop = 0.004 [0, 0.05]
phototropism = 0.012 [0, 0.2]
woodWidth = 0.5 [0.05, 2]
mature = 2 [1, 10]

axiom: !(width) A(trunk*(0.5+0.5*vigor), width)

A(l, w) : l > twig -> !(w) F(l) [ &(branchAngle) B(l*sideShrink, w*thin) ] /(spin) A(l*shrink, w*thin)
B(l, w) : l > twig -> !(w) F(l) [ -(forkAngle) $ D(l*sideShrink, w*thin) ] D(l*shrink, w*thin)
D(l, w) : l > twig -> !(w) F(l) [ +(forkAngle) $ B(l*sideShrink, w*thin) ] B(l*shrink, w*thin)

# Twigs end in a tuft of leaves; a starved tree carries fewer.
A(l, w) : l <= twig -> !(w) F(l) T
B(l, w) : l <= twig -> !(w) F(l) T
D(l, w) : l <= twig -> !(w) F(l) T
T : vigor > 0.35 -> [ &(50) L(leafLength, leafWidth) ] /(120) [ &(50) L(leafLength, leafWidth) ] /(120) [ &(50) L(leafLength, leafWidth) ] [ &(8) L(leafLength, leafWidth) ]
T : vigor <= 0.35 -> [ &(50) L(leafLength*0.7, leafWidth*0.7) ]
`;

const flower = `# Flowering herb: a leafy stem with side shoots, each ending in a flower.
nodes = 9 [2, 24]
internode = 1.3 [0.3, 4]
leafLength = 3.2 [0.5, 8]
leafWidth = 1.2 [0.2, 4]
leafTilt = 55 [10, 90]
spin = 137.5 [0, 180]
sideAngle = 42 [5, 80]
sideNodes = 3 [0, 8]
bloom = 1.3 [0.2, 4]
petals = 6 [3, 12]
width = 0.22 [0.05, 1]
droop = 0.012 [0, 0.1]
phototropism = 0.04 [0, 0.3]
leafCurl = 0.45 [0, 1.5]
mature = 3 [1, 10]

axiom: !(width) S(0)

# Main stem: a leaf at every node; side shoots from the upper half.
S(n) : n < nodes*vigor && n < nodes/2 -> F(internode*(1.5 - 0.5*min(1,light))) /(spin) [ &(leafTilt) L(leafLength*(1 - 0.4*n/nodes), leafWidth) ] S(n+1)
S(n) : n < nodes*vigor && n >= nodes/2 -> F(internode) /(spin) [ &(leafTilt) L(leafLength*(1 - 0.4*n/nodes), leafWidth) ] [ &(sideAngle) !(width*0.6) Q(0) ] S(n+1)
S(n) : n >= nodes*vigor -> F(internode) K(bloom, petals)

# Side shoot.
Q(m) : m < sideNodes -> F(internode*0.8) /(spin) [ &(leafTilt) L(leafLength*0.45, leafWidth*0.5) ] Q(m+1)
Q(m) : m >= sideNodes -> F(internode*0.6) K(bloom*0.8, petals)
`;

export const PRESETS = {
  Fern: {
    source: fern,
    iterations: 44,
    colors: { stem: '#6f8f3a', wood: '#5a4a2c', leaf: '#2f7a2c', leafTip: '#63a83c', flower: '#ffffff', flowerCenter: '#ffd84a' },
  },
  Tree: {
    source: tree,
    iterations: 13,
    colors: { stem: '#7d8a4a', wood: '#5b4631', leaf: '#3c7d2e', leafTip: '#7fae3f', flower: '#ffffff', flowerCenter: '#ffd84a' },
  },
  Flower: {
    source: flower,
    iterations: 16,
    colors: { stem: '#6d9a45', wood: '#5b6b35', leaf: '#3a8a38', leafTip: '#6fb04a', flower: '#e85fa0', flowerCenter: '#ffe066' },
  },
};
