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
  issues.unshift(...table.warnings);
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
    toCSV: (opts) => toCSV(result, opts),
    render: (el, opts) => render(el, result, opts),
    renderReview: (el, opts) => renderReview(el, api, opts),
  };
  return api;
}

// CSVに書き出す。
//   bom: true    … Excelで文字化けしないよう先頭にBOMを付ける
//   safe: false  … 数式インジェクション対策（= + - @ などで始まる文字列の先頭に ' を付ける）を外す
export function toCSV({ schema, data }, options = {}) {
  const safe = options.safe ?? true;
  const q = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // 数値そのもの（-500 など）は対象外。文字列として = + - @ タブ・改行で始まるものだけ
    if (safe && typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d,]*(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [schema.map((c) => q(c.name)).join(',')];
  for (const r of data) lines.push(schema.map((c) => q(r[c.name])).join(','));
  return (options.bom ? '\ufeff' : '') + lines.join('\r\n') + '\r\n';
}
