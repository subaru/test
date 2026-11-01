// メールアドレス・真偽値・フリガナ・数値

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const email = {
  type: 'email',
  label: 'メールアドレス',
  hint: /mail|メール/i,
  match: (v) => EMAIL.test(v),
  normalize(v) {
    if (!EMAIL.test(v)) return null;
    const at = v.lastIndexOf('@');
    return { value: v.slice(0, at) + '@' + v.slice(at + 1).toLowerCase(), confidence: 1, note: 'ドメインを小文字に統一' };
  },
};

// 0/1 は数値の列と区別できないので含めない
const TRUE = new Set(['○', '◯', '〇', '有', 'あり', 'はい', '済', '可', 'true', 'yes', 'y', 'on']);
const FALSE = new Set(['×', '✕', '無', 'なし', 'いいえ', '未', '不可', 'false', 'no', 'n', 'off']);

export const boolean = {
  type: 'boolean',
  label: '真偽値',
  match: (v) => TRUE.has(v.toLowerCase()) || FALSE.has(v.toLowerCase()),
  normalize(v) {
    const k = v.toLowerCase();
    if (TRUE.has(k)) return { value: true, confidence: 1, note: '真偽値に変換' };
    if (FALSE.has(k)) return { value: false, confidence: 1, note: '真偽値に変換' };
    return null;
  },
};

const KANA = /^[ぁ-ゖァ-ヺー・ 　]+$/;

export const kana = {
  type: 'kana',
  label: 'フリガナ',
  hint: /フリガナ|ふりがな|カナ|かな|kana|読み/i,
  match: (v) => KANA.test(v),
  normalize(v) {
    if (!KANA.test(v)) return null;
    const value = v
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .replace(/[ 　]+/g, ' ');
    return { value, confidence: 1, note: 'ひらがなをカタカナに統一' };
  },
};

const UNITS = { 億: 1e8, 万: 1e4, 千: 1e3 };

function parseNumber(v) {
  let s = v.replace(/[¥\\$,円\s]/g, '');
  let sign = 1;
  if (/^[△▲]/.test(s)) {
    sign = -1;
    s = s.slice(1);
  } else if (/^\(.+\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return sign * Number(s);

  // 「1万2千」「3.5億」のような単位付き
  const m = s.match(/^(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?(?:(\d+)千)?(\d+)?$/);
  if (!m || !m.slice(1).some(Boolean)) return null;
  const [, oku, man, sen, rest] = m;
  return sign * ((+oku || 0) * UNITS.億 + (+man || 0) * UNITS.万 + (+sen || 0) * UNITS.千 + (+rest || 0));
}

export const number = {
  type: 'number',
  label: '数値',
  match: (v) => parseNumber(v) !== null,
  normalize(v) {
    const n = parseNumber(v);
    if (n === null) return null;
    const note = /[△▲(]/.test(v) ? '会計表記のマイナスを変換' : /[億万千]/.test(v) ? '単位付きの数を変換' : '記号・桁区切りを除いて数値に変換';
    return { value: n, confidence: 1, note };
  },
};
