#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { tidy } from '../src/index.js';

const USAGE = `使い方: nihon-tidy <入力ファイル> [オプション]

  --sheet <名前|番号>       Excelのシートを選ぶ（既定は最初のシート）
  --table <番号>            HTMLのページ内の表を番号で選ぶ（既定は自動）
  --format <形式>           csv / json / xlsx / html / text（既定は自動判定）
  --report <file.html>      分析レポートHTMLを書き出す
  --out <file.json|.csv>    正規化したデータを書き出す（CSVはExcel向けにBOM付き）
  --min-confidence <0〜1>   これ未満の変換は提案にとどめる（既定 0.9）
  --help                    この説明を表示する`;

const VALUED = ['sheet', 'table', 'format', 'report', 'out', 'min-confidence'];

function fail(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const opts = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) {
    positional.push(a);
    continue;
  }
  const name = a.slice(2);
  if (!VALUED.includes(name)) fail(`不明なオプションです：${a}\n\n${USAGE}`);
  const value = args[++i];
  if (value === undefined || value.startsWith('--')) fail(`${a} には値が必要です`);
  opts[name] = value;
}
if (positional.length !== 1) fail(positional.length ? `入力ファイルは1つだけ指定してください：${positional.join(' ')}` : `入力ファイルを指定してください\n\n${USAGE}`);

const input = positional[0];
const options = {};
if (opts['min-confidence'] !== undefined) {
  const n = Number(opts['min-confidence']);
  if (!(n >= 0 && n <= 1)) fail(`--min-confidence は 0〜1 の数で指定してください：${opts['min-confidence']}`);
  options.minConfidence = n;
}
if (opts.table !== undefined) {
  if (!/^\d+$/.test(opts.table)) fail(`--table は 0 から始まる番号で指定してください：${opts.table}`);
  options.table = Number(opts.table);
}
if (opts.format !== undefined) {
  if (!['csv', 'json', 'xlsx', 'html', 'text'].includes(opts.format)) fail(`--format は csv / json / xlsx / html / text のどれかです：${opts.format}`);
  options.format = opts.format;
}
if (opts.sheet !== undefined) options.sheet = /^\d+$/.test(opts.sheet) ? Number(opts.sheet) : opts.sheet;

if (options.table !== undefined && !/\.html?$/i.test(input) && options.format !== 'html') {
  console.error('注意: --table はHTMLの入力にだけ使われます');
}

let result;
try {
  const bytes = await readFile(input);
  result = await tidy({ name: basename(input), arrayBuffer: async () => bytes }, options);
} catch (error) {
  fail(error.code === 'ENOENT' ? `ファイルが見つかりません：${input}` : error.message);
}

const { meta } = result;
const source =
  meta.source === 'xlsx'
    ? `Excel・シート「${meta.sheet}」（全${meta.sheets.length}シート）、結合セル${meta.merged}`
    : `${meta.how ? `${meta.how}、` : ''}文字コード：${meta.encoding ?? '-'}`;
console.log(`${result.data.length}行 / ${result.schema.length}列（${source}）`);
for (const c of result.schema) {
  const conf = c.type === 'text' ? '' : ` ${Math.round(c.confidence * 100)}%`;
  console.log(`  ${c.name}: ${c.label}${conf}`);
}
const applied = result.changes.filter((c) => c.applied).length;
console.log(`変更 ${applied}件、提案 ${result.changes.length - applied}件、表記ゆれ ${result.clusters.length}組、要確認 ${result.issues.length}件`);

try {
  if (opts.report) {
    await writeFile(opts.report, result.toReport());
    console.log(`レポート → ${opts.report}`);
  }
  if (opts.out) {
    const csv = /\.csv$/i.test(opts.out);
    await writeFile(opts.out, csv ? result.toCSV({ bom: true }) : JSON.stringify(result.data, null, 2));
    console.log(`データ → ${opts.out}`);
  }
} catch (error) {
  fail(`書き出せません：${error.message}`);
}
