import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/entry.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'dist/index.js',
  legalComments: 'eof',
  minify: false,
  write: false,
});

// 工作树可能复用上层依赖；只统一生成的模块路径注释，避免安装位置影响产物。
for (const output of result.outputFiles) {
  const text = output.text.replace(/^\/\/ (?:\.\.\/)+node_modules\//gm, '// node_modules/');
  await writeFile(output.path, text);
}
