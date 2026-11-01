import { clean, PLACEHOLDERS } from './rules/common.js';
import { ruleByType } from './rules/index.js';

// 推論した種類に従ってセルを正規化し、すべての変更を記録する。
// minConfidence 未満の変換は適用せず「提案」として残す。
export function normalize(table, schema, options = {}) {
  const minConfidence = options.minConfidence ?? 0.9;
  const changes = [];
  const issues = [];

  const data = table.rows.map((row, ri) => {
    const record = {};
    schema.forEach((col, ci) => {
      const raw = row[ci] ?? '';
      const base = clean(raw);
      const rule = ruleByType[col.type];
      let value = base === '' ? null : base;

      if (base !== raw) {
        const note = base === '' ? '空白だけのセルを空に' : '全角・半角や空白を統一';
        changes.push({ row: ri, column: col.name, before: raw, after: value, rule: 'common', note, confidence: 1, applied: true });
      }

      // 型のある列の「-」「N/A」などは、値がないことを表す記号として空にする
      if (rule && PLACEHOLDERS.has(base)) {
        const last = changes.at(-1);
        if (last && last.row === ri && last.column === col.name) changes.pop();
        changes.push({ row: ri, column: col.name, before: raw, after: null, rule: 'common', note: '値がないことを表す記号を空に', confidence: 1, applied: true });
        value = null;
      } else if (rule && base !== '') {
        const r = rule.normalize(base, { hinted: col.hinted || col.forced, typed: true });
        if (!r) {
          issues.push({ row: ri, column: col.name, value: raw, reason: `${col.label}として解釈できません` });
        } else if (String(r.value) !== base) {
          const applied = r.confidence >= minConfidence;
          // 共通の統一と種類ごとの変換が重なったら、1件の変更にまとめる（未適用なら共通の統一は残す）
          const last = changes.at(-1);
          if (applied && last && last.row === ri && last.column === col.name) changes.pop();
          changes.push({ row: ri, column: col.name, before: raw, after: r.value, rule: col.type, note: r.note, confidence: r.confidence, applied });
          if (applied) value = r.value;
          else issues.push({ row: ri, column: col.name, value: raw, reason: `確信度が低いため未適用（提案: ${r.value}）`, suggestion: r.value });
        } else {
          value = r.value;
        }
      }

      record[col.name] = value;
    });
    return record;
  });

  return { data, changes, issues };
}
