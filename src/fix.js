// 要確認の項目を直す操作。どの操作も data・changes・issues を同時に更新し、変更ログに残す。

const same = (row, column) => (x) => x.row === row && x.column === column;

function dropIssues(result, row, column) {
  for (let i = result.issues.length - 1; i >= 0; i--) if (same(row, column)(result.issues[i])) result.issues.splice(i, 1);
}

// セルを任意の値に直す
export function fix(result, row, column, value, note = '手動で修正') {
  const v = value === '' || value === undefined ? null : value;
  const prev = result.changes.filter(same(row, column));
  const before = prev.length ? prev[0].before : result.data[row][column];
  for (const c of prev) result.changes.splice(result.changes.indexOf(c), 1);
  if (String(v ?? '') !== String(before ?? '')) {
    result.changes.push({ row, column, before, after: v, rule: 'manual', note, confidence: 1, applied: true });
  }
  result.data[row][column] = v;
  dropIssues(result, row, column);
}

// 未適用の提案を適用する
export function accept(result, row, column) {
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
  return true;
}

// 今の値のままにする（提案は記録に残すが適用しない）
export function dismiss(result, row, column) {
  for (const c of result.changes) if (same(row, column)(c) && !c.applied) c.dismissed = true;
  dropIssues(result, row, column);
}

export function acceptAll(result) {
  const cells = result.changes.filter((c) => !c.applied && !c.dismissed).map((c) => [c.row, c.column]);
  return cells.filter(([row, column]) => accept(result, row, column)).length;
}

// 表記ゆれのまとまりを、選んだ表記に揃え直す
export function setCanonical(result, clusterIndex, canonical) {
  const cl = result.clusters[clusterIndex];
  for (const row of cl.rows) fix(result, row, cl.column, canonical, `表記ゆれを「${canonical}」に統一（選択）`);
  cl.canonical = canonical;
  cl.applied = true;
}
