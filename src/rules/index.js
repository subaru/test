import date from './date.js';
import phone from './phone.js';
import postal from './postal.js';
import { email, boolean, kana, number } from './misc.js';

// 判定の優先順。一致率が同じなら先にあるものを採用する。
export const rules = [date, postal, phone, email, boolean, kana, number];

export const ruleByType = Object.fromEntries(rules.map((r) => [r.type, r]));

export const TEXT = { type: 'text', label: 'テキスト' };
