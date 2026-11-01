// コンテンツHTML用の表示。正規化済みのデータを、検索・並べ替えできる表として描画する。
import { escape } from '../report/html.js';

function format(v, type) {
  if (v === null || v === undefined) return '';
  if (type === 'boolean') return v ? '✓' : '—';
  if (type === 'number') return Number(v).toLocaleString('ja-JP');
  return String(v);
}

// サーバー側やビルド時にも使える、文字列だけを返す版
export function toTableHTML(result) {
  const { schema, data } = result;
  const head = schema.map((c) => `<th data-type="${c.type}">${escape(c.name)}</th>`).join('');
  const body = data
    .map((r) => `<tr>${schema.map((c) => `<td class="t-${c.type}">${escape(format(r[c.name], c.type))}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table class="tidy-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const STYLE = `
.tidy-view { font: 14px/1.5 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; }
.tidy-view input { font: inherit; padding: 6px 10px; width: 100%; max-width: 320px; margin-bottom: 8px; border: 1px solid #ccc8; border-radius: 6px; background: transparent; color: inherit; }
.tidy-view .tidy-scroll { overflow-x: auto; }
.tidy-table { border-collapse: collapse; width: 100%; }
.tidy-table th, .tidy-table td { padding: 6px 10px; border-bottom: 1px solid #8884; text-align: left; white-space: nowrap; }
.tidy-table th { cursor: pointer; user-select: none; }
.tidy-table th[aria-sort="ascending"]::after { content: " ▲"; }
.tidy-table th[aria-sort="descending"]::after { content: " ▼"; }
.tidy-table td.t-number { text-align: right; font-variant-numeric: tabular-nums; }
.tidy-view .tidy-count { font-size: 12px; opacity: .7; margin-top: 6px; }
`;

// ブラウザ専用：el に表を描画する
export function render(el, result, options = {}) {
  const target = typeof el === 'string' ? document.querySelector(el) : el;
  const { schema } = result;
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
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = options.placeholder ?? '検索';
  const scroll = document.createElement('div');
  scroll.className = 'tidy-scroll';
  const count = document.createElement('div');
  count.className = 'tidy-count';
  root.append(search, scroll, count);
  target.append(root);

  const draw = () => {
    const q = search.value.trim().normalize('NFKC').toLowerCase();
    const visible = q
      ? rows.filter((r) => schema.some((c) => format(r[c.name], c.type).normalize('NFKC').toLowerCase().includes(q)))
      : rows;
    scroll.innerHTML = toTableHTML({ schema, data: visible });
    scroll.querySelectorAll('th').forEach((th, i) => {
      const key = schema[i].name;
      if (key === sortKey) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
      th.addEventListener('click', () => {
        sortDir = sortKey === key ? -sortDir : 1;
        sortKey = key;
        rows = rows.slice().sort((a, b) => compare(a[key], b[key]) * sortDir);
        draw();
      });
    });
    count.textContent = `${visible.length} / ${rows.length} 件`;
  };

  search.addEventListener('input', draw);
  draw();
  return { refresh: draw };
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ja');
}
