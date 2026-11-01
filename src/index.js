import { read } from './read/index.js';
import { detect } from './detect.js';
import { normalize } from './normalize.js';
import { toReport } from './report/html.js';
import { cluster } from './cluster.js';
import { fix, accept, dismiss, acceptAll, setCanonical } from './fix.js';
import { render, toTableHTML, toCardsHTML } from './view/render.js';
import { renderReview } from './view/review.js';

export { read, detect, normalize, cluster, toReport, render, renderReview, toTableHTML, toCardsHTML };
export { fingerprint } from './cluster.js';
export { rules } from './rules/index.js';

// 読み込み → 列の種類の推論 → 正規化 → 表記ゆれの統一 をまとめて実行する
export async function tidy(input, options = {}) {
  const table = await read(input, options);
  const schema = detect(table, options);
  const { data, changes, issues } = normalize(table, schema, options);
  const result = { data, schema, changes, issues, meta: table.meta };
  result.clusters = cluster(result, options);

  const api = {
    ...result,
    fix: (row, column, value, note) => fix(result, row, column, value, note),
    accept: (row, column) => accept(result, row, column),
    dismiss: (row, column) => dismiss(result, row, column),
    acceptAll: () => acceptAll(result),
    setCanonical: (index, value) => setCanonical(result, index, value),
    toReport: (opts) => toReport(result, opts),
    toTableHTML: () => toTableHTML(result),
    toCardsHTML: (opts) => toCardsHTML(result, opts),
    toJSON: () => data,
    toCSV: () => toCSV(result),
    render: (el, opts) => render(el, result, opts),
    renderReview: (el, opts) => renderReview(el, api, opts),
  };
  return api;
}

function toCSV({ schema, data }) {
  const q = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [schema.map((c) => q(c.name)).join(',')];
  for (const r of data) lines.push(schema.map((c) => q(r[c.name])).join(','));
  return lines.join('\r\n') + '\r\n';
}
