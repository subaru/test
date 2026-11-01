import { HYPHENS } from './common.js';

// 元号の開始年（西暦）
const ERAS = {
  明治: 1868, M: 1868,
  大正: 1912, T: 1912,
  昭和: 1926, S: 1926,
  平成: 1989, H: 1989,
  令和: 2019, R: 2019,
};

const WESTERN = /^(\d{4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?$/;
const WAREKI = /^(明治|大正|昭和|平成|令和|[MTSHR])\s*(元|\d{1,2})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?$/i;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const SERIAL = /^\d{5}$/;

function toISO(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parse(v, ctx = {}) {
  const s = v.replace(HYPHENS, '-');
  let m;

  if ((m = s.match(WESTERN))) {
    const iso = toISO(+m[1], +m[2], +m[3]);
    return iso && { value: iso, confidence: 1, note: '西暦の表記を統一' };
  }

  if ((m = s.match(WAREKI))) {
    const start = ERAS[m[1].length === 1 ? m[1].toUpperCase() : m[1]];
    const n = m[2] === '元' ? 1 : +m[2];
    const iso = toISO(start + n - 1, +m[3], +m[4]);
    return iso && { value: iso, confidence: 1, note: `和暦（${m[1]}）を西暦に変換` };
  }

  // 区切りのない8桁・Excelのシリアル値は、数値と紛らわしいので列名に「日付」らしさがある場合だけ
  if (ctx.hinted && (m = s.match(COMPACT))) {
    const iso = toISO(+m[1], +m[2], +m[3]);
    return iso && { value: iso, confidence: 0.9, note: '区切りのない8桁を日付として解釈' };
  }

  if (ctx.hinted && SERIAL.test(s)) {
    const n = +s;
    if (n < 20000 || n > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return {
      value: dt.toISOString().slice(0, 10),
      confidence: 0.8,
      note: 'Excelのシリアル値を日付に変換',
    };
  }

  return null;
}

export default {
  type: 'date',
  label: '日付',
  hint: /日|date|年月|期限|誕生/i,
  match: (v, ctx) => parse(v, ctx) !== null,
  normalize: parse,
};
