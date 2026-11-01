// 分析レポートHTML（1ファイルで完結）を生成する。

const MAX_ROWS = 2000;

export function escape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const pct = (n) => `${Math.round(n * 100)}%`;

function shown(v) {
  if (v === null || v === '') return '<span class="muted">（空）</span>';
  return escape(v);
}

function columnCard(col, changes, issues) {
  const n = changes.filter((c) => c.column === col.name).length;
  const k = issues.filter((c) => c.column === col.name).length;
  const level = col.type === 'text' ? 'neutral' : col.confidence >= 0.95 ? 'good' : 'warn';
  const alts = col.candidates
    .filter((c) => c.type !== col.type)
    .slice(0, 2)
    .map((c) => `${escape(c.label)} ${pct(c.ratio)}`)
    .join('、');
  return `<article class="card">
  <header><h3>${escape(col.name)}</h3><span class="badge ${level}">${escape(col.label)}</span></header>
  <dl>
    <div><dt>確信度</dt><dd>${col.type === 'text' ? '—' : pct(col.confidence)}${col.forced ? '（指定）' : ''}</dd></div>
    <div><dt>値あり / 空</dt><dd>${col.nonEmpty} / ${col.empty}</dd></div>
    <div><dt>種類の数</dt><dd>${col.unique}</dd></div>
    <div><dt>変更 / 要確認</dt><dd>${n} / ${k}</dd></div>
  </dl>
  ${alts ? `<p class="muted small">他の候補：${alts}</p>` : ''}
</article>`;
}

export function toReport(result, options = {}) {
  const { schema, changes, issues, data, meta } = result;
  const title = options.title ?? 'nihon-tidy 分析レポート';
  const applied = changes.filter((c) => c.applied).length;
  const rules = [...new Set(changes.map((c) => c.rule))];
  const clusters = result.clusters ?? [];
  const RULES = { common: '全角・半角・空白', cluster: '表記ゆれ', manual: '手動の修正' };
  const ruleLabel = (r) => RULES[r] ?? schema.find((s) => s.type === r)?.label ?? r;

  const changeRows = changes
    .slice(0, MAX_ROWS)
    .map(
      (c) => `<tr data-col="${escape(c.column)}" data-rule="${escape(c.rule)}" class="${c.applied ? '' : 'pending'}">
<td class="num">${c.row + 1}</td><td>${escape(c.column)}</td><td class="before">${shown(c.before)}</td><td class="after">${shown(c.after)}</td><td>${escape(c.note)}</td><td class="num">${pct(c.confidence)}</td><td>${c.applied ? (c.rule === 'manual' ? '手動' : '適用') : c.dismissed ? '見送り' : '提案'}</td></tr>`,
    )
    .join('\n');

  const issueRows = issues
    .slice(0, MAX_ROWS)
    .map((i) => `<tr><td class="num">${i.row + 1}</td><td>${escape(i.column)}</td><td>${shown(i.value)}</td><td>${escape(i.reason)}</td></tr>`)
    .join('\n');

  const more = (list) => (list.length > MAX_ROWS ? `<p class="muted">先頭${MAX_ROWS}件を表示（全${list.length}件）</p>` : '');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root { --bg:#fafaf8; --fg:#1d1d1b; --muted:#6b6b66; --line:#e2e1dc; --card:#fff; --good:#1f7a4d; --warn:#a15c00; --accent:#2b59c3; --before:#fbeaea; --after:#e6f4ec; }
@media (prefers-color-scheme: dark) { :root { --bg:#161615; --fg:#ecebe6; --muted:#9a9993; --line:#33322f; --card:#1f1f1d; --good:#5cc995; --warn:#f0a94a; --accent:#8aa9f0; --before:#3a2323; --after:#1f3529; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; }
main { max-width:1100px; margin:0 auto; padding:32px 16px 64px; }
h1 { font-size:24px; margin:0 0 4px; } h2 { font-size:18px; margin:40px 0 12px; } h3 { font-size:15px; margin:0; overflow-wrap:anywhere; }
.muted { color:var(--muted); } .small { font-size:13px; margin:8px 0 0; }
.summary { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; margin-top:20px; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px 16px; }
.stat b { display:block; font-size:24px; font-variant-numeric:tabular-nums; }
.cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
.card header { display:flex; justify-content:space-between; gap:8px; align-items:start; margin-bottom:8px; }
.card dl { margin:0; display:grid; gap:2px; } .card dl div { display:flex; justify-content:space-between; font-size:13px; }
.card dt { color:var(--muted); } .card dd { margin:0; font-variant-numeric:tabular-nums; }
.badge { font-size:12px; padding:1px 8px; border-radius:99px; border:1px solid currentColor; white-space:nowrap; }
.badge.good { color:var(--good); } .badge.warn { color:var(--warn); } .badge.neutral { color:var(--muted); }
.filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
select { font:inherit; padding:4px 8px; background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:6px; }
.scroll { overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--card); }
table { border-collapse:collapse; width:100%; font-size:13px; }
th, td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { position:sticky; top:0; background:var(--card); font-weight:600; white-space:nowrap; }
td.num { text-align:right; font-variant-numeric:tabular-nums; }
td.before { background:var(--before); } td.after { background:var(--after); }
tr.pending td { opacity:.75; } tr.pending td.after { background:transparent; outline:1px dashed var(--warn); outline-offset:-3px; }
footer { margin-top:48px; font-size:12px; }
</style>
</head>
<body>
<main>
<h1>${escape(title)}</h1>
<p class="muted">入力：${escape(meta.name ?? meta.source ?? '')}${meta.encoding ? `（文字コード：${escape(meta.encoding)}）` : ''}${meta.sheet ? `（シート：${escape(meta.sheet)}、見出し：${meta.headerRow}行目、結合セル：${meta.merged}）` : ''}${meta.how ? `（読み取り方：${escape(meta.how)}${meta.tables ? `、ページ内の表：${meta.tables}個` : ''}）` : ''}</p>

<section class="summary">
  <div class="stat"><span class="muted">行数</span><b>${data.length}</b></div>
  <div class="stat"><span class="muted">列数</span><b>${schema.length}</b></div>
  <div class="stat"><span class="muted">適用した変更</span><b>${applied}</b></div>
  <div class="stat"><span class="muted">提案（未適用）</span><b>${changes.length - applied}</b></div>
  <div class="stat"><span class="muted">表記ゆれ</span><b>${clusters.length}組</b></div>
  <div class="stat"><span class="muted">要確認</span><b>${issues.length}</b></div>
</section>

<h2>列の種類</h2>
<section class="cards">
${schema.map((c) => columnCard(c, changes, issues)).join('\n')}
</section>

<h2>変更点</h2>
${
  changes.length
    ? `<div class="filters">
  <select id="f-col"><option value="">すべての列</option>${schema.map((c) => `<option value="${escape(c.name)}">${escape(c.name)}</option>`).join('')}</select>
  <select id="f-rule"><option value="">すべての規則</option>${rules.map((r) => `<option value="${escape(r)}">${escape(ruleLabel(r))}</option>`).join('')}</select>
</div>
<div class="scroll"><table id="changes">
<thead><tr><th>行</th><th>列</th><th>変更前</th><th>変更後</th><th>内容</th><th>確信度</th><th>状態</th></tr></thead>
<tbody>
${changeRows}
</tbody></table></div>${more(changes)}`
    : '<p class="muted">変更はありません。</p>'
}

<h2>表記ゆれ</h2>
${
  clusters.length
    ? `<div class="scroll"><table>
<thead><tr><th>列</th><th>統一後</th><th>まとめた表記（件数）</th><th>状態</th></tr></thead>
<tbody>
${clusters
  .map(
    (c) => `<tr><td>${escape(c.column)}</td><td>${escape(c.canonical)}</td><td>${c.variants.map((v) => `${escape(v.value)}（${v.count}）`).join('、')}</td><td>${c.applied ? '統一' : '提案（前株・後株などの違い）'}</td></tr>`,
  )
  .join('\n')}
</tbody></table></div>`
    : '<p class="muted">表記ゆれは見つかりませんでした。</p>'
}

<h2>要確認</h2>
${
  issues.length
    ? `<div class="scroll"><table>
<thead><tr><th>行</th><th>列</th><th>値</th><th>理由</th></tr></thead>
<tbody>
${issueRows}
</tbody></table></div>${more(issues)}`
    : '<p class="muted">要確認の項目はありません。</p>'
}

<footer class="muted">nihon-tidy で生成（行番号はヘッダーを除いたデータの行）</footer>
</main>
<script>
(() => {
  const col = document.getElementById('f-col'), rule = document.getElementById('f-rule');
  if (!col) return;
  const apply = () => document.querySelectorAll('#changes tbody tr').forEach((tr) => {
    tr.hidden = (col.value && tr.dataset.col !== col.value) || (rule.value && tr.dataset.rule !== rule.value);
  });
  col.addEventListener('change', apply); rule.addEventListener('change', apply);
})();
</script>
</body>
</html>
`;
}
