// 由 src/data/defaults.json 生成 src/data/defaults.js，保证浏览器无需 JSON module 支持。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function renderDefaultsModule(json) {
  const data = JSON.parse(json);
  return `// 此文件由 scripts/gen-defaults.mjs 从 defaults.json 生成，请勿手工修改。\nconst defaults = ${JSON.stringify(data, null, 2)};\n\nexport default defaults;\n`;
}

export async function generateDefaults() {
  const src = path.join(root, 'src/data/defaults.json');
  const dest = path.join(root, 'src/data/defaults.js');
  const json = await readFile(src, 'utf8');
  const content = renderDefaultsModule(json);
  await writeFile(dest, content);
  return { content, dest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { dest } = await generateDefaults();
  console.log(`defaults.js 已生成: ${path.relative(root, dest)}`);
}
