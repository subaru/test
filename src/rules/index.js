import date from './date.js';
import phone from './phone.js';
import postal from './postal.js';
import { email, boolean, kana, number } from './misc.js';

// 判定の優先順。一致率が同じなら先にあるものを採用する。
export const rules = [date, postal, phone, email, boolean, kana, number];

export const ruleByType = Object.fromEntries(rules.map((r) => [r.type, r]));

export const TEXT = { type: 'text', label: 'テキスト' };

// 規則の形を確かめ、エラーに規則の名前を付ける。hint の g・y フラグは test の結果が交互に変わるので外す
export function checkRule(rule, owner = '規則') {
  const where = `${owner}の規則「${rule?.type ?? '?'}」`;
  if (!rule || typeof rule !== 'object') throw new TypeError(`${owner}の規則がオブジェクトではありません`);
  if (typeof rule.type !== 'string' || !rule.type) throw new TypeError(`${where}：type（文字列）がありません`);
  if (rule.type === 'text') throw new TypeError(`${where}：type に 'text' は使えません`);
  if (typeof rule.match !== 'function' || typeof rule.normalize !== 'function') throw new TypeError(`${where}：match と normalize（関数）が必要です`);
  if (rule.hint !== undefined && !(rule.hint instanceof RegExp)) throw new TypeError(`${where}：hint は正規表現で指定してください`);
  const hint = rule.hint && new RegExp(rule.hint.source, rule.hint.flags.replace(/[gy]/g, ''));
  const wrap = (fn, name) => (...args) => {
    try {
      return fn.apply(rule, args);
    } catch (error) {
      throw new Error(`${where}の ${name} でエラーが起きました：${error.message}`, { cause: error });
    }
  };
  const normalize = wrap(rule.normalize, 'normalize');
  return {
    ...rule,
    label: typeof rule.label === 'string' ? rule.label : rule.type,
    hint,
    match: wrap(rule.match, 'match'),
    normalize: (...args) => {
      const r = normalize(...args);
      if (r === null || r === undefined) return null;
      if (typeof r !== 'object' || !('value' in r) || typeof r.confidence !== 'number') {
        throw new TypeError(`${where}の normalize は { value, confidence, note } か null を返してください`);
      }
      return r;
    },
  };
}

// プラグインの規則を加えた規則の組。プラグインの規則を先に試し、同じ type なら（列の判定でも正規化でも）プラグインの規則を使う
export function ruleSet(extra = []) {
  const list = [...extra, ...rules];
  const byType = {};
  for (const r of list) byType[r.type] ??= r;
  return { list: list.filter((r) => byType[r.type] === r), byType };
}

export const defaultRuleSet = ruleSet();

// プラグインの指定を確かめて、{ name, rules } の配列にする（名前の解決は呼び出し側）
export function checkPlugins(plugins) {
  if (plugins === undefined || plugins === null) return [];
  if (!Array.isArray(plugins)) throw new TypeError("plugins は配列で指定してください（例：plugins: ['address']）");
  return plugins;
}

export function pluginRules(plugin) {
  if (!plugin || !Array.isArray(plugin.rules)) throw new TypeError('プラグインは名前（"address" など）か { name, rules } のオブジェクトで指定してください');
  const owner = `プラグイン「${plugin.name ?? '名前なし'}」`;
  return plugin.rules.map((r) => checkRule(r, owner));
}

// detect・normalize を段階ごとに呼ぶときの規則の組：ruleSet か、オブジェクトのプラグインから作る
export function stageRuleSet(options = {}) {
  if (options.ruleSet) return options.ruleSet;
  const plugins = checkPlugins(options.plugins);
  if (!plugins.length) return defaultRuleSet;
  if (plugins.some((p) => typeof p === 'string')) {
    throw new TypeError("段階ごとに呼ぶときは、プラグインをオブジェクトで渡してください（import address from 'nihon-tidy/address' して plugins: [address()]）。名前で指定できるのは tidy だけです");
  }
  return ruleSet(plugins.flatMap(pluginRules));
}
