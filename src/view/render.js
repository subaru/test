// コンテンツHTML用の表示。正規化済みのデータを、検索・並べ替えできる表またはカードとして描画する。
import { escape } from '../report/html.js';

export function format(v, type) {
  if (v === null || v === undefined) return '';
  // 手で直した値は文字列のこともあるので、型どおりのときだけ整形する
  if (type === 'boolean' && typeof v === 'boolean') return v ? '✓' : '✗';
  if (type === 'number' && typeof v === 'number' && Number.isFinite(v)) return v.toLocaleString('ja-JP');
  return String(v);
}

const headHTML = (schema) => `<tr aria-rowindex="1">${schema.map((c) => `<th data-type="${escape(c.type)}" tabindex="0">${escape(c.name)}</th>`).join('')}</tr>`;

// 1行分の HTML。i は表示している行の中での番号（読み上げ用の行番号に使う）
function rowHTML(schema, r, i, withTitle = false) {
  const cells = schema.map((c) => {
    const text = escape(format(r[c.name], c.type));
    return `<td class="t-${escape(c.type)}"${withTitle && text.length > 20 ? ` title="${text}"` : ''}>${text}</td>`;
  });
  return `<tr aria-rowindex="${i + 2}">${cells.join('')}</tr>`;
}

// サーバー側やビルド時にも使える、文字列だけを返す版（全行を出力する）
export function toTableHTML(result) {
  const { schema, data } = result;
  const body = data.map((r, i) => rowHTML(schema, r, i)).join('\n');
  return `<table class="tidy-table"><thead>${headHTML(schema)}</thead><tbody>${body}</tbody></table>`;
}

// カードの見出しにする列：指定がなければ最初のテキスト列
function titleColumn(schema, name) {
  return schema.find((c) => c.name === name) ?? schema.find((c) => c.type === 'text') ?? schema[0];
}

export function toCardsHTML(result, options = {}) {
  return `<div class="tidy-cards">${cardsHTML(result, options)}</div>`;
}

// カードの並び（外側の div なし）。少しずつ足していく表示で使う
function cardsHTML(result, options = {}) {
  const { schema, data } = result;
  if (!schema.length) return '';
  const title = titleColumn(schema, options.titleColumn);
  const sub = schema.find((c) => c.type === 'kana' && c !== title);
  const fields = schema.filter((c) => c !== title && c !== sub);
  return data
    .map((r) => {
      const dl = fields
        .filter((c) => r[c.name] !== null && r[c.name] !== undefined)
        .map((c) => `<div><dt>${escape(c.name)}</dt><dd class="t-${escape(c.type)}">${escape(format(r[c.name], c.type))}</dd></div>`)
        .join('');
      return `<article class="tidy-card">${sub && r[sub.name] ? `<small>${escape(r[sub.name])}</small>` : ''}<h3>${escape(format(r[title.name], title.type))}</h3><dl>${dl}</dl></article>`;
    })
    .join('\n');
}

// 表示上の幅（全角は2、半角は1）
const displayWidth = (s) => {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return w;
};

// 仮想スクロールでは、見えている行が変わっても列の幅が動かないよう、先に幅を決めておく。
// 見出しと先頭の行（最大500行）の文字数から、全角1文字＝1em として見積もる
function columnWidths(schema, rows) {
  const sample = rows.slice(0, 500);
  return schema.map((c) => {
    let w = displayWidth(c.name) + 2; // 並べ替えの印の分
    for (const r of sample) w = Math.max(w, displayWidth(format(r[c.name], c.type)));
    return Math.min(28, Math.max(4, w * 0.55 + 1.6));
  });
}

export const STYLE = `
.tidy-view { font: 14px/1.5 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; }
.tidy-view .tidy-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.tidy-view input, .tidy-view select { font: inherit; padding: 6px 10px; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; }
.tidy-view input { flex: 1 1 200px; max-width: 320px; }
.tidy-view .tidy-scroll { overflow-x: auto; }
.tidy-table { border-collapse: collapse; width: 100%; }
.tidy-table th, .tidy-table td { padding: 6px 10px; border-bottom: 1px solid #8884; text-align: left; white-space: nowrap; }
.tidy-table th { cursor: pointer; user-select: none; }
.tidy-table th[aria-sort="ascending"]::after { content: " ▲"; }
.tidy-table th[aria-sort="descending"]::after { content: " ▼"; }
.tidy-view .t-number { text-align: right; font-variant-numeric: tabular-nums; }
.tidy-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.tidy-card { border: 1px solid #8884; border-radius: 8px; padding: 12px 14px; }
.tidy-card small { opacity: .65; font-size: 12px; }
.tidy-card h3 { margin: 0 0 8px; font-size: 16px; overflow-wrap: anywhere; }
.tidy-card dl { margin: 0; display: grid; gap: 2px; font-size: 13px; }
.tidy-card dl div { display: flex; justify-content: space-between; gap: 12px; }
.tidy-card dt { opacity: .65; white-space: nowrap; }
.tidy-card dd { margin: 0; overflow-wrap: anywhere; }
.tidy-view .tidy-count { font-size: 12px; opacity: .7; margin-top: 6px; }
.tidy-view .tidy-virtual { overflow: auto; border: 1px solid #8884; border-radius: 6px; }
.tidy-view .tidy-virtual .tidy-table { table-layout: fixed; width: max-content; min-width: 100%; }
.tidy-view .tidy-virtual td { overflow: hidden; text-overflow: ellipsis; }
.tidy-view .tidy-virtual thead th { position: sticky; top: 0; z-index: 1; background: Canvas; }
.tidy-view .tidy-spacer td { padding: 0; border: 0; }
.tidy-view .tidy-more { display: block; margin: 12px auto 0; font: inherit; padding: 6px 16px; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
`;

// ブラウザ専用：el に描画する。
//   view    … 'table'（既定）か 'cards'
//   virtual … 表の仮想スクロール。'auto'（既定：threshold 行を超えたら）・true・false
//             見えている行と前後の数十行だけを描くので、数万行でも軽い
//   height  … 仮想スクロールの表の高さ（px、既定 480）
//   threshold … 'auto' のとき仮想スクロールにする行数（既定 500）
//   batch   … カード表示で一度に描く枚数（既定 200。下までスクロールすると次を足す）
const OVERSCAN = 20;

export function render(el, result, options = {}) {
  const target = typeof el === 'string' ? document.querySelector(el) : el;
  if (!target) throw new Error(`表示先の要素が見つかりません：${el}`);
  const { schema } = result;
  let view = options.view ?? 'table';
  let rows = result.data.slice();
  let sortKey = null;
  let sortDir = 1;

  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'tidy-view';
  if (options.style !== false) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.append(style);
  }
  const bar = document.createElement('div');
  bar.className = 'tidy-bar';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = options.placeholder ?? '検索';
  search.setAttribute('aria-label', '検索');
  // カード表示では見出しをクリックできないので、並べ替えは選択肢で行う
  const sorter = document.createElement('select');
  sorter.setAttribute('aria-label', '並べ替え');
  sorter.innerHTML =
    '<option value="">並べ替えなし</option>' +
    // 列名に「|」などが含まれても壊れないよう、値は列の番号にする
    schema.flatMap((c, i) => [`<option value="${i}|1">${escape(c.name)} ▲</option>`, `<option value="${i}|-1">${escape(c.name)} ▼</option>`]).join('');
  bar.append(search, sorter);
  const body = document.createElement('div');
  const count = document.createElement('div');
  count.className = 'tidy-count';
  root.append(bar, body, count);
  target.append(root);

  const sortBy = (key, dir) => {
    sortKey = key;
    sortDir = dir;
    rows = key ? result.data.slice().sort((a, b) => compare(a[key], b[key]) * dir) : result.data.slice();
    const i = schema.findIndex((c) => c.name === key);
    sorter.value = key ? `${i}|${dir}` : '';
  };

  // 見出しのクリック・Enter・Space で並べ替える
  const wireHeader = () => {
    body.querySelectorAll('th').forEach((th, i) => {
      const key = schema[i].name;
      th.setAttribute('aria-sort', key === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
      const toggle = () => {
        sortBy(key, sortKey === key ? -sortDir : 1);
        draw(); // 並べ替えたら先頭から
        body.querySelectorAll('th')[i]?.focus();
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  };

  let observer = null;
  const cleanup = () => {
    body.onscroll = null;
    body.style.maxHeight = '';
    observer?.disconnect();
    observer = null;
  };

  // 仮想スクロールの表：見えている範囲の行だけを描き、上下は高さだけの行で埋める
  const drawVirtual = (visible, scrollTop) => {
    const height = options.height ?? 480;
    const widths = columnWidths(schema, visible);
    const colgroup = `<colgroup>${widths.map((w) => `<col style="width:${w.toFixed(1)}em">`).join('')}</colgroup>`;
    body.className = 'tidy-scroll tidy-virtual';
    body.style.maxHeight = `${height}px`;
    body.innerHTML = `<table class="tidy-table" aria-rowcount="${visible.length + 1}">${colgroup}<thead>${headHTML(schema)}</thead><tbody></tbody></table>`;
    wireHeader();
    const tbody = body.querySelector('tbody');
    const spacer = (h) => (h > 0 ? `<tr class="tidy-spacer" aria-hidden="true"><td colspan="${schema.length}" style="height:${h}px"></td></tr>` : '');
    let rowH = 33;
    let range = [-1, -1];
    const paint = () => {
      const top = body.scrollTop;
      const view = body.clientHeight || height;
      const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
      const last = Math.min(visible.length, Math.ceil((top + view) / rowH) + OVERSCAN);
      if (first === range[0] && last === range[1]) return;
      range = [first, last];
      let html = spacer(first * rowH);
      for (let i = first; i < last; i++) html += rowHTML(schema, visible[i], i, true);
      tbody.innerHTML = html + spacer((visible.length - last) * rowH);
      // 実際の行の高さを測り、見積もりと違えば描き直す（フォントや余白の違いに合わせる）
      const tr = tbody.querySelector('tr[aria-rowindex]');
      if (tr && tr.offsetHeight && Math.abs(tr.offsetHeight - rowH) > 0.5) {
        rowH = tr.offsetHeight;
        range = [-1, -1];
        paint();
      }
    };
    let pending = false;
    body.onscroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        paint();
      });
    };
    paint();
    body.scrollTop = scrollTop;
    paint();
  };

  // カード：batch 枚ずつ描き、下まで見えたら次を足す
  const drawCards = (visible) => {
    const batch = options.batch ?? 200;
    let shown = Math.min(batch, visible.length);
    body.className = '';
    body.innerHTML = `<div class="tidy-cards">${cardsHTML({ schema, data: visible.slice(0, shown) }, options)}</div>`;
    if (shown >= visible.length) return;
    const grid = body.firstElementChild;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tidy-more';
    const label = () => (more.textContent = `さらに表示（残り ${visible.length - shown} 件）`);
    label();
    const next = () => {
      const upto = Math.min(shown + batch, visible.length);
      grid.insertAdjacentHTML('beforeend', cardsHTML({ schema, data: visible.slice(shown, upto) }, options));
      shown = upto;
      if (shown >= visible.length) {
        more.remove();
        observer?.disconnect();
      } else label();
    };
    more.addEventListener('click', next);
    body.append(more);
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && next(), { rootMargin: '400px' });
      observer.observe(more);
    }
  };

  const draw = ({ keepScroll = false } = {}) => {
    const q = search.value.trim().normalize('NFKC').toLowerCase();
    const visible = q
      ? rows.filter((r) => schema.some((c) => format(r[c.name], c.type).normalize('NFKC').toLowerCase().includes(q)))
      : rows;
    sorter.hidden = view !== 'cards';
    // 描き直す前の位置（cleanup で高さの制限を外すと位置が 0 に戻るので、先に覚えておく）
    const scrollTop = keepScroll ? body.scrollTop : 0;
    cleanup();

    const mode = options.virtual ?? 'auto';
    const virtual = mode === true || (mode === 'auto' && visible.length > (options.threshold ?? 500));
    if (view === 'cards') {
      drawCards(visible);
    } else if (virtual) {
      drawVirtual(visible, scrollTop);
    } else {
      body.className = 'tidy-scroll';
      body.innerHTML = toTableHTML({ schema, data: visible });
      wireHeader();
    }
    count.textContent = `${visible.length} / ${rows.length} 件`;
  };

  // 行数が多いときは、入力が止まってから検索する
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    if (rows.length > 5000) timer = setTimeout(() => draw(), 200);
    else draw();
  });
  sorter.addEventListener('change', () => {
    const [i, dir] = sorter.value.split('|');
    sortBy(i === '' ? null : schema[+i].name, Number(dir) || 1);
    draw();
  });
  draw();

  return {
    // 値が直されたら、並べ替えをやり直してから描き直す
    refresh() {
      sortBy(sortKey, sortDir);
      draw({ keepScroll: true });
    },
    setView(v) {
      view = v;
      draw();
    },
  };
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ja');
}
