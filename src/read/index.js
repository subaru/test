import { decode } from './encoding.js';
import { parseCSV } from './csv.js';

// 入力（文字列 / バイト列 / File・Blob / オブジェクト配列）を表 { columns, rows, meta } に揃える。
// rows は文字列の二次元配列。
export async function read(input, options = {}) {
  const meta = { source: options.format ?? null, encoding: null };

  if (Array.isArray(input)) return fromRecords(input, { ...meta, source: 'records' });

  let text;
  if (typeof input === 'string') {
    text = input;
  } else {
    let bytes = input;
    if (typeof input?.arrayBuffer === 'function') {
      meta.name = input.name;
      bytes = await input.arrayBuffer();
    }
    const decoded = decode(bytes);
    text = decoded.text;
    meta.encoding = decoded.encoding;
  }

  const format = options.format ?? guessFormat(text, meta.name);
  meta.source = format;

  if (format === 'json') {
    const data = JSON.parse(text);
    return fromRecords(Array.isArray(data) ? data : [data], meta);
  }

  const { rows, delimiter } = parseCSV(text, options.delimiter);
  meta.delimiter = delimiter;
  const header = options.header ?? true;
  const columns = header ? rows.shift().map((h, i) => h.trim() || `列${i + 1}`) : rows[0].map((_, i) => `列${i + 1}`);
  const width = columns.length;
  return { columns, rows: rows.map((r) => pad(r, width)), meta };
}

function guessFormat(text, name = '') {
  if (/\.json$/i.test(name)) return 'json';
  if (/\.(csv|tsv|txt)$/i.test(name)) return 'csv';
  const head = text.trimStart()[0];
  return head === '[' || head === '{' ? 'json' : 'csv';
}

function fromRecords(records, meta) {
  const flat = records.map((r) => flatten(r));
  const columns = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const rows = flat.map((r) => columns.map((c) => (r[c] == null ? '' : String(r[c]))));
  return { columns, rows, meta };
}

// { user: { name: 'a' } } → { 'user.name': 'a' }
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix || 'value'] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

function pad(row, width) {
  const r = row.slice(0, width);
  while (r.length < width) r.push('');
  return r;
}
