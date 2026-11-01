// Excel（.xlsx）の読み込み。共有文字列・日付書式・結合セル・複数シートに対応する。
import { unzip } from './zip.js';
import { ruleByType } from '../rules/index.js';

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
  return decodeXML([...body.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((m) => m[1] ?? '').join(''));
}

// 空の文字列は <si/> と書かれる。これを飛ばすと以降の番号がずれるので必ず1件として数える
export function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ''));
}

// 日付として表示する書式番号（組み込み：14-17・22、日本語ロケールの27-36・50-58）
const BUILTIN_DATES = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

// 書式の種類：'date'（日付・日時）/ 'time'（時刻・経過時間）/ null（数値など）
export function formatKind(code) {
  // 引用符の文字列・[色]や[$-ロケール]・エスケープ・「General」を除いてから記号を見る
  const s = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[([hms]+)\]/gi, '$1')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/general|AM\/PM|A\/P/gi, '');
  if (/E[+-]/i.test(s)) return null;
  if (/[ydge]/i.test(s) || /m/i.test(s.replace(/[hs]+:?m+|m+:?s+/gi, ''))) return 'date';
  if (/[hs]/i.test(s)) return 'time';
  return null;
}

const BUILTIN_TIMES = new Set([18, 19, 20, 21, 45, 46, 47]);

// スタイル番号 → 'date' / 'time' / null
export function parseDateStyles(xml) {
  if (!xml) return [];
  const custom = new Map(
    [...xml.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [+attr(m[0], 'numFmtId'), decodeXML(attr(m[0], 'formatCode') ?? '')]),
  );
  const xfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = +attr(m[0], 'numFmtId');
    if (custom.has(id)) return formatKind(custom.get(id));
    return BUILTIN_DATES.has(id) ? 'date' : BUILTIN_TIMES.has(id) ? 'time' : null;
  });
}

function colIndex(ref) {
  let n = 0;
  for (const c of ref.match(/^[A-Z]+/)[0]) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

const pad2 = (n) => String(n).padStart(2, '0');

// シリアル値を日付・日時・時刻の文字列に。1900年基準ではExcelが存在しない1900-02-29を数えている
export function serialToISO(n, kind = 'date', date1904 = false) {
  if (!Number.isFinite(n)) return null;
  const ms = Math.round(((n % 1) + (n < 0 ? 1 : 0)) * 86400) * 1000;
  const time = `${pad2(Math.floor(ms / 3600000) % 24)}:${pad2(Math.floor(ms / 60000) % 60)}`;
  if (kind === 'time' || (n >= 0 && n < 1)) return time;
  const days = Math.floor(n) + (date1904 ? 1462 : n < 60 ? 1 : 0);
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
  return ms ? `${date} ${time}` : date;
}

export function parseSheet(xml, shared, dateStyles, date1904 = false) {
  const grid = [];
  let merged = 0;
  const merges = [];
  let nextRow = 0;

  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    // r 属性は省略できるので、なければ直前の行の次とみなす
    const r = attr(row[1], 'r') ? +attr(row[1], 'r') - 1 : nextRow;
    nextRow = r + 1;
    let nextCol = 0;
    for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r');
      const col = ref ? colIndex(ref) : nextCol;
      nextCol = col + 1;
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
      else if (type === 'd') value = (v ?? '').replace('T', ' ').replace(/ 00:00:00(\.0+)?Z?$/, '').replace(/(:\d\d)(\.\d+)?Z?$/, '$1');
      else if (v !== undefined) value = (dateStyles[style] && serialToISO(+v, dateStyles[style], date1904)) || decodeXML(v);
      if (value === '') continue;
      (grid[r] ??= [])[col] = value;
    }
  }

  // 結合セルは左上の値で埋める（縦に結合した「地域」などを各行に行き渡らせる）
  for (const m of xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
    const [c1, r1, c2, r2] = [colIndex(m[1]), +m[2] - 1, colIndex(m[3]), +m[4] - 1];
    const value = grid[r1]?.[c1];
    if (value === undefined) continue;
    merged++;
    merges.push({ r1, c1, r2, c2 });
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) (grid[r] ??= [])[c] = value;
  }

  // grid は疎な配列なので、map ではなく添字で回す
  let width = 0;
  for (let i = 0; i < grid.length; i++) width = Math.max(width, grid[i]?.length ?? 0);
  const rows = Array.from({ length: grid.length }, (_, i) => Array.from({ length: width }, (_, c) => grid[i]?.[c] ?? ''));
  return { rows, merged, merges };
}

// 見出し行を探す：空行と、結合したタイトル行（値が1種類しかない行）を飛ばす
function findHeader(rows) {
  let width = 1;
  for (const r of rows) width = Math.max(width, r.filter((v) => v !== '').length);
  if (width === 1) return rows.findIndex((r) => r.some((v) => v !== '')); // 1列だけの表
  return rows.findIndex((r) => {
    const vals = r.filter((v) => v !== '');
    return vals.length >= Math.max(2, width * 0.5) && new Set(vals).size > 1;
  });
}

// 見出しが何段か。データの行を見出しとして飲み込むのが一番困るので、証拠がそろったときだけ2段目とみなす：
//   ・見出し行から次の行へ縦に結合したセルがある（「店舗」が2段にまたがる）
//   ・見出し行に横にまたがるセル（結合、または同じ値の並び）があり、その下に小見出しが並ぶ
//     （空でなく、数・日付・電話番号などデータらしい値でなく、同じ範囲の中で互いに違う値）
//   ・それ以外の列は、縦の結合か、上が空で下が小見出しらしい値か、下が空
// 縦の結合がなく、ほかの条件だけそろうときは判定せず、info.maybe に段数の候補を入れる（headerRows で指定してもらう）

const DATA_LIKE = /^[-+(△▲¥￥]?[\d,.]+%?\)?$|^\d{4}[-/年.]\d{1,2}|^(?:TRUE|FALSE)$/i;
const DATA_RULES = ['date', 'phone', 'postal', 'email', 'number', 'boolean'];

function dataLike(value) {
  const v = value.normalize('NFKC').trim();
  return DATA_LIKE.test(v) || /\d{1,2}:\d{2}/.test(v) || DATA_RULES.some((t) => ruleByType[t].match(v, { hinted: false }));
}

export function headerDepth(rows, h, merges = [], max = 3, info = {}) {
  let depth = 1;
  while (depth < max) {
    const r = h + depth - 1;
    const top = rows[r];
    const next = rows[r + 1];
    if (!top || !next) break;
    const empty = (c) => (next[c] ?? '') === '';
    // 次の行へ縦に結合した列
    const vertical = new Set();
    for (const m of merges) if (m.r1 <= r && m.r2 >= r + 1) for (let c = m.c1; c <= m.c2; c++) vertical.add(c);
    // 横にまたがる範囲（縦にも結合した範囲は除く）。下がすべて空の範囲は表の外の注記などとみなして無視する
    const groups = [];
    for (const m of merges) if (m.r1 <= r && m.r2 === r && m.c2 > m.c1) groups.push([m.c1, m.c2]);
    for (let c = 0; c < top.length; c++) {
      if (top[c] === '' || top[c] !== top[c + 1] || vertical.has(c) || groups.some(([a, b]) => c >= a && c <= b)) continue;
      let e = c + 1;
      while (top[e + 1] === top[c] && !vertical.has(e + 1)) e++;
      groups.push([c, e]);
      c = e;
    }
    const used = groups.filter(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i).some((c) => !empty(c)));
    if (!used.length) break;
    const inGroup = new Set();
    let ok = true;
    // 次の行で横に結合したセルは1つの小見出しとして数える
    const sameCell = (c) => merges.some((m) => m.r1 <= r + 1 && m.r2 >= r + 1 && m.c1 < c && m.c2 >= c);
    for (const [a, b] of used) {
      const subs = [];
      for (let c = a; c <= b; c++) {
        inGroup.add(c);
        if (!sameCell(c) || c === a) subs.push(next[c] ?? '');
      }
      if (subs.length < 2 || subs.some((v) => v === '' || dataLike(v)) || new Set(subs).size !== subs.length) ok = false;
    }
    for (let c = 0; c < top.length && ok; c++) {
      if (inGroup.has(c) || vertical.has(c) || empty(c)) continue;
      if (top[c] !== '' || dataLike(next[c])) ok = false;
    }
    if (!ok) break;
    if (!vertical.size) {
      info.maybe = depth + 1;
      break;
    }
    depth++;
  }
  return depth;
}

// 複数段の見出しを「売上・上期」のようにつなぐ（同じ値が続く段は1つにまとめる）
function joinHeader(rows, h, depth, width) {
  return Array.from({ length: width }, (_, c) => {
    const parts = [];
    for (let r = h; r < h + depth; r++) {
      const v = (rows[r][c] ?? '').trim();
      if (v && parts.at(-1) !== v) parts.push(v);
    }
    return parts.join('・') || `列${c + 1}`;
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
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const { rows, merged, merges } = parseSheet((await text(sheet.path)) ?? '', shared, dateStyles, date1904);

  const h = options.header === false ? -1 : (options.headerRow ?? findHeader(rows));
  const width = rows[0]?.length ?? 0;
  // 見出しの段数：headerRows で指定するか、結合セルから判定する
  const info = {};
  let depth = 0;
  let headerNote;
  if (h >= 0) {
    const want = options.headerRows;
    if (want !== undefined && want !== null && !(Number.isInteger(+want) && +want >= 1)) {
      throw new TypeError(`headerRows は 1 以上の整数で指定してください：${want}`);
    }
    depth = want !== undefined && want !== null ? +want : headerDepth(rows, h, merges, 3, info);
    if (depth > rows.length - h) {
      headerNote = `headerRows（${depth}）が見出しから下の行数より多いため、${rows.length - h}段にしました`;
      depth = rows.length - h;
    }
    if (info.maybe) headerNote = `見出しが${info.maybe}段かもしれません（縦の結合がないため1段として読みました）。headerRows: ${info.maybe} で指定できます`;
  }
  const columns = h >= 0 ? joinHeader(rows, h, depth, width) : Array.from({ length: width }, (_, i) => `列${i + 1}`);
  const body = rows.slice(h + Math.max(depth, 1)).filter((r) => r.some((v) => v !== ''));

  return {
    columns,
    rows: body,
    meta: { source: 'xlsx', sheet: sheet.name, sheets: sheets.map((s) => s.name), merged, headerRow: h + 1, headerRows: depth, ...(headerNote && { headerNote }), date1904 },
  };
}
