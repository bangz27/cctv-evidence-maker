import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// Dev-only: lets the app save exported files to ./test-output when
// window.__cctvSaveToDisk = true, so exports can be checked outside the browser.
// Never included in `vite build`.
function devSave(): Plugin {
  return {
    name: 'dev-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const name = basename(new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'file.bin');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = resolve(server.config.root, 'test-output');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devSave()],
});
