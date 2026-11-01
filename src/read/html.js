// スクレイピング結果（HTML）から表を取り出す。Node.jsでも動くよう、最小限のHTMLパーサーを持つ。
//
// 候補を3つ作り、取り出せるセルが最も多いものを採用する。
//   table    … <table>（colspan・rowspan、2段の見出し、縦の「項目｜値」の表に対応）
//   repeated … 同じ形の要素の繰り返し（商品カード・検索結果など）。1件ずつを1行にする
//   pairs    … ページ全体の <dt>/<dd> や「項目：値」（詳細ページ）。全体を1行にする

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'noscript', 'svg']);
// 閉じタグが省略できる要素：新しい要素が始まったら閉じる
const AUTO_CLOSE = {
  p: /^(p|div|ul|ol|dl|table|h[1-6]|section|article|header|footer|form|pre|blockquote)$/,
  li: /^li$/,
  dt: /^(dt|dd)$/,
  dd: /^(dt|dd)$/,
  tr: /^(tr|tbody|thead|tfoot)$/,
  td: /^(td|th|tr|tbody|thead|tfoot)$/,
  th: /^(td|th|tr|tbody|thead|tfoot)$/,
  option: /^(option|optgroup)$/,
  thead: /^(tbody|tfoot)$/,
  tbody: /^(tbody|tfoot)$/,
};
const BLOCK = /^(p|div|li|dt|dd|tr|td|th|h[1-6]|section|article|header|footer|ul|ol|dl|table|br|hr|blockquote|pre|figcaption|address)$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥', copy: '©', reg: '®', times: '×', minus: '−', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

// HTML文字列 → { tag, attrs, children, parent } の木（テキストは { text }）
export function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m;
  const text = (s) => s && cur.children.push({ text: decodeEntities(s), parent: cur });

  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      // 対応する開きタグまで閉じる（なければ無視）
      for (let n = cur; n !== root; n = n.parent) {
        if (n.tag === tag) {
          cur = n.parent;
          break;
        }
      }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      while (cur !== root && AUTO_CLOSE[cur.tag]?.test(tag)) cur = cur.parent;
      const el = { tag, attrs: parseAttrs(m[3]), children: [], parent: cur };
      cur.children.push(el);
      if (RAW.has(tag)) {
        // script・style の中身は読み飛ばす
        const end = html.toLowerCase().indexOf(`</${tag}`, last);
        last = re.lastIndex = end < 0 ? html.length : html.indexOf('>', end) + 1 || html.length;
      } else if (!VOID.has(tag) && !m[3].trimEnd().endsWith('/')) {
        cur = el;
      }
    }
  }
  text(html.slice(last));
  return root;
}

const isEl = (n) => n.tag !== undefined;
const elements = (n) => n.children.filter(isEl);

function* walk(n) {
  for (const c of n.children ?? []) {
    if (!isEl(c)) continue;
    yield c;
    yield* walk(c);
  }
}

// 要素の文字列。ブロック要素と <br> は改行にする
export function textContent(n) {
  if (!isEl(n)) return n.text;
  if (RAW.has(n.tag)) return '';
  if (n.tag === 'br') return '\n';
  const inner = n.children.map(textContent).join('');
  return BLOCK.test(n.tag) ? `\n${inner}\n` : inner;
}

const tidyText = (s) =>
  s
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();

const cellText = (n) => tidyText(textContent(n));

// ---- table ----

function tableRows(table) {
  const rows = [];
  const visit = (n) => {
    for (const c of elements(n)) {
      if (c.tag === 'tr') rows.push({ tr: c, head: n.tag === 'thead' });
      else if (c.tag !== 'table') visit(c); // 入れ子の表は別の表として扱う
    }
  };
  visit(table);
  return rows;
}

// colspan・rowspan を展開した格子にする
function tableGrid(table) {
  const grid = [];
  const heads = [];
  tableRows(table).forEach(({ tr, head }, r) => {
    grid[r] ??= [];
    let c = 0;
    const cells = elements(tr).filter((e) => e.tag === 'td' || e.tag === 'th');
    heads[r] = head || (cells.length > 0 && cells.every((e) => e.tag === 'th'));
    for (const cell of cells) {
      while (grid[r][c] !== undefined) c++;
      const text = cellText(cell);
      const cs = Math.min(Math.max(+cell.attrs.colspan || 1, 1), 100);
      const rs = Math.min(Math.max(+cell.attrs.rowspan || 1, 1), 1000);
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) (grid[r + i] ??= [])[c + j] = { text, th: cell.tag === 'th' };
      c += cs;
    }
  });
  const width = Math.max(0, ...grid.map((r) => r.length));
  return { grid: grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? { text: '', th: false })), heads };
}

function fromTable(table) {
  const { grid, heads } = tableGrid(table);
  if (!grid.length) return null;

  // 縦の「項目｜値」の表（各行が th と td の2セル）は、全体で1件
  if (grid.length >= 2 && grid[0].length === 2 && grid.every((r) => r[0].th && !r[1].th)) {
    return { columns: grid.map((r) => r[0].text), rows: [grid.map((r) => r[1].text)], how: '縦の項目・値の表' };
  }

  // 先頭から続く見出し行（2段なら「連絡先・電話」のようにつなぐ）
  let h = 0;
  while (h < grid.length - 1 && heads[h]) h++;
  if (h === 0) h = 1; // 見出しの印がなければ1行目を見出しとする
  const columns = grid[0].map((_, c) => {
    const parts = [];
    for (let r = 0; r < h; r++) if (grid[r][c].text && parts.at(-1) !== grid[r][c].text) parts.push(grid[r][c].text);
    return parts.join('・');
  });
  return { columns, rows: grid.slice(h).map((r) => r.map((x) => x.text)), how: h > 1 ? `表（見出し${h}段）` : '表' };
}

// ---- 繰り返し構造 ----

const signature = (e) => `${e.tag}.${(e.attrs.class ?? '').trim().split(/\s+/).sort().join('.')}`;
const LABELED = /^([^:：\n]{1,15})\s*[:：]\s*(.+)$/s;

// 1件分の要素から「項目名 → 値」を取り出す
function fields(item) {
  const found = [];
  const order = new Map([...walk(item)].map((e, i) => [e, i]));
  const put = (k, v, el) => {
    if (k && v) found.push({ k, v, pos: order.get(el) ?? -1 });
  };
  const used = new Set();

  // dt/dd・th/td の組は、見出しの文字を項目名にする
  for (const e of walk(item)) {
    if (e.tag === 'dt') {
      const dd = e.parent.children.slice(e.parent.children.indexOf(e) + 1).find((x) => isEl(x) && (x.tag === 'dd' || x.tag === 'dt'));
      if (dd?.tag === 'dd') {
        put(cellText(e), cellText(dd), e);
        used.add(e).add(dd);
      }
    } else if (e.tag === 'tr') {
      const cells = elements(e);
      if (cells.length === 2 && cells[0].tag === 'th' && cells[1].tag === 'td') {
        put(cellText(cells[0]), cellText(cells[1]), e);
        used.add(cells[0]).add(cells[1]);
      }
    }
  }

  // 残りの文字を持つ末端の要素。項目名は class・itemprop、なければタグ名
  const leaves = (n, name) => {
    if (used.has(n)) return;
    const own = n.attrs.itemprop || (n.attrs.class ?? '').trim().split(/\s+/)[0] || '';
    const kids = elements(n).filter((c) => !used.has(c));
    const hasPairs = kids.length !== elements(n).length;
    // ブロック要素を含まない要素（<p>テキスト<b>強調</b></p> など）は1つの値として扱う
    if (!hasPairs && kids.every((c) => !BLOCK.test(c.tag))) {
      const text = cellText(n);
      if (!text) return;
      const label = text.match(LABELED);
      if (label && !/^https?$/i.test(label[1])) put(label[1].trim(), label[2].trim(), n);
      else put(own || name || n.tag, text, n);
      return;
    }
    for (const c of kids) leaves(c, own || name);
  };
  for (const c of elements(item)) leaves(c, '');
  if (!found.length) put('本文', cellText(item), item);

  // ページ上の順に並べ、同じ項目名には番号を付ける
  const out = new Map();
  for (const { k, v } of found.sort((a, b) => a.pos - b.pos)) {
    let key = k;
    for (let n = 2; out.has(key); n++) key = `${k}_${n}`;
    out.set(key, v);
  }
  const link = item.tag === 'a' ? item : [...walk(item)].find((e) => e.tag === 'a' && e.attrs.href);
  if (link?.attrs.href && !out.has('リンク')) out.set('リンク', link.attrs.href);
  return out;
}

function fromRepeated(root) {
  let best = null;
  for (const parent of walk(root)) {
    if (/^(tr|tbody|thead|table|select|head)$/.test(parent.tag)) continue;
    const groups = new Map();
    for (const c of elements(parent)) {
      const k = signature(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const items of groups.values()) {
      if (items.length < 3) continue;
      const records = items.map(fields);
      const avg = records.reduce((n, r) => n + r.size, 0) / records.length;
      if (avg < 2) continue; // 1項目だけの繰り返し（メニューのリンクなど）は除く
      const score = items.length * avg;
      if (!best || score > best.score) best = { score, records, tag: signature(items[0]) };
    }
  }
  if (!best) return null;

  // 3割以上の件数にある項目だけを列にする
  const counts = new Map();
  for (const r of best.records) for (const k of r.keys()) counts.set(k, (counts.get(k) ?? 0) + 1);
  // 全件で同じ値の列（「詳しく見る」などの定型文）は除く
  const constant = (k) => new Set(best.records.map((r) => r.get(k))).size === 1;
  const columns = [...counts].filter(([k, n]) => n >= best.records.length * 0.3 && !constant(k)).map(([k]) => k);
  return { columns, rows: best.records.map((r) => columns.map((c) => r.get(c) ?? '')), how: `繰り返し構造（${best.tag.replace(/\.$/, '')} × ${best.records.length}件）` };
}

// 詳細ページ：dt/dd・th/td の組と「項目：値」の行だけを集める（それ以外の文字は拾わない）
function fromPairs(root) {
  const f = new Map();
  for (const e of walk(root)) {
    let k;
    let v;
    if (e.tag === 'dt') {
      const dd = e.parent.children.slice(e.parent.children.indexOf(e) + 1).find((x) => isEl(x) && (x.tag === 'dd' || x.tag === 'dt'));
      if (dd?.tag === 'dd') [k, v] = [cellText(e), cellText(dd)];
    } else if (e.tag === 'tr') {
      const cells = elements(e);
      if (cells.length === 2 && cells[0].tag === 'th' && cells[1].tag === 'td') [k, v] = [cellText(cells[0]), cellText(cells[1])];
    } else if (/^(p|li|div|span)$/.test(e.tag) && elements(e).every((c) => !BLOCK.test(c.tag))) {
      const m = cellText(e).match(LABELED);
      if (m && !/^https?$/i.test(m[1])) [k, v] = [m[1].trim(), m[2].trim()];
    }
    if (!k || !v) continue;
    let key = k;
    for (let n = 2; f.has(key); n++) key = `${k}_${n}`;
    f.set(key, v);
  }
  if (f.size < 3) return null;
  return { columns: [...f.keys()], rows: [[...f.values()]], how: 'ページ全体の項目・値（1件）', fallback: true };
}

export function readHTML(html, options = {}) {
  const root = parseHTML(html);
  const tables = [...walk(root)].filter((e) => e.tag === 'table');
  const candidates = [];

  if (options.table !== undefined) {
    const t = tables[options.table];
    if (!t) throw new Error(`表が見つかりません：${options.table}（全${tables.length}個）`);
    candidates.push(fromTable(t));
  } else {
    for (const t of tables) candidates.push(fromTable(t));
    candidates.push(fromRepeated(root), fromPairs(root));
  }

  const cells = (c) => c.rows.reduce((n, r) => n + r.filter(Boolean).length, 0);
  const usable = candidates.filter((c) => c && c.columns.length && c.rows.length);
  // セルの数が最も多いもの。同じなら表を優先する（候補の順）。ページ全体の1件は、他に候補がないときだけ
  const pick = (list) => list.reduce((a, b) => (!a || cells(b) > cells(a) ? b : a), null);
  const best = pick(usable.filter((c) => !c.fallback)) ?? pick(usable);
  if (!best) return { columns: [], rows: [], meta: { source: 'html', tables: tables.length, how: '取り出せる構造がありません' } };

  return {
    columns: best.columns,
    rows: best.rows,
    meta: { source: 'html', tables: tables.length, how: best.how, title: cellText({ tag: 'x', children: [...walk(root)].filter((e) => e.tag === 'title') }) || undefined },
  };
}
