import date from './date.js';
import phone from './phone.js';
import postal from './postal.js';
import { email, boolean, kana, number } from './misc.js';

// 判定の優先順。一致率が同じなら先にあるものを採用する。
export const rules = [date, postal, phone, email, boolean, kana, number];

export const ruleByType = Object.fromEntries(rules.map((r) => [r.type, r]));

export const TEXT = { type: 'text', label: 'テキスト' };

// プラグインの規則を加えた規則の組。プラグインの規則を先に試す
export function ruleSet(extra = []) {
  const list = [...extra, ...rules];
  return { list, byType: Object.fromEntries(list.map((r) => [r.type, r])) };
}

export const defaultRuleSet = ruleSet();
