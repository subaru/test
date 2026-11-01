// 表記ゆれの統一。テキスト列の値を「指紋」（比較用のキー）でまとめ、最も多い表記に揃える。
//
//   厳密：「(株)ABC」「株式会社ABC」「株式会社 ＡＢＣ」 → 同じ指紋 → 自動で統一
//   緩い：「株式会社ABC」「ABC株式会社」（前株・後株）  → 法人格を除くと同じ → 提案のみ
//         （前株と後株は別の会社の場合があるため）

const CORP = [
  ['(株)', '株式会社'],
  ['(有)', '有限会社'],
  ['(同)', '合同会社'],
  ['(名)', '合名会社'],
  ['(資)', '合資会社'],
  ['(社)', '社団法人'],
  ['(財)', '財団法人'],
  ['(医)', '医療法人'],
  ['(学)', '学校法人'],
];
const CORP_WORDS = new RegExp(`(${[...new Set(CORP.map(([, w]) => w))].join('|')}|一般|公益)`, 'g');

const expandCorp = (s) => CORP.reduce((acc, [abbr, full]) => acc.split(abbr).join(full), s);

const SEPARATORS = /[\s・･.,、。'"`\-‐−ー_/()「」『』]/g;

export function fingerprint(value) {
  return (
    expandCorp(String(value))
      .toLowerCase()
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      // 数字と数字の間の区切りは意味を持つ（「1-23」と「12-3」、「1.5」と「15」は別物）ので「#」として残す
      .replace(/(?<=\d)\s*[.,\-‐−ー/・]\s*(?=\d)/g, '#')
      .replace(SEPARATORS, '')
  );
}

// 法人格を取り除いた指紋。法人格の種類は残すので「(有)ABC」と「(株)ABC」はまとめない
export function looseFingerprint(value) {
  const fp = fingerprint(value);
  const kinds = [...new Set(fp.match(CORP_WORDS) ?? [])].sort().join('+');
  return kinds ? `${kinds}|${fp.replace(CORP_WORDS, '')}` : '';
}

// 代表の表記：最も多いもの → 略称を含まないもの → 先に出てきたもの
function pickCanonical(variants) {
  return [...variants].sort((a, b) => b.count - a.count || /\(.\)/.test(a.value) - /\(.\)/.test(b.value) || a.first - b.first)[0].value;
}

function group(counts, keyOf) {
  const groups = new Map();
  for (const v of counts.values()) {
    const key = keyOf(v.value);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export function cluster(result, options = {}) {
  if (options.cluster === false) return [];
  const minConfidence = options.minConfidence ?? 0.9;
  const { data, schema, changes } = result;
  const clusters = [];
  const cellKey = (row, column) => `${row}\t${column}`;
  const changeAt = new Map(changes.map((c, i) => [cellKey(c.row, c.column), i]));

  for (const col of schema) {
    if (col.type !== 'text' || options.columns?.[col.name]?.cluster === false) continue;

    const countValues = () => {
      const counts = new Map();
      data.forEach((r, i) => {
        const v = r[col.name];
        if (v === null || v === undefined || v === '') return;
        if (!counts.has(v)) counts.set(v, { value: v, count: 0, first: i });
        counts.get(v).count++;
      });
      return counts;
    };

    // 値 → 行番号の索引（まとまりごとに全行を走査すると件数の2乗の時間がかかるため）
    let rowsByValue;
    const indexRows = () => {
      rowsByValue = new Map();
      data.forEach((r, row) => {
        const v = r[col.name];
        if (!rowsByValue.has(v)) rowsByValue.set(v, []);
        rowsByValue.get(v).push(row);
      });
    };

    const apply = (variants, confidence) => {
      const canonical = pickCanonical(variants);
      const applied = confidence >= minConfidence;
      const note = `表記ゆれを「${canonical}」に統一（${variants.length}種類）`;
      const entry = { column: col.name, canonical, variants: variants.map(({ value, count }) => ({ value, count })), confidence, applied, rows: [] };
      clusters.push(entry);

      const rows = variants.flatMap((v) => rowsByValue.get(v.value) ?? []).sort((a, b) => a - b);
      for (const row of rows) {
        const r = data[row];
        const value = r[col.name];
        entry.rows.push(row);
        if (value === canonical) continue;
        // 同じセルに記録済みの変更があれば、元の値を引き継いで1件にまとめる
        const prev = changeAt.get(cellKey(row, col.name)) ?? -1;
        const before = prev >= 0 ? changes[prev].before : value;
        const change = { row, column: col.name, before, after: canonical, rule: 'cluster', note, confidence, applied };
        if (prev >= 0 && applied) changes[prev] = change;
        else changeAt.set(cellKey(row, col.name), changes.push(change) - 1);
        if (applied) r[col.name] = canonical;
        else result.issues.push({ row, column: col.name, value, reason: `表記ゆれの可能性（提案: ${canonical}）`, suggestion: canonical });
      }
    };

    indexRows();
    for (const g of group(countValues(), fingerprint)) apply(g, 1);
    // 厳密に統一した後の値で、法人格の位置を無視した緩い指紋でもう一度まとめる（提案のみ）
    indexRows();
    for (const g of group(countValues(), looseFingerprint)) apply(g, 0.6);
  }

  changes.sort((a, b) => a.row - b.row || schema.findIndex((s) => s.name === a.column) - schema.findIndex((s) => s.name === b.column));
  return clusters;
}
