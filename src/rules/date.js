import { HYPHENS } from './common.js';

// 元号の期間（西暦）。範囲外の日付（「令和元年4月1日」など）は提案にとどめる
const ERAS = {
  明治: { year: 1868, from: '1868-01-25', to: '1912-07-29' },
  大正: { year: 1912, from: '1912-07-30', to: '1926-12-24' },
  昭和: { year: 1926, from: '1926-12-25', to: '1989-01-07' },
  平成: { year: 1989, from: '1989-01-08', to: '2019-04-30' },
  令和: { year: 2019, from: '2019-05-01', to: '9999-12-31' },
};
const ABBR = { M: '明治', T: '大正', S: '昭和', H: '平成', R: '令和' };

const TIME = '(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';
const WESTERN = new RegExp(`^(\\d{4})\\s*[/.\\-年]\\s*(\\d{1,2})\\s*[/.\\-月]\\s*(\\d{1,2})\\s*日?${TIME}$`);
const WAREKI = /^(明治|大正|昭和|平成|令和|[MTSHR])\s*(元|\d{1,2})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?$/i;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const SERIAL = /^\d{5}$/;

function toISO(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parse(v, ctx = {}) {
  // 曜日（「2024/4/1(月)」）は取り除いて読む
  const s = v.replace(HYPHENS, '-').replace(/\s*[(（][月火水木金土日](?:曜日?)?[)）]/, '').trim();
  let m;

  if ((m = s.match(WESTERN))) {
    const iso = toISO(+m[1], +m[2], +m[3]);
    if (!iso) return null;
    if (m[4] === undefined) return { value: iso, confidence: 1, note: '西暦の表記を統一' };
    if (+m[4] > 23 || +m[5] > 59 || +(m[6] ?? 0) > 59) return null;
    const time = `${m[4].padStart(2, '0')}:${m[5]}${m[6] ? `:${m[6]}` : ''}`;
    return { value: `${iso} ${time}`, confidence: 1, note: '日時の表記を統一' };
  }

  if ((m = s.match(WAREKI))) {
    const name = m[1].length === 1 ? ABBR[m[1].toUpperCase()] : m[1];
    const era = ERAS[name];
    const n = m[2] === '元' ? 1 : +m[2];
    if (n < 1) return null;
    const iso = toISO(era.year + n - 1, +m[3], +m[4]);
    if (!iso) return null;
    if (iso < era.from || iso > era.to) {
      return { value: iso, confidence: 0.6, note: `${name}${m[2]}年${+m[3]}月${+m[4]}日は${name}の期間外のため提案にとどめる` };
    }
    return { value: iso, confidence: 1, note: `和暦（${name}）を西暦に変換` };
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
  // 「日数」「日当」「日額」は日付ではないので、「日」で終わる列名だけを対象にする
  hint: /date|日付|日時|年月|期限|期日|誕生|(?:^|[^数当額])日$/i,
  match: (v, ctx) => parse(v, ctx) !== null,
  normalize: parse,
};
