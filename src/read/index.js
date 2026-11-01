import { decode } from './encoding.js';
import { parseCSV, sniffDelimiter } from './csv.js';
import { readHTML, looksLikeHTML } from './html.js';
import { readText } from './text.js';
import { isZip } from './zip.js';
import { readXLSX } from './xlsx.js';

// 入力（文字列 / バイト列 / File・Blob / オブジェクト配列）を表 { columns, rows, meta, warnings } に揃える。
// rows は文字列の二次元配列。warnings は読み込み時に気づいた問題（要確認に加える）。
export async function read(input, options = {}) {
  const table = await readTable(input, options);
  table.columns = uniqueColumns(table.columns);
  table.warnings ??= [];
  return table;
}

async function readTable(input, options) {
  const meta = { source: options.format ?? null, encoding: null };

  if (input === null || input === undefined) throw new TypeError('入力がありません（文字列・ファイル・バイト列・配列を渡してください）');
  if (Array.isArray(input)) return fromRecords(input, { ...meta, source: 'records' });

  let text;
  if (typeof input === 'string') {
    text = input.replace(/^\ufeff/, '');
  } else {
    let bytes = input;
    if (typeof input?.arrayBuffer === 'function') {
      meta.name = input.name;
      bytes = await input.arrayBuffer();
    }
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (isZip(u8) || options.format === 'xlsx') {
      const table = await readXLSX(u8, options);
      return { ...table, meta: { ...meta, ...table.meta } };
    }
    if (u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) {
      throw new Error('旧形式のExcel（.xls）には未対応です。.xlsx か CSV で保存し直してください');
    }
    const decoded = decode(u8);
    text = decoded.text;
    meta.encoding = decoded.encoding;
  }

  const format = options.format ?? guessFormat(text, meta.name);
  meta.source = format;

  if (format === 'json') {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      // 拡張子や指定がなく先頭が [ { なだけなら、CSVとして読み直す（「[メモ],金額」など）
      if (options.format === 'json' || /\.json$/i.test(meta.name ?? '')) throw new Error(`JSONとして読み込めません：${error.message}`);
      return readCSV(text, options, { ...meta, source: 'csv' });
    }
    return fromRecords(Array.isArray(data) ? data : [data], meta);
  }

  if (format === 'html') {
    const table = readHTML(text, options);
    return { ...table, meta: { ...meta, ...table.meta, source: 'html' }, warnings: [] };
  }

  // 区切り文字の表ならCSVとして読む。そうでなければ、構造のないテキストとして表を探す
  if (format === 'text' || format === 'auto') {
    if (!isDelimited(text, options.delimiter)) {
      const table = readText(text);
      if (table) return { columns: table.columns, rows: table.rows, meta: { ...meta, source: 'text', how: table.how }, warnings: [] };
    }
    meta.source = 'csv';
  }

  return readCSV(text, options, meta);
}

// 区切り文字が大半の行にあれば区切り文字の表とみなす。列数がそろっているかは問わない
// （末尾の空欄を省く出力・見出しの後ろのカンマ・タイトル行があっても、従来どおりCSVとして読む）
function isDelimited(text, delimiter) {
  const { rows } = parseCSV(text.split(/\r?\n/).slice(0, 200).join('\n'), delimiter ?? sniffDelimiter(text));
  if (!rows.length) return false;
  return rows.filter((r) => r.length >= 2).length >= rows.length * 0.6;
}

function readCSV(text, options, meta) {
  const { rows, delimiter } = parseCSV(text, options.delimiter);
  meta.delimiter = delimiter;
  if (!rows.length) return { columns: [], rows: [], meta, warnings: [] };

  const header = options.header ?? true;
  const columns = header ? rows.shift().map((h) => cleanHeader(h)) : [];
  // 見出しより多いセルは捨てずに列を足し、要確認に挙げる（区切り文字の誤りに気づけるように）
  // 行数が多いと Math.max(...配列) はスタックが溢れるので、ループで求める
  let width = columns.length;
  for (const r of rows) width = Math.max(width, r.length);
  const named = columns.length;
  for (let i = 0; i < width; i++) columns[i] ||= `列${i + 1}`;
  const warnings = [];
  rows.forEach((r, ri) => {
    if (!header || r.length <= named) return;
    const extra = r.slice(named).filter((v) => v.trim() !== '');
    if (extra.length) {
      warnings.push({ row: ri, column: columns[named], value: extra.join(meta.delimiter), reason: `見出し（${named}列）より多いセルがあります。引用符で囲まれていない区切り文字の可能性` });
    }
  });
  return { columns, rows: rows.map((r) => pad(r, width)), meta, warnings };
}

const cleanHeader = (h) => String(h).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();

// 重複した列名は「名前_2」のように番号を付ける（同じ名前だと片方のデータが消えるため）
export function uniqueColumns(columns) {
  const seen = new Set();
  return columns.map((c, i) => {
    let name = cleanHeader(c) || `列${i + 1}`;
    if (name === '__proto__') name = '__proto___';
    const base = name;
    for (let n = 2; seen.has(name); n++) name = `${base}_${n}`;
    seen.add(name);
    return name;
  });
}

function guessFormat(text, name = '') {
  if (/\.json$/i.test(name)) return 'json';
  if (/\.html?$/i.test(name)) return 'html';
  if (/\.(csv|tsv)$/i.test(name)) return 'csv';
  if (/\.txt$/i.test(name)) return 'text';
  if (looksLikeHTML(text)) return 'html';
  const head = text.trimStart()[0];
  return head === '[' || head === '{' ? 'json' : 'auto';
}

function fromRecords(records, meta) {
  const flat = records.map((r) => flatten(r));
  const columns = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const rows = flat.map((r) => columns.map((c) => (r[c] == null ? '' : String(r[c]))));
  return { columns, rows, meta };
}

// 配列はそのまま文字列にする（数字の配列を連結して1つの数にしないよう、区切りを明示する）
function scalar(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().replace(/T00:00:00\.000Z$/, '');
  if (Array.isArray(v)) return v.some((x) => x !== null && typeof x === 'object') ? JSON.stringify(v) : v.join(' / ');
  return v;
}

// { user: { name: 'a' } } → { 'user.name': 'a' }
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object' || obj instanceof Date || Array.isArray(obj)) {
    out[prefix || 'value'] = scalar(obj);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else out[key] = scalar(v);
  }
  return out;
}

function pad(row, width) {
  const r = row.slice(0, width);
  while (r.length < width) r.push('');
  return r;
}
