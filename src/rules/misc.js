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
// 記号や英語は真偽値と言い切れるが、「済・未・有・無」などは備考の言葉の場合もある
const SYMBOLIC = new Set(['○', '◯', '〇', '×', '✕', 'true', 'false', 'yes', 'no', 'y', 'n', 'on', 'off']);

export const boolean = {
  type: 'boolean',
  label: '真偽値',
  hint: /有無|可否|要否|済|フラグ|flag|会員|対象|^is_|^has_/i,
  // 一部だけ一致する列（「有・無・要確認」など）は真偽値にしない
  minRatio: 0.95,
  match: (v) => TRUE.has(v.toLowerCase()) || FALSE.has(v.toLowerCase()),
  normalize(v, ctx = {}) {
    const k = v.toLowerCase();
    if (!TRUE.has(k) && !FALSE.has(k)) return null;
    const confidence = SYMBOLIC.has(k) || ctx.hinted ? 1 : 0.8;
    return { value: TRUE.has(k), confidence, note: confidence < 1 ? '言葉を真偽値に変換（列名から真偽値と判断できないため提案）' : '真偽値に変換' };
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

const GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

function parseNumber(v) {
  let s = v.replace(/[¥\\$円]/g, '').replace(/[−ー]/g, '-').trim();
  let sign = 1;
  if (/^[△▲]/.test(s)) {
    sign = -1;
    s = s.slice(1);
  } else if (/^\(.+\)$/.test(s)) {
    // 「(1)」「(2)」のような番号と区別するため、3桁以上か桁区切りがあるものだけ
    if (!/^\((\d{3,}|[\d,]*,\d{3})(\.\d+)?\)$/.test(s)) return null;
    sign = -1;
    s = s.slice(1, -1);
  }
  // 桁区切りのカンマは3桁ごとのものだけ（「1, 2」「1,2,3」は数値にしない）
  if (s.includes(',')) {
    if (!GROUPED.test(s.replace(/^-/, ''))) return null;
    s = s.replace(/,/g, '');
  }
  if (sign < 0 && s.startsWith('-')) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    // 先頭が0の「0012」はコードとみなす（「0」「0.5」は数値）
    if (/^-?0\d/.test(s)) return null;
    // 精度が落ちる大きな整数（口座番号など）は数値にしない
    if (/^-?\d{16,}$/.test(s) && !Number.isSafeInteger(Number(s))) return null;
    return sign * Number(s);
  }

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
    const note = n < 0 && /[△▲(]/.test(v) ? '会計表記のマイナスを変換' : /[億万千]/.test(v) ? '単位付きの数を変換' : '記号・桁区切りを除いて数値に変換';
    return { value: n, confidence: 1, note };
  },
};
