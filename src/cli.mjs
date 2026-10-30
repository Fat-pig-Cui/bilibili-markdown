#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { renderFormula } from './formula.mjs';
import { replaceFormulaSpans } from './markdown.mjs';

function usage() {
  console.error('用法：node src/cli.mjs INPUT.md [-o OUTPUT_DIR] [--svg] [--data-uri]');
  process.exit(2);
}

const args = process.argv.slice(2);
if (!args[0] || args.includes('-h') || args.includes('--help')) usage();
const input = path.resolve(args[0]);
const outIndex = args.indexOf('-o');
if (outIndex >= 0 && !args[outIndex + 1]) usage();
const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : `${path.dirname(input)}/${path.basename(input, path.extname(input))}_bilibili`);
const dataUri = args.includes('--data-uri');
const format = args.includes('--svg') ? 'svg' : 'png';
const source = await fs.readFile(input, 'utf8');
await fs.mkdir(outDir, { recursive: true });
const assetDir = path.join(outDir, 'formula-assets');
if (!dataUri) await fs.mkdir(assetDir, { recursive: true });
const assets = [];
const result = replaceFormulaSpans(source, (span, ordinal) => {
  let formula;
  try { formula = renderFormula(span.source.trim(), span.display); }
  catch (error) { throw new Error(`第 ${ordinal} 个公式渲染失败：${error.message}`); }
  const filename = `formula-${String(ordinal).padStart(3, '0')}.${format}`;
  if (dataUri && format === 'png') throw new Error('--data-uri 目前只支持 --svg；PNG 请使用输出目录中的资源文件');
  if (!dataUri) assets.push({ file: path.join(assetDir, filename), markup: formula.markup });
  const encoded = Buffer.from(formula.markup, 'utf8').toString('base64');
  const src = dataUri ? `data:image/svg+xml;base64,${encoded}` : `formula-assets/${filename}`;
  return `![公式 ${ordinal}](${src})`;
});
for (const asset of assets) {
  if (format === 'png') await sharp(Buffer.from(asset.markup), { density: 192 }).png().toFile(asset.file);
  else await fs.writeFile(asset.file, asset.markup, 'utf8');
}
const outputMd = path.join(outDir, path.basename(input));
await fs.writeFile(outputMd, result.markdown, 'utf8');
await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({
  input, output: outputMd, formulaCount: result.spans.length,
  mode: dataUri ? 'data-uri' : `relative-${format}`, format,
  formulas: result.spans.map((s, i) => ({ index: i + 1, display: s.display, source: s.source.trim(), asset: dataUri ? null : `formula-assets/formula-${String(i + 1).padStart(3, '0')}.${format}` })),
}, null, 2) + '\n');
console.log(`已转换 ${result.spans.length} 个公式`);
console.log(`Markdown: ${outputMd}`);
if (!dataUri) console.log(`公式资源: ${assetDir}（${format.toUpperCase()}）`);
