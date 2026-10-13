import { createServer } from 'vite';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateDefaults } from './gen-defaults.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cssOutput = 'dev-assets/app.css';
const tailwind = path.join(root, 'node_modules/.bin/tailwindcss');
const cssArgs = ['-i', 'src/styles/app.css', '-o', cssOutput];
await generateDefaults();
await mkdir(path.join(root, 'dev-assets'), { recursive: true });
await promisify(execFile)(tailwind, cssArgs, { cwd: root });

const server = await createServer({
  root,
  configFile: false,
  server: { host: '0.0.0.0', port: Number(process.env.PORT || 5173) },
  plugins: [{
    name: 'heroxp-development',
    transformIndexHtml(html) {
      return html.replace('./assets/app.css', './dev-assets/app.css').replace('<head>', '<head><script>globalThis.__HEROXP_DEV__ = true;</script>');
    },
    configureServer(devServer) {
      devServer.watcher.on('change', async (file) => {
        if (file === path.join(root, 'src/data/defaults.json')) {
          try { await generateDefaults(); }
          catch (error) { console.error('默认数据生成失败:', error); }
        }
      });
    }
  }]
});
const watcher = spawn(tailwind, [...cssArgs, '--watch=always'], { cwd: root, stdio: 'inherit' });
watcher.on('error', (error) => { console.error(error); void shutdown(1); });
watcher.on('exit', (code) => { if (!stopping) void shutdown(code || 1); });
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  watcher.kill();
  await server.close();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
await server.listen();
server.printUrls();
