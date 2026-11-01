// コンテンツHTML用の表示。正規化済みのデータを、検索・並べ替えできる表またはカードとして描画する。
import { escape } from '../report/html.js';

export function format(v, type) {
  if (v === null || v === undefined) return '';
  // 手で直した値は文字列のこともあるので、型どおりのときだけ整形する
  if (type === 'boolean' && typeof v === 'boolean') return v ? '✓' : '✗';
  if (type === 'number' && typeof v === 'number' && Number.isFinite(v)) return v.toLocaleString('ja-JP');
  return String(v);
}

// サーバー側やビルド時にも使える、文字列だけを返す版
export function toTableHTML(result) {
  const { schema, data } = result;
  const head = schema.map((c) => `<th data-type="${escape(c.type)}" tabindex="0">${escape(c.name)}</th>`).join('');
  const body = data
    .map((r) => `<tr>${schema.map((c) => `<td class="t-${escape(c.type)}">${escape(format(r[c.name], c.type))}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table class="tidy-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// カードの見出しにする列：指定がなければ最初のテキスト列
function titleColumn(schema, name) {
  return schema.find((c) => c.name === name) ?? schema.find((c) => c.type === 'text') ?? schema[0];
}

export function toCardsHTML(result, options = {}) {
  const { schema, data } = result;
  if (!schema.length) return '<div class="tidy-cards"></div>';
  const title = titleColumn(schema, options.titleColumn);
  const sub = schema.find((c) => c.type === 'kana' && c !== title);
  const fields = schema.filter((c) => c !== title && c !== sub);
  const cards = data
    .map((r) => {
      const dl = fields
        .filter((c) => r[c.name] !== null && r[c.name] !== undefined)
        .map((c) => `<div><dt>${escape(c.name)}</dt><dd class="t-${escape(c.type)}">${escape(format(r[c.name], c.type))}</dd></div>`)
        .join('');
      return `<article class="tidy-card">${sub && r[sub.name] ? `<small>${escape(r[sub.name])}</small>` : ''}<h3>${escape(format(r[title.name], title.type))}</h3><dl>${dl}</dl></article>`;
    })
    .join('\n');
  return `<div class="tidy-cards">${cards}</div>`;
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
`;

// ブラウザ専用：el に描画する。options.view は 'table'（既定）か 'cards'。
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

  const draw = () => {
    const q = search.value.trim().normalize('NFKC').toLowerCase();
    const visible = q
      ? rows.filter((r) => schema.some((c) => format(r[c.name], c.type).normalize('NFKC').toLowerCase().includes(q)))
      : rows;
    sorter.hidden = view !== 'cards';

    if (view === 'cards') {
      body.className = '';
      body.innerHTML = toCardsHTML({ schema, data: visible }, options);
    } else {
      body.className = 'tidy-scroll';
      body.innerHTML = toTableHTML({ schema, data: visible });
      body.querySelectorAll('th').forEach((th, i) => {
        const key = schema[i].name;
        th.setAttribute('aria-sort', key === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
        const toggle = () => {
          sortBy(key, sortKey === key ? -sortDir : 1);
          draw();
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
    }
    count.textContent = `${visible.length} / ${rows.length} 件`;
  };

  search.addEventListener('input', draw);
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
      draw();
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
