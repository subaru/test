// Excel（.xlsx）の読み込み。共有文字列・日付書式・結合セル・複数シートに対応する。
import { unzip } from './zip.js';

const utf8 = new TextDecoder();

function decodeXML(s) {
  return s
    .replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

// <t> を連結した文字列。日本語版Excelが付けるふりがな（<rPh>）は除く。
function textOf(xml) {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return decodeXML([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
}

export function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

// 日付として表示する書式番号（組み込み：14-22、日本語ロケールの27-36・50-58）
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code) {
  const s = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return !/E[+-]/i.test(s) && /[ymdge]/i.test(s);
}

// スタイル番号 → 日付書式かどうか
export function parseDateStyles(xml) {
  if (!xml) return [];
  const custom = new Map(
    [...xml.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [+attr(m[0], 'numFmtId'), decodeXML(attr(m[0], 'formatCode') ?? '')]),
  );
  const xfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = +attr(m[0], 'numFmtId');
    return BUILTIN_DATES.has(id) || (custom.has(id) && isDateFormat(custom.get(id)));
  });
}

function colIndex(ref) {
  let n = 0;
  for (const c of ref.match(/^[A-Z]+/)[0]) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

function serialToISO(n) {
  const ms = Math.round((n - 25569) * 86400000); // 25569 = 1970-01-01
  const iso = new Date(ms).toISOString();
  return Number.isInteger(n) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function parseSheet(xml, shared, dateStyles) {
  const grid = [];
  let merged = 0;

  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = +attr(row[1], 'r') - 1;
    for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r');
      const type = attr(c[1], 't');
      const style = +(attr(c[1], 's') ?? 0);
      const inner = c[2] ?? '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 's') value = shared[+v] ?? '';
      else if (type === 'inlineStr') value = textOf(inner);
      else if (type === 'str') value = decodeXML(v ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') value = '';
      else if (v !== undefined) value = dateStyles[style] ? serialToISO(+v) : v;
      if (value === '') continue;
      (grid[r] ??= [])[colIndex(ref)] = value;
    }
  }

  // 結合セルは左上の値で埋める（縦に結合した「地域」などを各行に行き渡らせる）
  for (const m of xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
    const [c1, r1, c2, r2] = [colIndex(m[1]), +m[2] - 1, colIndex(m[3]), +m[4] - 1];
    const value = grid[r1]?.[c1];
    if (value === undefined) continue;
    merged++;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) (grid[r] ??= [])[c] = value;
  }

  // grid は疎な配列なので、map ではなく添字で回す
  let width = 0;
  for (let i = 0; i < grid.length; i++) width = Math.max(width, grid[i]?.length ?? 0);
  const rows = Array.from({ length: grid.length }, (_, i) => Array.from({ length: width }, (_, c) => grid[i]?.[c] ?? ''));
  return { rows, merged };
}

// 見出し行を探す：空行と、結合したタイトル行（値が1種類しかない行）を飛ばす
function findHeader(rows) {
  const width = Math.max(1, ...rows.map((r) => r.filter((v) => v !== '').length));
  return rows.findIndex((r) => {
    const vals = r.filter((v) => v !== '');
    return vals.length >= Math.max(2, width * 0.5) && new Set(vals).size > 1;
  });
}

export async function readXLSX(u8, options = {}) {
  const zip = unzip(u8);
  const text = async (name) => (zip.has(name) ? utf8.decode(await zip.get(name)()) : null);

  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new Error('Excelのブック（xl/workbook.xml）が見つかりません');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const rid = attr(m[0], 'r:id');
    const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((r) => r[0]).find((r) => attr(r, 'Id') === rid);
    const path = attr(target ?? '', 'Target') ?? '';
    return { name: decodeXML(attr(m[0], 'name')), path: path.startsWith('/') ? path.slice(1) : `xl/${path}` };
  });

  const want = options.sheet ?? 0;
  const sheet = typeof want === 'number' ? sheets[want] : sheets.find((s) => s.name === want);
  if (!sheet) throw new Error(`シートが見つかりません：${want}（${sheets.map((s) => s.name).join('、')}）`);

  const shared = parseSharedStrings((await text('xl/sharedStrings.xml')) ?? '');
  const dateStyles = parseDateStyles(await text('xl/styles.xml'));
  const { rows, merged } = parseSheet(await text(sheet.path), shared, dateStyles);

  const h = options.header === false ? -1 : (options.headerRow ?? findHeader(rows));
  const columns = h >= 0 ? rows[h].map((v, i) => v.trim() || `列${i + 1}`) : (rows[0] ?? []).map((_, i) => `列${i + 1}`);
  const body = rows.slice(h + 1).filter((r) => r.some((v) => v !== ''));

  return {
    columns,
    rows: body,
    meta: { source: 'xlsx', sheet: sheet.name, sheets: sheets.map((s) => s.name), merged, headerRow: h + 1 },
  };
}
