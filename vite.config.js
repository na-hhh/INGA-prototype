import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Éditeur INGA : « Enregistrer » écrit le monde édité dans src/data/<nom>.json,
// versionné avec le projet. Serveur de dev uniquement, requêtes locales
// seulement, et seulement depuis la page elle-même (en-tête + origine).
// Ces fichiers ne déclenchent pas de rechargement à chaud : la page en cours
// garde son état, la prochaine ouverture lit la version enregistrée.
const DATA = path.resolve('src/data');
function ingaEditorSave() {
  return {
    name: 'inga-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__inga/save', (req, res) => {
        const ip = req.socket.remoteAddress || '';
        const origin = req.headers.origin || '';
        const local = /^(::1|127\.|::ffff:127\.)/.test(ip);
        const sameSite = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        if (!local || !sameSite || req.headers['x-inga-editor'] !== '1') { res.statusCode = 403; res.end('refusé'); return; }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const name = new URL(req.url, 'http://x').searchParams.get('file') || '';
        if (!/^[a-z0-9-]{1,40}$/.test(name)) { res.statusCode = 400; res.end('nom invalide'); return; }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
        req.on('end', () => {
          try {
            const obj = JSON.parse(body);
            fs.mkdirSync(DATA, { recursive: true });
            fs.writeFileSync(path.join(DATA, name + '.json'), JSON.stringify(obj, null, 2) + '\n');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: 'src/data/' + name + '.json' }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e.message || e));
          }
        });
      });
    },
    handleHotUpdate({ file }) {
      if (file.startsWith(DATA + path.sep)) return [];
    },
  };
}

// Plusieurs pages : la galerie à la racine, les plantes (L-systèmes, liane,
// feuille qui sèche, cellules) sous /plants/.
export default defineConfig({
  plugins: [ingaEditorSave()],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: 'index.html',
        plants: 'plants/index.html',
        vines: 'plants/vines.html',
        leaf: 'plants/leaf.html',
        cells: 'plants/cells.html',
      },
    },
  },
});
