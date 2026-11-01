import { HYPHENS } from './common.js';

const ALLOWED = /^(?:TEL|Tel|tel|電話|携帯)?[:：]?\s*\+?[\d\s()\-]+$/;

// 区切りがない場合の桁の分け方（市外局番の完全な辞書は持たないので代表的なものだけ）
function split(d) {
  if (/^0[789]0/.test(d) && d.length === 11) return [[3, 4, 4], 1];
  if (/^050/.test(d) && d.length === 11) return [[3, 4, 4], 1];
  if (/^0120/.test(d) && d.length === 10) return [[4, 3, 3], 1];
  if (/^0800/.test(d) && d.length === 11) return [[4, 3, 4], 1];
  if (/^0[36]/.test(d) && d.length === 10) return [[2, 4, 4], 1];
  if (d.length === 10) return [[3, 3, 4], 0.6]; // 市外局番の桁数は推測
  return [null, 0];
}

function parse(v, ctx = {}) {
  let s = v.replace(HYPHENS, '-');
  if (!ALLOWED.test(s)) return null;
  s = s.replace(/^(?:TEL|Tel|tel|電話|携帯)?[:：]?\s*/, '');

  let digits = s.replace(/\D/g, '');
  if (s.startsWith('+81')) digits = '0' + digits.slice(2);
  if (!/^0\d{9,10}$/.test(digits)) return null;

  // 数字だけの値はIDなどの場合があるので、列名が電話番号らしい場合だけ。
  // 電話番号と判定済みの列の中なら、提案として扱う
  const bare = /^\d+$/.test(s) && !ctx.hinted;
  if (bare && !ctx.typed) return null;
  const cap = (r) => (bare ? { ...r, confidence: Math.min(r.confidence, 0.8), note: `${r.note}（数字だけの値のため提案）` } : r);

  // 元の値に区切りがあれば、その区切り方を尊重する
  const groups = s.replace(/^\+81\s*/, '0').split(/[^\d]+/).filter(Boolean);
  if (groups.length === 3 && groups.join('') === digits) {
    return { value: groups.join('-'), confidence: 1, note: '電話番号の区切りをハイフンに統一' };
  }

  const [sizes, confidence] = split(digits);
  if (!sizes) return null;
  let i = 0;
  const value = sizes.map((n) => digits.slice(i, (i += n))).join('-');
  return cap({
    value,
    confidence,
    note: confidence < 1 ? '市外局番の桁数を推測して区切った' : '電話番号にハイフンを補った',
  });
}

export default {
  type: 'phone',
  label: '電話番号',
  hint: /電話|^tel|tel$|phone|携帯|fax/i,
  match: (v, ctx) => parse(v, ctx) !== null,
  normalize: parse,
};
