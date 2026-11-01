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
  if (!host) throw new Error(`表示先の要素が見つかりません：${el}`);
  // 呼び直してもイベントが重複しないよう、毎回新しい要素に描画する
  const target = document.createElement('div');
  host.replaceChildren(target);
  const onChange = options.onChange ?? (() => {});
  // 入力途中の値（描き直しても消えないように、行と列で覚えておく）
  const drafts = new Map();
  const cellKey = (row, column) => `${row}\t${column}`;

  const draw = () => {
    const issues = result.issues;
    const pending = result.changes.filter((c) => !c.applied && !c.dismissed).length;
    const clusters = result.clusters ?? [];

    // ボタンは配列の番号ではなく「行と列」で対象を指す（他から修正されて配列がずれても取り違えない）
    const issueItems = issues
      .map((i) => {
        const where = `${i.row + 1}行目の${escape(i.column)}`;
        const draft = drafts.get(cellKey(i.row, i.column)) ?? i.suggestion ?? i.value;
        return `<li data-row="${i.row}" data-col="${escape(i.column)}">
  <span class="where">${i.row + 1}行目・${escape(i.column)}</span>
  <span class="orig">${escape(i.value === '' ? '（空）' : i.value)}</span> →
  <input value="${escape(draft)}" aria-label="${where}の修正後の値">
  ${i.suggestion !== undefined ? `<button data-act="accept" aria-label="${where}：提案を適用">提案を適用</button>` : ''}
  <button data-act="fix" aria-label="${where}：入力した値にする">この値にする</button>
  <button data-act="dismiss" aria-label="${where}：今の値のままにする">そのまま</button>
  <span class="reason">${escape(i.reason)}</span>
</li>`;
      })
      .join('');

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
    <h3 aria-live="polite">要確認 ${issues.length}件</h3>
    ${pending ? `<button class="primary" data-act="accept-all">提案をすべて適用（${pending}件）</button>` : ''}
    <button data-act="csv">CSVで保存</button>
    <button data-act="json">JSONで保存</button>
  </div>
  ${issues.length ? `<ul class="tidy-issues">${issueItems}</ul>` : '<p class="done">要確認の項目はありません。</p>'}
  ${clusters.length ? `<h4>表記ゆれ ${clusters.length}組</h4><ul>${clusterItems}</ul>` : ''}
</section>`;
  };

  // 操作した項目と同じ位置にある次の項目へフォーカスを移す（キーボード操作で迷子にならないように）
  const restoreFocus = (position) => {
    const items = target.querySelectorAll('.tidy-issues > li');
    const next = items[Math.min(position, items.length - 1)];
    (next?.querySelector('button') ?? target.querySelector('button'))?.focus();
  };

  const commit = (position) => {
    draw();
    if (position !== undefined) restoreFocus(position);
    onChange(result);
  };

  target.addEventListener('input', (e) => {
    const li = e.target.closest('li[data-row]');
    if (li) drafts.set(cellKey(+li.dataset.row, li.dataset.col), e.target.value);
  });

  target.addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    const li = e.target.closest('li');
    if (act === 'csv') return download('tidy.csv', result.toCSV({ bom: true }), 'text/csv');
    if (act === 'json') return download('tidy.json', JSON.stringify(result.data, null, 2), 'application/json');
    if (act === 'accept-all') {
      result.acceptAll();
      return commit(0);
    }
    if (li?.dataset.row !== undefined) {
      const row = +li.dataset.row;
      const column = li.dataset.col;
      const position = [...li.parentElement.children].indexOf(li);
      if (act === 'accept') result.accept(row, column);
      if (act === 'fix') result.fix(row, column, li.querySelector('input').value);
      if (act === 'dismiss') result.dismiss(row, column);
      drafts.delete(cellKey(row, column));
      return commit(position);
    }
    if (li?.dataset.c !== undefined && act === 'merge') {
      result.setCanonical(+li.dataset.c, li.querySelector('select').value);
      commit();
    }
  });

  // 統一済みのまとまりは、選択を変えたらすぐ揃え直す
  target.addEventListener('change', (e) => {
    const li = e.target.closest('li[data-c]');
    if (!li || e.target.tagName !== 'SELECT' || !result.clusters[+li.dataset.c].applied) return;
    result.setCanonical(+li.dataset.c, e.target.value);
    commit();
  });

  draw();
  return { refresh: draw };
}
