import { clean, PLACEHOLDERS } from './rules/common.js';
import { rules, ruleByType, TEXT } from './rules/index.js';

// 列ごとに全件を検査し、種類と確信度（一致した割合）を推論する。
export function detect(table, options = {}) {
  const threshold = options.threshold ?? 0.7;
  // 列名が種類を示している場合（「生年月日」など）は基準を下げる
  const hintedThreshold = options.hintedThreshold ?? 0.5;
  const overrides = options.columns ?? {};

  return table.columns.map((name, ci) => {
    const values = table.rows.map((r) => clean(r[ci])).filter((v) => v !== '' && !PLACEHOLDERS.has(v));
    const stats = {
      name,
      nonEmpty: values.length,
      empty: table.rows.length - values.length,
      unique: new Set(values).size,
    };

    const forced = overrides[name]?.type;
    if (forced) {
      const rule = ruleByType[forced] ?? TEXT;
      return { ...stats, type: rule.type, label: rule.label, confidence: 1, hinted: true, forced: true, candidates: [] };
    }

    const candidates = rules
      .map((rule) => {
        const hinted = rule.hint ? rule.hint.test(name) : false;
        const hits = values.filter((v) => rule.match(v, { hinted })).length;
        return { type: rule.type, label: rule.label, hinted, minRatio: rule.minRatio ?? 0, ratio: values.length ? hits / values.length : 0 };
      })
      .filter((c) => c.ratio > 0)
      // 一致率が近い（5%以内）なら列名のヒントがある方を優先
      .sort((a, b) => (Math.abs(b.ratio - a.ratio) < 0.05 ? b.hinted - a.hinted : b.ratio - a.ratio));

    const best = candidates[0];
    // 規則ごとの基準（真偽値は「ほぼ全件」が条件）は、列名のヒントがあれば緩める
    const required = best?.hinted ? hintedThreshold : Math.max(threshold, best?.minRatio ?? 0);
    if (!best || best.ratio < required) {
      return { ...stats, type: TEXT.type, label: TEXT.label, confidence: 1 - (best?.ratio ?? 0), hinted: false, candidates };
    }
    return { ...stats, type: best.type, label: best.label, confidence: best.ratio, hinted: best.hinted, candidates };
  });
}
