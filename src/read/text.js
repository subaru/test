// 構造のないテキストから表を取り出す。区切り文字の表（CSV・TSV）は呼び出し元が先に判定する。
// 次の順に試し、当てはまったものを使う。どれにも当てはまらなければ null（呼び出し元が1列のCSVとして読む）。
//
//   keyvalue … 「氏名：山田」のような行のまとまり（問い合わせメール・フォームの通知など）
//   aligned  … 2つ以上の空白・全角空白・タブで列をそろえた表
//   extract  … 文章。行（または空行で区切ったまとまり）ごとに、日付・電話番号・郵便番号・
//              メール・URL・金額を抜き出し、残りを「本文」にする
//   prose    … 抜き出すものもない文章。1行（まとまり）を1件の「本文」にする
//
// 正規表現は、長い行でも時間が行の長さに比例するよう、連続した文字の途中から一致を始めない形にしている。

const KV = /^(?:[■●◆□○・*]\s*)?(?:【([^】]{1,20})】\s*|([^:：\t,;|【】]{1,20}?)\s*[:：]\s*)(.*)$/;

const SEP = '[-‐ー−]';
const PHONE = new RegExp(
  [
    `(?:\\+81[ -]?|0)\\d{1,4}${SEP}\\d{1,4}${SEP}\\d{3,4}`, // 03-1234-5678
    `[(（](?:\\+81[ -]?|0)\\d{1,4}[)）] ?\\d{1,4}${SEP}\\d{3,4}`, // (03)1234-5678
    `(?:\\+81[ -]?|0)\\d{1,4}[(（]\\d{1,4}[)）]\\d{3,4}`, // 03(1234)5678
    '0[5789]0 \\d{4} \\d{4}', // 090 1234 5678
    '0[5789]0\\d{8}', // 09012345678
  ]
    .map((p) => `(?:${p})`)
    .join('|'),
);

// 抜き出す値。順番に試し、見つけた部分は本文から取り除く（重なりを避ける）
const ENTITIES = [
  ['URL', /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]+[A-Za-z0-9\-_~/#=&%]/g],
  ['メール', /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  // 日付は電話番号より先に（「2024-04-01」の一部を電話番号にしない）。曜日と秒も含める
  [
    '日付',
    /(?:(?:明治|大正|昭和|平成|令和)\s*(?:元|\d{1,2})|(?<![A-Za-z])[MTSHR](?:元|\d{1,2}))\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}(?:\s*日)?(?:\s*[(（][月火水木金土日](?:曜日?)?[)）])?|(?<!\d)\d{4}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}(?:\s*日)?(?:\s*[(（][月火水木金土日](?:曜日?)?[)）])?(?:(?:\s+|T)\d{1,2}:\d{2}(?::\d{2})?)?/g,
  ],
  // 電話番号は郵便番号より先に（「011-123-4567」の後半を郵便番号と取り違えないように）。
  // 時刻・日付・数字の続きの途中からは始めない
  ['電話番号', new RegExp(`(?<![\\w.:：/\\-‐ー−])(?:${PHONE.source})(?![\\d\\-‐ー−])`, 'g')],
  ['郵便番号', /〒\s*\d{3}[-‐ー−]?\d{4}|(?<![\d\-‐ー−(（])\d{3}[-‐ー−]\d{4}(?![-‐ー−]?\d)/g],
  ['金額', /[¥￥]\s*\d[\d,]*(?:\.\d+)?|(?<![\d,.])\d[\d,]*(?:\.\d+)?\s*(?:万|千)?円/g],
];
// 値を抜き出した後に残る見出し（「TEL：」など）
const LEFTOVER_LABELS = /(?:TEL|Tel|tel|FAX|Fax|電話|携帯|メール|Mail|mail|URL)\s*[:：]?\s*(?=\s|$|[、。,])/g;

const lines = (text) => text.replace(/\r\n?/g, '\n').split('\n');

// 「項目：値」の行か。時刻（受付 9:05）・URL（https://）・数字だけの項目のコロンは区切りとみなさない
function kvMatch(line) {
  const m = line.trim().match(KV);
  if (!m) return null;
  const key = (m[1] ?? m[2]).trim();
  const value = m[3].trim();
  if (!m[1]) {
    if (/^\d+$/.test(key)) return null;
    if (/(?:^|[\s　〜~(（])\d{1,2}$/.test(key) && /^\d{2}/.test(value)) return null; // 時刻
    if (/https?$/i.test(key) && value.startsWith('//')) return null; // URL
  }
  return { key, value };
}

// メールの引用（> …）・署名（-- 以降）・区切り線を取り除く。区切り線は空行として扱う
function stripMail(text) {
  const out = [];
  let signature = false;
  for (const l of lines(text)) {
    const t = l.trim();
    if (/^--\s*$/.test(t)) {
      signature = true;
      continue;
    }
    if (signature) {
      if (!t) signature = false;
      continue;
    }
    if (/^>/.test(t)) continue;
    out.push(/^[=\-_*～〜━─―]{3,}$/.test(t) ? '' : l);
  }
  return out;
}

function keyValue(text) {
  const ls = stripMail(text);
  const nonEmpty = ls.filter((l) => l.trim());
  if (nonEmpty.length < 2) return null;

  // 項目：値の行と、その続きの行（項目のない行）の割合
  let kv = 0;
  let covered = 0;
  let inRecord = false;
  const keys = [];
  for (const l of ls) {
    if (!l.trim()) continue;
    const m = kvMatch(l);
    if (m) {
      kv++;
      covered++;
      keys.push(m.key);
      inRecord = true;
    } else if (inRecord) covered++;
  }
  if (kv < 2 || covered < nonEmpty.length * 0.6) return null;

  // 1列のCSV（「備考」の下に「注意：…」が並ぶ）と区別するため、構造がはっきりしている場合だけ：
  //   1行目が「項目：値」／項目が2種類以上あり、どれかが繰り返し出てくる／空行で区切った複数のまとまり
  const distinct = new Set(keys);
  const repeated = distinct.size >= 2 && distinct.size < keys.length;
  const firstIsKV = !!kvMatch(nonEmpty[0]);
  const blocks = ls.join('\n').split(/\n\s*\n/).filter((b) => b.split('\n').filter((l) => kvMatch(l)).length >= 2).length;
  if (!firstIsKV && !repeated && blocks < 2) return null;

  const records = [];
  let cur = null;
  let lastKey = null;
  let gap = false;
  for (const l of ls) {
    if (!l.trim()) {
      gap = true;
      continue;
    }
    const m = kvMatch(l);
    if (m) {
      // 空行の後、または同じ項目がもう一度出てきたら、次の1件の始まり
      if (!cur || (gap && distinct.size > 1) || cur.has(m.key)) records.push((cur = new Map()));
      cur.set(m.key, m.value);
      lastKey = m.key;
    } else if (cur && lastKey) {
      // 項目のない行は、直前の値の続き（空行をはさんだ段落も含める）
      const prev = cur.get(lastKey);
      cur.set(lastKey, prev ? `${prev}\n${gap ? '\n' : ''}${l.trim()}` : l.trim());
    }
    gap = false;
  }
  if (!records.length) return null;

  // 項目が1つだけの断片（署名の「TEL：…」など）は、直前の1件に含める（捨てない）
  const sizes = records.map((r) => r.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  for (let i = records.length - 1; i > 0; i--) {
    const r = records[i];
    const prev = records[i - 1];
    if (median >= 3 && r.size === 1 && ![...r.keys()].some((k) => prev.has(k))) {
      for (const [k, v] of r) prev.set(k, v);
      records.splice(i, 1);
    }
  }
  const columns = [...new Set(records.flatMap((r) => [...r.keys()]))];
  return { columns, rows: records.map((r) => columns.map((c) => r.get(c) ?? '')), how: `項目：値（${records.length}件）` };
}

// 表示上の幅（全角は2）。等幅フォントで列をそろえた表の、列の位置を求めるのに使う
const displayWidth = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1), 0);

// 2つ以上の空白・全角空白・タブで区切った値と、その開始位置
function tokens(line) {
  const out = [];
  for (const m of line.matchAll(/[^\s　]+(?: [^\s　]+)*/g)) out.push({ text: m[0], col: displayWidth(line.slice(0, m.index)) });
  return out;
}

function aligned(text) {
  const ls = lines(text).filter((l) => l.trim());
  if (ls.length < 3) return null;
  const head = tokens(ls[0]);
  if (head.length < 2) return null;
  const widths = ls.map((l) => tokens(l).length);
  // 空欄のある行は値が少なくなるので、見出しの数以下の行が大半で、見出しと同じ数の行が半分以上あること
  if (widths.filter((w) => w === head.length).length < ls.length * 0.5 || widths.some((w) => w > head.length)) return null;

  // 値の開始位置から、どの列に入るかを決める（空欄があってもずれない）
  const rows = ls.slice(1).map((l) => {
    const row = Array(head.length).fill('');
    for (const t of tokens(l)) {
      let c = 0;
      while (c + 1 < head.length && head[c + 1].col <= t.col + 1) c++;
      row[c] = row[c] ? `${row[c]} ${t.text}` : t.text;
    }
    return row;
  });
  return { columns: head.map((h) => h.text), rows, how: '空白でそろえた表' };
}

function entities(unit) {
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
  rest = rest
    .replace(LEFTOVER_LABELS, ' ')
    .replace(/[(（「]\s*[)）」]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[\s、。,.:：・\-|/]+|[\s、。,.:：・\-|/]+$/g, '')
    .replace(/\s*\n\s*/g, '\n');
  return { rec, rest };
}

function units(text) {
  // 空行で区切ったまとまりがあり、まとまりが複数行なら、まとまりを1件にする
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.length > 1 && blocks.some((b) => b.includes('\n')) ? blocks : lines(text).map((l) => l.trim()).filter(Boolean);
}

// 1行が丸ごと1つの値（日付だけ・金額だけ）の行。1列の表の値によくある
const wholeValue = (line) => ENTITIES.some(([, re]) => (line.match(re) ?? [])[0]?.trim() === line);

function extract(text) {
  const ls = lines(text).map((l) => l.trim()).filter(Boolean);
  // 値と文章が混ざった行が半分以上あること（値だけの行が並ぶのは1列の表）
  const mixed = ls.filter((l) => !wholeValue(l) && entities(l).rec.size > 0).length;
  if (mixed < ls.length * 0.5) return null;

  const records = units(text).map((u) => {
    const { rec, rest } = entities(u);
    if (rest) rec.set('本文', rest);
    return rec;
  });
  const all = [...new Set(records.flatMap((r) => [...r.keys()]))];
  const columns = ['本文', ...ENTITIES.map(([n]) => n)].flatMap((n) => all.filter((k) => k === n || k.startsWith(`${n}_`)));
  return { columns, rows: records.map((r) => columns.map((c) => r.get(c) ?? '')), how: `文章から抜き出し（${records.length}件）` };
}

// 文章らしいか：句点で終わる行や長い行が大半で、1行目が短い見出しではない
function prose(text) {
  const ls = lines(text).map((l) => l.trim()).filter(Boolean);
  if (ls.length < 2) return null;
  const sentence = (l) => /[。！？!?]$/.test(l) || displayWidth(l) >= 40;
  if (!sentence(ls[0]) || ls.filter(sentence).length < ls.length * 0.6) return null;
  const us = units(text);
  return { columns: ['本文'], rows: us.map((u) => [u]), how: `文章（${us.length}件）` };
}

export function readText(text) {
  return keyValue(text) ?? aligned(text) ?? extract(text) ?? prose(text);
}
