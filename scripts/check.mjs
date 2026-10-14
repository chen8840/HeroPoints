// 发布产物检查：无 CDN 引用、相对路径完整、defaults.js 与 defaults.json 同步。
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { renderDefaultsModule } from './gen-defaults.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const problems = [];

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full, base)));
    else files.push(path.relative(base, full));
  }
  return files.sort();
}

// 1. defaults.js 必须与 defaults.json 同步
const defaultsJson = await readFile(path.join(root, 'src/data/defaults.json'), 'utf8');
const defaultsJs = await readFile(path.join(root, 'src/data/defaults.js'), 'utf8');
if (defaultsJs !== renderDefaultsModule(defaultsJson)) {
  problems.push('src/data/defaults.js 与 defaults.json 不一致，请运行 node scripts/gen-defaults.mjs');
}

// 2. dist 必须存在
const distStat = await stat(dist).catch(() => null);
if (!distStat) {
  problems.push('dist/ 不存在，请先运行 npm run build');
} else {
  const files = await listFiles(dist);

  // 3. 入口页不得引用任何外部资源（CDN 脚本、样式、字体）
  const indexHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
  const externalRefs = [...indexHtml.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']/g)].map((m) => m[0]);
  if (externalRefs.length > 0) {
    problems.push(`index.html 引用了外部资源（禁止 CDN）：${externalRefs.join(', ')}`);
  }

  // 4. 入口页引用的本地资源必须存在
  const localRefs = [...indexHtml.matchAll(/(?:src|href)\s*=\s*["']\.\/([^"']+)["']/g)].map((m) => m[1]);
  for (const ref of localRefs) {
    if (!files.some((file) => file.split(path.sep).join('/') === ref)) {
      problems.push(`index.html 引用的资源不存在于 dist：${ref}`);
    }
  }

  // 5. Service Worker 必须已注入版本与预缓存清单，且语法合法
  const sw = await readFile(path.join(dist, 'sw.js'), 'utf8');
  if (sw.includes('__BUILD_VERSION__') || sw.includes('__PRECACHE_MANIFEST__')) {
    problems.push('dist/sw.js 仍包含未替换的模板占位符');
  }
  try {
    new vm.Script(sw, { filename: 'dist/sw.js' });
  } catch (err) {
    problems.push(`dist/sw.js 语法错误：${err.message}`);
  }
  if (!files.some((file) => file === 'manifest.webmanifest')) {
    problems.push('dist/manifest.webmanifest 缺失');
  } else {
    const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
    if (manifest.orientation !== 'portrait') {
      problems.push('manifest 未锁定竖屏（orientation 应为 portrait）');
    }
    if (manifest.display !== 'standalone') {
      problems.push('manifest 的 display 应为 standalone');
    }
  }

  // 6. 所有文本类产物不得包含本地绝对路径引用（适配 GitHub Pages 子路径）
  for (const file of files) {
    if (!/\.(html|css|js|webmanifest)$/.test(file)) continue;
    const content = await readFile(path.join(dist, file), 'utf8');
    if (/["'(]\/src\//.test(content) || /["'(]\/assets\//.test(content) || /["'(]\/icons\//.test(content)) {
      problems.push(`${file} 使用了根路径引用（/src、/assets 或 /icons），会破坏子路径部署`);
    }
  }

  // 7. 密钥不得进入产物
  for (const file of files) {
    if (!/\.(html|js|json|css|webmanifest)$/.test(file)) continue;
    const content = await readFile(path.join(dist, file), 'utf8');
    if (/X-Master-Key['"]?\s*[:=]\s*['"][^'"]{10,}/.test(content) && !file.includes('src/sync')) {
      problems.push(`${file} 疑似包含硬编码密钥`);
    }
  }
}

if (problems.length > 0) {
  console.error('检查未通过：');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log('检查通过：产物无 CDN 引用、相对路径完整、defaults 同步、密钥未打包。');
