// スクレイピング結果（HTML）から表を取り出す。Node.jsでも動くよう、最小限のHTMLパーサーを持つ。
//
// 候補を作り、取り出せるセルが最も多いものを採用する。
//   table    … <table>（colspan・rowspan、2段の見出し、縦の「項目｜値」の表に対応）
//   repeated … 同じ形の要素の繰り返し（商品カード・検索結果・<dt>日付<dd>見出し のお知らせ一覧など）。1件ずつを1行にする
//   pairs    … ページ全体の <dt>/<dd> や「項目：値」（詳細ページ）。全体を1行にする。他に候補がないときだけ使う

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'noscript', 'svg', 'textarea', 'title']);
const BLOCK = /^(p|div|li|dt|dd|tr|td|th|h[1-6]|section|article|header|footer|nav|aside|main|ul|ol|dl|table|br|hr|blockquote|pre|figure|figcaption|address|form|fieldset|details)$/;
const INLINE = /^(a|b|i|em|strong|span|small|big|font|u|s|label|code|sub|sup|mark|abbr|time|q|cite|bdi|bdo|data|var|kbd|wbr|img)$/;

// 閉じタグを省略できる要素：新しい要素が始まったら、境界（ul・table など）の内側で同じ種類の開いている要素を閉じる
const IMPLIED = {
  li: [/^li$/, /^(ul|ol|menu)$/],
  dt: [/^(dt|dd)$/, /^dl$/],
  dd: [/^(dt|dd)$/, /^dl$/],
  tr: [/^(tr|td|th)$/, /^(table|thead|tbody|tfoot)$/],
  td: [/^(td|th)$/, /^(tr|table)$/],
  th: [/^(td|th)$/, /^(tr|table)$/],
  thead: [/^(thead|tbody|tfoot|tr|td|th)$/, /^table$/],
  tbody: [/^(thead|tbody|tfoot|tr|td|th)$/, /^table$/],
  tfoot: [/^(thead|tbody|tfoot|tr|td|th)$/, /^table$/],
  option: [/^option$/, /^(select|datalist|optgroup)$/],
};
// <p> の中に入れられない要素。始まったら開いている <p> を閉じる
const CLOSES_P = /^(p|div|ul|ol|dl|li|dt|dd|table|h[1-6]|section|article|header|footer|nav|aside|main|form|pre|blockquote|figure|hr|address|fieldset|details)$/;
const MAX_DEPTH = 512; // これより深い入れ子は平らにする（スタックの溢れを防ぐ）

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

// 属性の部分は (?=(…))\3 で後戻りしない（一致しないタグがあっても時間が長さに比例する）。
// 対にならない引用符も1文字として受け入れる（<img alt=Don't> など）
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)(?=((?:[^>"'<]|"[^"<]*"|'[^'<]*'|["'])*))\3>/g;

// HTML文字列 → { tag, attrs, children, parent } の木（テキストは { text }）
export function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null, depth: 0 };
  let cur = root;
  let last = 0;
  let m;
  const re = new RegExp(TOKEN.source, 'g');
  const text = (s) => s && cur.children.push({ text: decodeEntities(s), parent: cur });

  // 境界の内側で、closes に当てはまる最も近い祖先を探す
  const find = (closes, boundary) => {
    for (let n = cur; n !== root; n = n.parent) {
      if (closes.test(n.tag)) return n;
      if (boundary.test(n.tag)) return null;
    }
    return null;
  };

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
      const attrsSrc = m[3];
      if (CLOSES_P.test(tag)) {
        const p = find(/^p$/, /^(?!(?:a|b|i|em|strong|span|small|big|font|u|s|label|code|sub|sup|mark|abbr|time|q|cite)$)/);
        if (p) cur = p.parent;
      }
      if (IMPLIED[tag]) {
        for (let n; (n = find(...IMPLIED[tag])); ) cur = n.parent;
      }
      const el = { tag, attrs: parseAttrs(attrsSrc), children: [], parent: cur, depth: cur.depth + 1 };
      cur.children.push(el);
      // 自分で閉じるタグ：<br/>・<svg … />（属性の値の末尾の / は含めない：href=/a/）
      const selfClosing = /(?:^|\s|["'])\/\s*$/.test(attrsSrc);
      if (RAW.has(tag) && !selfClosing) {
        // script・style などの中身は、閉じタグまで読み飛ばす（title・textarea は文字として残す）
        const end = new RegExp(`</${tag}\\s*>`, 'ig');
        end.lastIndex = last;
        const e = end.exec(html);
        const body = html.slice(last, e ? e.index : html.length);
        if (tag === 'title' || tag === 'textarea') el.children.push({ text: decodeEntities(body), parent: el });
        last = re.lastIndex = e ? end.lastIndex : html.length;
      } else if (!VOID.has(tag) && !selfClosing && el.depth < MAX_DEPTH) {
        cur = el;
      }
    }
  }
  text(html.slice(last));
  return root;
}

const isEl = (n) => n.tag !== undefined;
const elements = (n) => n.children.filter(isEl);

// 子孫の要素を、ページ上の順に（再帰しないので深い入れ子でも溢れない）
function walk(n) {
  const out = [];
  const stack = elements(n).reverse();
  while (stack.length) {
    const e = stack.pop();
    out.push(e);
    const kids = elements(e);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

// 要素の文字列。ブロック要素と <br> は改行にする。画像は alt を使う
export function textContent(n) {
  if (!isEl(n)) return n.text;
  if (RAW.has(n.tag) && n.tag !== 'title' && n.tag !== 'textarea') return '';
  if (n.tag === 'br') return '\n';
  if (n.tag === 'img') return n.attrs.alt ?? '';
  const inner = n.children.map(textContent).join('');
  return BLOCK.test(n.tag) ? `\n${inner}\n` : inner;
}

const tidyText = (s) =>
  s
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();

const cellText = (n) => tidyText(textContent(n));

// 「項目：値」。時刻（10:00〜19:00）・URL・数字だけの項目のコロンは区切りとみなさない
const LABELED = /^([^:：\n]{1,15}?)\s*[:：]\s*(.+)$/s;
function label(text) {
  const m = text.match(LABELED);
  if (!m) return null;
  const key = m[1].trim();
  const value = m[2].trim();
  if (!key || /^\d+$/.test(key) || /\d$/.test(key) || (/https?$/i.test(key) && value.startsWith('//'))) return null;
  return { key, value };
}

// ---- table ----

function tableRows(table) {
  const rows = [];
  const visit = (n, group) => {
    for (const c of elements(n)) {
      if (c.tag === 'tr') rows.push({ tr: c, head: group?.tag === 'thead', group });
      else if (c.tag !== 'table') visit(c, /^(thead|tbody|tfoot)$/.test(c.tag) ? c : group); // 入れ子の表は別の表として扱う
    }
  };
  visit(table, null);
  return rows;
}

// colspan・rowspan を展開した格子にする。rowspan は同じ thead・tbody の中までに限る
function tableGrid(table) {
  const rows = tableRows(table);
  const grid = [];
  const heads = [];
  rows.forEach(({ tr, head, group }, r) => {
    grid[r] ??= [];
    let c = 0;
    const cells = elements(tr).filter((e) => e.tag === 'td' || e.tag === 'th');
    // 見出し行：th があり、残りが空の td（左上の空欄）だけの行
    heads[r] = head || (cells.some((e) => e.tag === 'th') && cells.every((e) => e.tag === 'th' || !cellText(e)));
    let remaining = 0;
    while (r + remaining < rows.length && rows[r + remaining].group === group) remaining++;
    for (const cell of cells) {
      while (grid[r][c] !== undefined) c++;
      const text = cellText(cell);
      const cs = Math.min(Math.max(+cell.attrs.colspan || 1, 1), 100);
      const rs = Math.min(Math.max(+cell.attrs.rowspan || 1, 1), remaining);
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
const nameOf = (e) => e.attrs.itemprop || (e.attrs.class ?? '').trim().split(/\s+/)[0] || '';
const hasNamedDescendant = (e) => walk(e).some((d) => nameOf(d));

// 1件分の要素から項目を取り出す。各項目は { key, value, pos, alt, cta }
//   alt … 「項目：値」の見出しを項目名にした場合の、見出しを使わない読み方（見出しが件ごとに違えば alt に戻す）
//   cta … リンク・ボタンの文字（「詳しく見る」など。全件同じなら列から除く）
function fields(item) {
  const found = [];
  const order = new Map(walk(item).map((e, i) => [e, i]));
  const put = (key, value, el, extra = {}) => {
    if (key && value) found.push({ key, value, pos: order.get(el) ?? -1, ...extra });
  };
  const used = new Set();

  // お知らせ一覧の1件（<dt>日付</dt><dd>見出し</dd>）：dt は値として扱う
  if (item.tag === '#dtdd') {
    const [dt] = item.children;
    put(nameOf(dt) || '見出し', cellText(dt), dt);
    used.add(dt);
  }

  // dt/dd・th/td の組は、見出しの文字を項目名にする
  for (const e of walk(item)) {
    if (used.has(e)) continue;
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

  // 文字の塊を1つの値にする。<br> で区切った「項目：値」の行は、行ごとに分ける
  const value = (text, fallback, el) => {
    const ls = text.split('\n').filter(Boolean);
    const labeled = ls.map(label);
    if (ls.length > 1 && labeled.some(Boolean)) {
      ls.forEach((l, i) => (labeled[i] ? put(labeled[i].key, labeled[i].value, el) : put(fallback, l, el)));
      return;
    }
    const lb = labeled[0];
    const cta = el.tag === 'a' || el.tag === 'button';
    if (lb && ls.length === 1) put(lb.key, lb.value, el, { alt: { key: fallback, value: text }, cta });
    else put(fallback, text, el, { cta });
  };

  // 残りの文字。項目名は class・itemprop、なければタグ名
  const leaves = (n, name, top = false) => {
    if (used.has(n)) return;
    const own = nameOf(n);
    const kids = elements(n).filter((c) => !used.has(c));
    const hasPairs = kids.length !== elements(n).length;
    // 子孫に名前（class）を持つ要素がない、インラインだけの要素（<p>文<b>強調</b><br>次の行</p>）は1つの塊。
    // ただし1件の要素そのもの（top）は、子要素ごとに分ける
    if (!top && !hasPairs && kids.every((c) => INLINE.test(c.tag) || c.tag === 'br') && !kids.some(hasNamedDescendant) && !kids.some((c) => nameOf(c))) {
      const text = cellText(n);
      if (text) value(text, own || name || n.tag, n);
      return;
    }
    // 子要素と、子要素の間に直接書かれた文字（<div>名前：A<br>…<div>…</div></div>）
    let loose = '';
    const flush = () => {
      const text = tidyText(loose);
      if (text) value(text, own || name || n.tag, n);
      loose = '';
    };
    for (const c of n.children) {
      if (!isEl(c)) loose += c.text;
      else if (c.tag === 'br') loose += '\n';
      else if (!top && INLINE.test(c.tag) && !nameOf(c) && !hasNamedDescendant(c)) loose += textContent(c);
      else {
        flush();
        leaves(c, own || name);
      }
    }
    flush();
  };
  if (item.tag === '#dtdd') for (const dd of item.children.slice(1)) leaves(dd, '');
  else leaves({ ...item, attrs: {} }, '', true);
  if (!found.length) put('本文', cellText(item), item);

  const link = item.tag === 'a' ? item : walk(item).find((e) => e.tag === 'a' && e.attrs.href);
  if (link?.attrs.href) found.push({ key: 'リンク', value: link.attrs.href, pos: Infinity });
  return found.sort((a, b) => a.pos - b.pos);
}

// 同じ項目名に番号を付けて Map にする
function toMap(entries) {
  const out = new Map();
  for (const e of entries) {
    let key = e.key;
    for (let n = 2; out.has(key); n++) key = `${e.key}_${n}`;
    out.set(key, e);
  }
  return out;
}

// 繰り返しの候補：同じ形の兄弟要素の組と、<dt>/<dd> の一覧
function groups(root) {
  const out = [];
  for (const parent of [root, ...walk(root)]) {
    if (/^(tr|tbody|thead|tfoot|table|select|head)$/.test(parent.tag)) continue;
    if (parent.tag === 'dl') {
      // dt が日付・番号など（見出しの言葉ではない）か、dd にリンクがあれば、お知らせ一覧として dt＋dd を1件にする
      const kids = elements(parent);
      const items = [];
      kids.forEach((k, i) => {
        if (k.tag !== 'dt') return;
        const dds = [];
        for (let j = i + 1; j < kids.length && kids[j].tag === 'dd'; j++) dds.push(kids[j]);
        if (dds.length) items.push({ tag: '#dtdd', attrs: {}, children: [k, ...dds], parent });
      });
      const listLike = items.filter((it) => /\d/.test(cellText(it.children[0])) || it.children.slice(1).some((d) => walk(d).some((e) => e.tag === 'a'))).length;
      if (items.length >= 3 && listLike >= items.length * 0.7) out.push({ items, tag: 'dt+dd' });
      continue;
    }
    const bySig = new Map();
    for (const c of elements(parent)) {
      const k = signature(c);
      if (!bySig.has(k)) bySig.set(k, []);
      bySig.get(k).push(c);
    }
    for (const [sig, items] of bySig) if (items.length >= 3) out.push({ items, tag: sig.replace(/\.$/, '') });
  }
  // 件数の多い候補から最大50組だけ詳しく調べる（入れ子の繰り返しで時間がかかりすぎないように）
  return out.sort((a, b) => b.items.length - a.items.length).slice(0, 50);
}

function fromRepeated(root) {
  let best = null;
  for (const { items, tag } of groups(root)) {
    const records = items.map(fields);
    // リンク先を除いて2項目以上あること（メニューのリンクの並びなどは除く）
    const avg = records.reduce((n, r) => n + r.filter((e) => e.key !== 'リンク').length, 0) / records.length;
    if (avg < 2) continue;
    const score = items.length * avg;
    if (!best || score > best.score) best = { score, records, tag };
  }
  if (!best) return null;
  const n = best.records.length;

  // 「項目：値」の見出しが2件未満か3割未満の件にしか出てこなければ、見出しとみなさず元の読み方に戻す
  const count = (recs) => {
    const c = new Map();
    for (const r of recs) for (const k of new Set(r.map((e) => e.key))) c.set(k, (c.get(k) ?? 0) + 1);
    return c;
  };
  const labelCounts = count(best.records);
  const records = best.records.map((r) => toMap(r.map((e) => (e.alt && labelCounts.get(e.key) < Math.max(2, n * 0.3) ? { ...e, ...e.alt } : e))));

  // 列：3割以上の件にある項目。全件同じ値のリンク・ボタンの文字（「詳しく見る」）は除く。
  // 並びは、各件の中での平均の位置
  const position = new Map();
  for (const r of records) [...r.keys()].forEach((k, i) => position.set(k, [...(position.get(k) ?? []), i / Math.max(1, r.size - 1)]));
  const avgPos = (k) => position.get(k).reduce((a, b) => a + b, 0) / position.get(k).length;
  const constantCTA = (k) => records.every((r) => r.get(k)?.cta) && new Set(records.map((r) => r.get(k)?.value)).size === 1;
  const columns = [...position.keys()]
    .filter((k) => position.get(k).length >= n * 0.3 && !constantCTA(k))
    .sort((a, b) => (a === 'リンク') - (b === 'リンク') || avgPos(a) - avgPos(b));
  return { columns, rows: records.map((r) => columns.map((c) => r.get(c)?.value ?? '')), how: `繰り返し構造（${best.tag} × ${n}件）` };
}

// 詳細ページ：dt/dd・th/td の組と「項目：値」の行だけを集める（それ以外の文字は拾わない）
function fromPairs(root) {
  const f = new Map();
  for (const e of walk(root)) {
    let pair = null;
    if (e.tag === 'dt') {
      const dd = e.parent.children.slice(e.parent.children.indexOf(e) + 1).find((x) => isEl(x) && (x.tag === 'dd' || x.tag === 'dt'));
      if (dd?.tag === 'dd') pair = { key: cellText(e), value: cellText(dd) };
    } else if (e.tag === 'tr') {
      const cells = elements(e);
      if (cells.length === 2 && cells[0].tag === 'th' && cells[1].tag === 'td') pair = { key: cellText(cells[0]), value: cellText(cells[1]) };
    } else if (/^(p|li|div|span)$/.test(e.tag) && elements(e).every((c) => !BLOCK.test(c.tag))) {
      const text = cellText(e);
      // 同じ文字の子要素があれば、そちらで数える（<div><span>会社名：ABC</span></div> を2回数えない）
      if (!elements(e).some((c) => cellText(c) === text)) pair = label(text);
    }
    if (!pair?.key || !pair.value) continue;
    let key = pair.key;
    for (let n = 2; f.has(key); n++) key = `${pair.key}_${n}`;
    f.set(key, pair.value);
  }
  if (f.size < 3) return null;
  return { columns: [...f.keys()], rows: [[...f.values()]], how: 'ページ全体の項目・値（1件）', fallback: true };
}

export function readHTML(html, options = {}) {
  const root = parseHTML(html);
  const all = walk(root);
  const tables = all.filter((e) => e.tag === 'table');
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
  const title = cellText({ tag: 'x', children: all.filter((e) => e.tag === 'title') }) || undefined;
  if (!best) return { columns: [], rows: [], meta: { source: 'html', tables: tables.length, title, how: '取り出せる構造がありません' } };

  return { columns: best.columns, rows: best.rows, meta: { source: 'html', tables: tables.length, title, how: best.how } };
}

// HTMLらしいか：先頭がタグで、最初の部分にタグが3つ以上あり、閉じタグがある
export function looksLikeHTML(text) {
  const head = text.slice(0, 5000);
  if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|[a-zA-Z][\w-]*)[\s>/]/i.test(head)) return false;
  return (head.match(/<\/?[a-zA-Z][\w-]*[\s>/]/g) ?? []).length >= 3 && /<\/[a-zA-Z]/.test(head);
}
