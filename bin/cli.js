#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { tidy } from '../src/index.js';

const USAGE = `使い方: nihon-tidy <入力ファイル> [--sheet シート名|番号] [--report report.html] [--out output.json|output.csv] [--min-confidence 0.9]`;

const args = process.argv.slice(2);
const input = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!input || args.includes('--help')) {
  console.log(USAGE);
  process.exit(input ? 0 : 1);
}

const bytes = await readFile(input);
const file = { name: basename(input), arrayBuffer: async () => bytes };
const options = {};
if (opt('min-confidence')) options.minConfidence = Number(opt('min-confidence'));
if (opt('sheet')) options.sheet = /^\d+$/.test(opt('sheet')) ? Number(opt('sheet')) : opt('sheet');
const result = await tidy(file, options);

const { meta } = result;
const source = meta.source === 'xlsx' ? `Excel：シート「${meta.sheet}」／全${meta.sheets.length}シート、結合セル${meta.merged}` : `文字コード：${meta.encoding}`;
console.log(`${result.data.length}行 / ${result.schema.length}列（${source}）`);
for (const c of result.schema) {
  const conf = c.type === 'text' ? '' : ` ${Math.round(c.confidence * 100)}%`;
  console.log(`  ${c.name}: ${c.label}${conf}`);
}
const applied = result.changes.filter((c) => c.applied).length;
console.log(`変更 ${applied}件、提案 ${result.changes.length - applied}件、要確認 ${result.issues.length}件`);

const report = opt('report');
if (report) {
  await writeFile(report, result.toReport());
  console.log(`レポート → ${report}`);
}
const out = opt('out');
if (out) {
  await writeFile(out, out.endsWith('.csv') ? result.toCSV() : JSON.stringify(result.data, null, 2));
  console.log(`データ → ${out}`);
}
