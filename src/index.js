import { read } from './read/index.js';
import { detect } from './detect.js';
import { normalize } from './normalize.js';
import { toReport } from './report/html.js';
import { cluster } from './cluster.js';
import { fix, accept, dismiss, acceptAll, setCanonical } from './fix.js';
import { render, toTableHTML, toCardsHTML } from './view/render.js';
import { renderReview } from './view/review.js';
import { ruleSet, checkPlugins, pluginRules } from './rules/index.js';

export { read, detect, normalize, cluster, toReport, render, renderReview, toTableHTML, toCardsHTML };
export { fingerprint } from './cluster.js';
export { rules, ruleSet } from './rules/index.js';
export { tidyInWorker } from './worker-client.js';

// 名前で指定できる組み込みのプラグイン（必要になったときだけ読み込む）
const BUILTIN_PLUGINS = {
  address: () => import('./plugins/address.js'),
};

// プラグインの指定を規則の配列にする。名前の指定は組み込みのプラグインを読み込む
async function resolvePlugins(plugins) {
  const out = [];
  for (const p of checkPlugins(plugins)) {
    if (typeof p === 'string') {
      if (!BUILTIN_PLUGINS[p]) throw new Error(`不明なプラグインです：${p}（${Object.keys(BUILTIN_PLUGINS).join('、')}）`);
      out.push(...pluginRules((await BUILTIN_PLUGINS[p]()).default()));
    } else {
      out.push(...pluginRules(p));
    }
  }
  return out;
}

// 読み込み → 列の種類の推論 → 正規化 → 表記ゆれの統一 をまとめて実行する
export async function tidy(input, options = {}) {
  const opts = { ...options, ruleSet: ruleSet(await resolvePlugins(options.plugins)) };
  delete opts.plugins;
  const table = await read(input, opts);
  const schema = detect(table, opts);
  const { data, changes, issues } = normalize(table, schema, opts);
  if (table.warnings.length) issues.splice(0, 0, ...table.warnings.slice(0, 10000));
  const result = { data, schema, changes, issues, meta: table.meta };
  result.clusters = cluster(result, opts);
  return hydrate(result);
}

// 処理結果（data・schema・changes・issues・clusters・meta だけの素のオブジェクト）に操作を付ける。
// Web Worker から受け取った結果や、JSONとして保存した結果を元に戻すのに使う
// hydrate は渡したオブジェクトをそのまま使う（コピーしない）。保存用に切り離したいときは toPlain() を使う
export function hydrate(plain) {
  if (!plain || typeof plain !== 'object') throw new TypeError('hydrate には toPlain() の結果を渡してください');
  for (const key of ['data', 'schema', 'changes', 'issues']) {
    if (!Array.isArray(plain[key])) throw new TypeError(`hydrate に渡す結果に ${key}（配列）がありません`);
  }
  const result = { ...plain, clusters: plain.clusters ?? [], meta: plain.meta ?? {} };
  const { data } = result;
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
    // Web Worker に渡したり、保存して hydrate で戻したりできる素のオブジェクト（その時点の写し。後の修正は反映されない）
    toPlain: () => structuredClone({ data: result.data, schema: result.schema, changes: result.changes, issues: result.issues, clusters: result.clusters, meta: result.meta }),
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
