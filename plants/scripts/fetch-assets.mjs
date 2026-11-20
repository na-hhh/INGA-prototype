// Downloads the scanned rock, concrete and metal used by the vine tool from
// Poly Haven (polyhaven.com; everything there is CC0). They are large, so
// they are fetched rather than kept in the repository (without them the page
// loads the same files from Poly Haven directly; see src/vines/scans.js):
//
//   node plants/scripts/fetch-assets.mjs
//
// Files already present are skipped.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MODELS, TEXTURES } from '../src/vines/scans.js';

const OUT = new URL('../../public/assets/', import.meta.url).pathname;

const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'asset-fetch' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
};
async function save(url, path) {
  try {
    await stat(path);
    return;
  } catch {}
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await (await get(url)).arrayBuffer()));
  console.log(path.slice(OUT.length));
}
const only = process.argv.slice(2);
for (const [name, res] of Object.entries(MODELS)) {
  if (only.length && !only.includes(name)) continue;
  const files = await (await get(`https://api.polyhaven.com/files/${name}`)).json();
  const g = files.gltf[res].gltf;
  await save(g.url, `${OUT}rock/${name}/${name}.gltf`);
  for (const [rel, inc] of Object.entries(g.include)) await save(inc.url, `${OUT}rock/${name}/${rel}`);
}
for (const [name, maps] of Object.entries(TEXTURES)) {
  if (only.length && !only.includes(name)) continue;
  const files = await (await get(`https://api.polyhaven.com/files/${name}`)).json();
  for (const [kind, res] of Object.entries(maps)) {
    if (!files[kind]) { console.log(`missing ${name} ${kind}`); continue; }
    await save(files[kind][res].jpg.url, `${OUT}surface/${name}_${kind}.jpg`);
  }
}
