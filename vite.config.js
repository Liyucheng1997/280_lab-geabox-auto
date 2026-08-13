import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 开发辅助：POST /__snapshot 把 base64 PNG 存为 debug/snap.png（仅开发环境使用）
function snapshotPlugin() {
  return {
    name: 'snapshot-writer',
    configureServer(server) {
      server.middlewares.use('/__snapshot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const m = body.match(/^data:image\/(png|jpeg);base64,(.+)$/s);
            const name = (req.headers['x-snap-name'] || 'snap').toString().replace(/[^a-z0-9_-]/gi, '');
            const dir = path.resolve(__dirname, 'debug');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${name}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
            fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
            res.end('ok:' + file);
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [snapshotPlugin()],
});
