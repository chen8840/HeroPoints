// 构建脚本：生成 dist 静态产物（本地 CSS、Service Worker 预缓存清单），不依赖任何 CDN。
import { cp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateDefaults } from './gen-defaults.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, base)));
    } else {
      files.push(path.relative(base, full));
    }
  }
  return files.sort();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`))));
  });
}

async function build() {
  await generateDefaults();

  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'assets'), { recursive: true });

  // 静态资源
  await cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));
  await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
  await cp(path.join(root, 'public'), dist, { recursive: true });

  // Tailwind 编译为本地 CSS
  const tailwindBin = path.join(root, 'node_modules', '.bin', 'tailwindcss');
  await run(tailwindBin, ['-i', 'src/styles/app.css', '-o', 'dist/assets/app.css', '--minify']);

  // 生成 Service Worker：按文件内容计算构建版本并生成预缓存清单
  const files = await listFiles(dist);
  const hash = createHash('sha256');
  for (const file of files) {
    const content = await readFile(path.join(dist, file));
    hash.update(file);
    hash.update(content);
  }
  const buildVersion = hash.digest('hex').slice(0, 12);

  const precache = files
    .filter((file) => file !== 'sw.js' && !file.startsWith('.'))
    .map((file) => file.split(path.sep).join('/'));

  const swTemplate = await readFile(path.join(root, 'public', 'sw.js'), 'utf8');
  const sw = swTemplate
    .replaceAll('__BUILD_VERSION__', buildVersion)
    .replaceAll('__PRECACHE_MANIFEST__', JSON.stringify(precache, null, 2));
  await writeFile(path.join(dist, 'sw.js'), sw);

  // GitHub Pages 不需要 Jekyll 处理
  await writeFile(path.join(dist, '.nojekyll'), '');

  const totalBytes = (
    await Promise.all(
      (await listFiles(dist)).map(async (file) => (await stat(path.join(dist, file))).size)
    )
  ).reduce((sum, size) => sum + size, 0);

  console.log(`构建完成：${(await listFiles(dist)).length} 个文件，共 ${(totalBytes / 1024).toFixed(1)} KB，版本 ${buildVersion}`);
}

await build();
