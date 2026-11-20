// The photoscanned rock, concrete and metal the vine climbs, from Poly Haven
// (polyhaven.com, CC0). They are large (about 260 MB), so they are not in the
// repository. Two ways to get them:
//
// - `node plants/scripts/fetch-assets.mjs` copies them into public/assets/
//   (git-ignored), for working offline and for exporting;
// - otherwise the page loads them straight from Poly Haven's servers, the
//   way the gallery already does for its own textures.
//
// The same list drives both, so they always agree.

export const MODELS = {
  // The cliff: big photoscanned rock faces.
  mountainside: '4k', namaqualand_cliff_01: '4k', namaqualand_cliff_02: '4k', coastal_cliff_02: '4k',
  // Boulders and stones.
  boulder_01: '2k', namaqualand_boulder_06: '2k', namaqualand_boulder_03: '2k', rock_07: '2k', rock_09: '2k',
};
export const TEXTURES = {
  rock_face_03: { Diffuse: '2k', nor_gl: '2k', arm: '2k' },
  concrete_wall_008: { Diffuse: '4k', nor_gl: '4k', arm: '2k', Displacement: '2k' },
  rusty_metal_02: { Diffuse: '2k', nor_gl: '2k', arm: '2k' },
};

export const LOCAL = '/assets/';
const API = 'https://api.polyhaven.com/files/';

// Poly Haven's file list for one asset (urls of every format and size).
const lists = new Map();
export function polyHavenFiles(name) {
  if (!lists.has(name)) {
    lists.set(name, fetch(API + name).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Poly Haven ${r.status} ${name}`)))));
  }
  return lists.get(name);
}

// Are the scans on this server? Asked once; a dev server answers a missing
// file with its index page, so the answer must also not be HTML.
let local = null;
export function haveLocalScans() {
  return (local ??= fetch(`${LOCAL}rock/mountainside/mountainside.gltf`, { method: 'HEAD' })
    .then((r) => r.ok && !(r.headers.get('content-type') || '').includes('html'))
    .catch(() => false));
}

// Where to load a scanned model from: the .gltf, and a map from the paths it
// names (buffers, textures) to where those really are.
export async function modelSource(name) {
  if (await haveLocalScans()) return { url: `${LOCAL}rock/${name}/${name}.gltf`, files: null };
  const g = (await polyHavenFiles(name)).gltf[MODELS[name]].gltf;
  return { url: g.url, files: Object.fromEntries(Object.entries(g.include).map(([rel, inc]) => [rel, inc.url])) };
}

// Where to load one map of a scanned surface from.
export async function surfaceMapUrl(name, kind) {
  if (await haveLocalScans()) return `${LOCAL}surface/${name}_${kind}.jpg`;
  return (await polyHavenFiles(name))[kind][TEXTURES[name][kind]].jpg.url;
}
