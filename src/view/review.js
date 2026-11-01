// 要確認の項目と表記ゆれを、その場で直す画面（ブラウザ専用）。
import { escape } from '../report/html.js';

export const REVIEW_STYLE = `
.tidy-review { font: 14px/1.5 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; border: 1px solid #8884; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; }
.tidy-review h3 { font-size: 15px; margin: 0; }
.tidy-review h4 { font-size: 13px; margin: 14px 0 6px; opacity: .75; }
.tidy-review .tidy-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tidy-review .tidy-head h3 { margin-right: auto; }
.tidy-review button, .tidy-review input, .tidy-review select { font: inherit; padding: 4px 10px; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; }
.tidy-review button { cursor: pointer; }
.tidy-review button.primary { background: #2b59c3; border-color: #2b59c3; color: #fff; }
.tidy-review ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.tidy-review li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid #8883; }
.tidy-review .where { font-size: 12px; opacity: .7; min-width: 9em; }
.tidy-review .reason { font-size: 12px; opacity: .7; flex-basis: 100%; }
.tidy-review .orig { font-family: ui-monospace, monospace; }
.tidy-review input { flex: 1 1 160px; min-width: 0; }
.tidy-review .done { opacity: .7; }
`;

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function renderReview(el, result, options = {}) {
  const host = typeof el === 'string' ? document.querySelector(el) : el;
  // 呼び直してもイベントが重複しないよう、毎回新しい要素に描画する
  const target = document.createElement('div');
  host.replaceChildren(target);
  const onChange = options.onChange ?? (() => {});

  const draw = () => {
    const issues = result.issues;
    const pending = result.changes.filter((c) => !c.applied && !c.dismissed).length;
    const clusters = result.clusters ?? [];

    const issueItems = issues
      .map(
        (i, k) => `<li data-k="${k}">
  <span class="where">${i.row + 1}行目・${escape(i.column)}</span>
  <span class="orig">${escape(i.value === '' ? '（空）' : i.value)}</span> →
  <input value="${escape(i.suggestion ?? i.value)}" aria-label="${i.row + 1}行目の${escape(i.column)}の修正後の値">
  ${i.suggestion !== undefined ? '<button data-act="accept">提案を適用</button>' : ''}
  <button data-act="fix">この値にする</button>
  <button data-act="dismiss">そのまま</button>
  <span class="reason">${escape(i.reason)}</span>
</li>`,
      )
      .join('');

    // 提案を個別に適用して揃った場合も「統一済み」とみなす
    const unified = (c) => c.applied || c.rows.every((r) => result.data[r][c.column] === c.canonical);
    const clusterItems = clusters
      .map(
        (c, k) => `<li data-c="${k}">
  <span class="where">${escape(c.column)}</span>
  <select aria-label="${escape(c.column)}の統一後の表記">${c.variants
    .map((v) => `<option ${v.value === c.canonical ? 'selected' : ''} value="${escape(v.value)}">${escape(v.value)}（${v.count}件）</option>`)
    .join('')}</select>
  <span class="reason">${c.variants.map((v) => escape(v.value)).join(' / ')} を${unified(c) ? '統一済み' : '統一していません（前株・後株などの違い）'}</span>
  ${unified(c) ? '' : '<button data-act="merge">この表記に統一</button>'}
</li>`,
      )
      .join('');

    target.innerHTML = `<style>${REVIEW_STYLE}</style><section class="tidy-review">
  <div class="tidy-head">
    <h3>要確認 ${issues.length}件</h3>
    ${pending ? `<button class="primary" data-act="accept-all">提案をすべて適用（${pending}件）</button>` : ''}
    <button data-act="csv">CSVで保存</button>
    <button data-act="json">JSONで保存</button>
  </div>
  ${issues.length ? `<ul>${issueItems}</ul>` : '<p class="done">要確認の項目はありません。</p>'}
  ${clusters.length ? `<h4>表記ゆれ ${clusters.length}組</h4><ul>${clusterItems}</ul>` : ''}
</section>`;
  };

  target.addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    const li = e.target.closest('li');
    if (act === 'csv') return download('tidy.csv', '﻿' + result.toCSV(), 'text/csv');
    if (act === 'json') return download('tidy.json', JSON.stringify(result.data, null, 2), 'application/json');
    if (act === 'accept-all') result.acceptAll();
    else if (li?.dataset.k !== undefined) {
      const issue = result.issues[+li.dataset.k];
      if (act === 'accept') result.accept(issue.row, issue.column);
      if (act === 'fix') result.fix(issue.row, issue.column, li.querySelector('input').value);
      if (act === 'dismiss') result.dismiss(issue.row, issue.column);
    } else if (li?.dataset.c !== undefined && act === 'merge') {
      result.setCanonical(+li.dataset.c, li.querySelector('select').value);
    }
    draw();
    onChange(result);
  });

  // 統一済みのまとまりは、選択を変えたらすぐ揃え直す
  target.addEventListener('change', (e) => {
    const li = e.target.closest('li[data-c]');
    if (!li || e.target.tagName !== 'SELECT' || !result.clusters[+li.dataset.c].applied) return;
    result.setCanonical(+li.dataset.c, e.target.value);
    draw();
    onChange(result);
  });

  draw();
  return { refresh: draw };
}
