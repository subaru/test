// 要確認の項目を直す操作。どれも data・changes・issues を同時に更新する。
// fix・accept・setCanonical は変更ログに残り、dismiss は提案を「見送り」として残す。

const same = (row, column) => (x) => x.row === row && x.column === column;

function check(result, row, column) {
  if (!Number.isInteger(row) || row < 0 || row >= result.data.length) throw new RangeError(`行がありません：${row}（0〜${result.data.length - 1}）`);
  if (!result.schema.some((c) => c.name === column)) throw new RangeError(`列がありません：${column}`);
}

// 表記ゆれのまとまりが、提案の個別適用などで揃ったら「統一済み」にする
// （手で別の値に直した行は、まとまりから外れたものとして数えない）
function refreshClusters(result, column) {
  for (const cl of result.clusters ?? []) {
    if (cl.column !== column || cl.applied) continue;
    const others = new Set(cl.variants.map((v) => v.value).filter((v) => v !== cl.canonical));
    if (!cl.rows.some((r) => others.has(result.data[r][column]))) cl.applied = true;
  }
}

function dropIssues(result, row, column) {
  for (let i = result.issues.length - 1; i >= 0; i--) if (same(row, column)(result.issues[i])) result.issues.splice(i, 1);
}

// セルを任意の値に直す
export function fix(result, row, column, value, note = '手動で修正') {
  check(result, row, column);
  const v = value === '' || value === undefined ? null : value;
  const prev = result.changes.filter(same(row, column));
  const before = prev.length ? prev[0].before : result.data[row][column];
  for (const c of prev) result.changes.splice(result.changes.indexOf(c), 1);
  if (String(v ?? '') !== String(before ?? '')) {
    result.changes.push({ row, column, before, after: v, rule: 'manual', note, confidence: 1, applied: true });
  }
  result.data[row][column] = v;
  dropIssues(result, row, column);
  refreshClusters(result, column);
}

// 未適用の提案を適用する
export function accept(result, row, column) {
  check(result, row, column);
  const pending = result.changes.find((c) => same(row, column)(c) && !c.applied);
  if (!pending) return false;
  // 共通の統一だけ適用済みの記録が残っていれば、提案に吸収する
  for (const c of result.changes.filter((c) => same(row, column)(c) && c.applied)) {
    result.changes.splice(result.changes.indexOf(c), 1);
  }
  pending.applied = true;
  pending.reviewed = true;
  result.data[row][column] = pending.after;
  dropIssues(result, row, column);
  refreshClusters(result, column);
  return true;
}

// 今の値のままにする（提案は記録に残すが適用しない）
export function dismiss(result, row, column) {
  check(result, row, column);
  for (const c of result.changes) if (same(row, column)(c) && !c.applied) c.dismissed = true;
  dropIssues(result, row, column);
}

export function acceptAll(result) {
  const cells = result.changes.filter((c) => !c.applied && !c.dismissed).map((c) => [c.row, c.column]);
  return cells.filter(([row, column]) => accept(result, row, column)).length;
}

// 表記ゆれのまとまりを、選んだ表記に揃え直す。
// 手で直したセルと、すでにまとまりの外の値になっているセルには触れない。
export function setCanonical(result, clusterIndex, canonical) {
  const cl = result.clusters[clusterIndex];
  if (!cl) throw new RangeError(`表記ゆれのまとまりがありません：${clusterIndex}`);
  const old = cl.canonical;
  const members = new Set([old, ...cl.variants.map((v) => v.value)]);
  const manual = new Set(result.changes.filter((c) => c.column === cl.column && c.rule === 'manual' && !/表記ゆれ/.test(c.note)).map((c) => c.row));

  for (const row of cl.rows) {
    if (manual.has(row) || !members.has(result.data[row][cl.column])) continue;
    fix(result, row, cl.column, canonical, `表記ゆれを「${canonical}」に統一（選択）`);
  }
  cl.canonical = canonical;
  cl.applied = true;

  // 同じ列の別のまとまり（前株・後株の提案など）が古い表記を指していれば、新しい表記に付け替える
  if (old === canonical) return;
  for (const other of result.clusters) {
    if (other === cl || other.column !== cl.column) continue;
    for (const v of other.variants) if (v.value === old) v.value = canonical;
    if (other.canonical !== old) continue;
    other.canonical = canonical;
    for (const c of result.changes) {
      if (c.column === cl.column && !c.applied && c.after === old && other.rows.includes(c.row)) {
        c.after = canonical;
        c.note = `表記ゆれを「${canonical}」に統一（${other.variants.length}種類）`;
      }
    }
    for (const i of result.issues) {
      if (i.column === cl.column && i.suggestion === old && other.rows.includes(i.row)) {
        i.suggestion = canonical;
        i.reason = `表記ゆれの可能性（提案: ${canonical}）`;
      }
    }
  }
  refreshClusters(result, cl.column);
}
