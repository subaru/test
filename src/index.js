import { read } from './read/index.js';
import { detect } from './detect.js';
import { normalize } from './normalize.js';
import { toReport } from './report/html.js';
import { render, toTableHTML } from './view/render.js';

export { read, detect, normalize, toReport, render, toTableHTML };
export { rules } from './rules/index.js';

// 読み込み → 列の種類の推論 → 正規化 をまとめて実行する
export async function tidy(input, options = {}) {
  const table = await read(input, options);
  const schema = detect(table, options);
  const { data, changes, issues } = normalize(table, schema, options);
  const result = { data, schema, changes, issues, meta: table.meta };

  return {
    ...result,
    toReport: (opts) => toReport(result, opts),
    toTableHTML: () => toTableHTML(result),
    toJSON: () => data,
    toCSV: () => toCSV(result),
    render: (el, opts) => render(el, result, opts),
  };
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
