// 構造のないテキストから表を取り出す。次の順に試し、当てはまったものを使う。
//
//   keyvalue … 「氏名：山田」のような行のまとまり。空行（または同じ項目の再登場）で1件を区切る
//   aligned  … 2つ以上の空白・全角空白・タブで列をそろえた表
//   extract  … どれにも当てはまらない文章。行（または空行で区切ったまとまり）ごとに、
//              日付・電話番号・郵便番号・メール・URL・金額を抜き出し、残りを「本文」にする
//
// 区切り文字の表（CSV・TSV）は呼び出し元が先に判定する。

const KV = /^\s*(?:[■●◆・*-]\s*)?(?:【([^】]{1,20})】\s*|([^:：\t]{1,20}?)\s*[:：]\s*)(.*)$/;
const URL_RE = /https?:\/\/[^\s<>"'）)」]+/g;

// 抜き出す値。順番に試し、見つけた部分は本文から取り除く（重なりを避ける）
const ENTITIES = [
  ['URL', URL_RE],
  ['メール', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  // 電話番号は郵便番号より先に探す（「011-123-4567」の後半を郵便番号と取り違えないように）
  ['電話番号', /(?:TEL|Tel|tel|電話)?[:：]?\s*(?<![\d.])(?:\+81[\s-]?|0)\d{1,4}[-‐ー−(（\s]\d{1,4}[-‐ー−)）\s]\d{3,4}|\b0[5789]0\d{8}\b/g],
  ['郵便番号', /〒\s*\d{3}[-‐ー−]?\d{4}|(?<![\d\-‐ー−(（])\d{3}[-‐ー−]\d{4}(?![-‐ー−]?\d)/g],
  ['日付', /(?:明治|大正|昭和|平成|令和|[MTSHR])\s*(?:元|\d{1,2})\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?|\d{4}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?(?:\s*\d{1,2}:\d{2})?/g],
  ['金額', /[¥￥]\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*(?:万|千)?円/g],
];

const lines = (text) => text.replace(/\r\n?/g, '\n').split('\n');

// 「項目：値」の行か。時刻（9:05）や URL（https://）のコロンは区切りとみなさない
function kvMatch(line) {
  const m = line.match(KV);
  if (!m) return null;
  const key = (m[1] ?? m[2]).trim();
  if (!m[1] && ((/\d$/.test(key) && /^\d/.test(m[3])) || /^https?$/i.test(key) || /^\d+$/.test(key))) return null;
  return { key, value: m[3].trim() };
}

function keyValue(text) {
  const ls = lines(text);
  const nonEmpty = ls.filter((l) => l.trim());
  const kv = nonEmpty.filter((l) => kvMatch(l));
  if (nonEmpty.length < 2 || kv.length < nonEmpty.length * 0.6 || kv.length < 2) return null;

  const records = [];
  let cur = null;
  let lastKey = null;
  for (const l of ls) {
    if (!l.trim()) {
      cur = null; // 空行で1件を区切る
      continue;
    }
    const m = kvMatch(l);
    if (m) {
      // 同じ項目がもう一度出てきたら、次の1件の始まりとみなす
      if (!cur || cur.has(m.key)) records.push((cur = new Map()));
      cur.set(m.key, m.value);
      lastKey = m.key;
    } else if (cur && lastKey) {
      cur.set(lastKey, `${cur.get(lastKey)}\n${l.trim()}`); // 続きの行
    }
  }
  const columns = [...new Set(records.flatMap((r) => [...r.keys()]))];
  if (!records.length) return null;
  return { columns, rows: records.map((r) => columns.map((c) => r.get(c) ?? '')), how: `項目：値（${records.length}件）` };
}

function aligned(text) {
  const ls = lines(text).filter((l) => l.trim());
  if (ls.length < 3) return null;
  const split = (l) => l.trim().split(/ {2,}|　+|\t+/);
  const widths = ls.map((l) => split(l).length);
  const width = widths[0];
  if (width < 2 || widths.filter((w) => w === width).length < ls.length * 0.8) return null;
  const rows = ls.map(split).filter((r) => r.length === width);
  return { columns: rows[0], rows: rows.slice(1), how: '空白でそろえた表' };
}

function extract(text) {
  const ls = lines(text);
  // 空行で区切ったまとまりがあり、まとまりが複数行なら、まとまりを1件にする
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const units = blocks.length > 1 && blocks.some((b) => b.includes('\n')) ? blocks : ls.map((l) => l.trim()).filter(Boolean);

  const records = units.map((unit) => {
    const rec = new Map();
    let rest = unit;
    for (const [name, re] of ENTITIES) {
      for (const m of rest.matchAll(re)) {
        let key = name;
        for (let n = 2; rec.has(key); n++) key = `${name}_${n}`;
        rec.set(key, m[0].trim());
      }
      rest = rest.replace(re, ' ');
    }
    rest = rest.replace(/[(（「]\s*[)）」]/g, ' ').replace(/[ \t]+/g, ' ').replace(/^[\s、。,.:：・\-|/]+|[\s、。,.:：・\-|/]+$/g, '').replace(/\s*\n\s*/g, '\n');
    if (rest) rec.set('本文', rest);
    return rec;
  });

  const found = records.filter((r) => [...r.keys()].some((k) => k !== '本文')).length;
  if (found < records.length * 0.5) return null;
  const columns = ['本文', ...ENTITIES.map(([n]) => n)].flatMap((n) =>
    [...new Set(records.flatMap((r) => [...r.keys()]))].filter((k) => k === n || k.startsWith(`${n}_`)),
  );
  return { columns, rows: records.map((r) => columns.map((c) => r.get(c) ?? '')), how: `文章から抜き出し（${records.length}件）` };
}

// 1行に値が1つだけの「1列の表」（見出し＋値の並び）かどうか。抜き出しにすると見出しが本文になってしまう
function singleColumn(text) {
  const ls = lines(text).map((l) => l.trim()).filter(Boolean);
  if (ls.length < 2) return true;
  const body = ls.slice(1);
  return body.every((l) => ENTITIES.some(([, re]) => (l.match(re) ?? [])[0]?.trim() === l) || !/\s/.test(l));
}

export function readText(text, { allowExtract = true } = {}) {
  const kv = keyValue(text);
  if (kv) return kv;
  const al = aligned(text);
  if (al) return al;
  if (allowExtract && !singleColumn(text)) return extract(text);
  return null;
}
