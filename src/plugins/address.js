// 住所の正規化プラグイン。
//
//   import { tidy } from 'nihon-tidy';
//   import address from 'nihon-tidy/address';
//   await tidy(file, { plugins: [address()] });   // 文字列で plugins: ['address'] とも書ける
//
// 辞書を持たない軽量版。「確実に分かる形だけを変える」方式で、迷う書き方はそのまま残す。できること：
//   - 表記の統一：町名のあとの番地の部分が、全体として「4丁目6番16号」「十二番地」「123番地の4」「1ー2ー3」などの
//     決まった形のときだけ「4-6-16」の形にする（後ろに建物名などが空白なしで続くなら変えない）。〒の書式
//   - 都道府県の補完：政令指定都市と、ほかの都市と名前が重ならない東京23区から補う（提案にとどめる）
//   - 都道府県名の誤り（「東京府」など）を要確認にする
//   - parseAddress() で 郵便番号・都道府県・市区町村・それ以降 に分ける
// 市区町村の実在の確認や、全国の市町村からの都道府県の補完には、辞書を持つ専用のライブラリを組み合わせる。

import { clean } from '../rules/common.js';

export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
  '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

// 政令指定都市 → 都道府県
const DESIGNATED = {
  札幌市: '北海道', 仙台市: '宮城県', さいたま市: '埼玉県', 千葉市: '千葉県', 横浜市: '神奈川県',
  川崎市: '神奈川県', 相模原市: '神奈川県', 新潟市: '新潟県', 静岡市: '静岡県', 浜松市: '静岡県',
  名古屋市: '愛知県', 京都市: '京都府', 大阪市: '大阪府', 堺市: '大阪府', 神戸市: '兵庫県',
  岡山市: '岡山県', 広島市: '広島県', 北九州市: '福岡県', 福岡市: '福岡県', 熊本市: '熊本県',
};
// 東京23区のうち、政令指定都市の区と名前が重ならないもの（中央区・港区・北区は除く）
const TOKYO_WARDS = ['千代田区', '新宿区', '文京区', '台東区', '墨田区', '江東区', '品川区', '目黒区', '大田区', '世田谷区', '渋谷区', '中野区', '杉並区', '豊島区', '荒川区', '板橋区', '練馬区', '足立区', '葛飾区', '江戸川区'];

// 名前に「市・町・村」を含む市町村（「四日市市」を「四日市」で切らないように）
const TRICKY_CITIES = ['四日市市', '廿日市市', '野々市市', '市原市', '市川市', '大町市', '十日町市', '町田市', '村山市', '東村山市', '武蔵村山市', '大村市', '羽村市', '村上市', '田村市', '東大和市', '大和市', '郡山市', '大和郡山市', '郡上市', '市貝町', '上市町', '下市町', '玉村町', '大町町', '中村区', '余市町'];

const KANJI_DIGITS = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// 漢数字（〜九十九、百・千を含む）を数に。伏せ字の「〇〇」や空の文字列は null
const KANJI_RE = new RegExp(`^(?:${'[一二三四五六七八九][〇一二三四五六七八九]*|(?=[一二三四五六七八九十百千])(?:[二三四五六七八九]?千)?(?:[二三四五六七八九]?百)?(?:[二三四五六七八九]?十)?[一二三四五六七八九]?'})$`);

export function kanjiToNumber(s) {
  if (s === '〇') return 0;
  // 崩れた書き方（「十〇」「十一一」「十十」）や伏せ字は数にしない
  if (!s || !KANJI_RE.test(s)) return null;
  if (/^[〇一二三四五六七八九]+$/.test(s) && s.length > 1) return Number([...s].map((c) => KANJI_DIGITS[c]).join(''));
  let total = 0;
  let cur = 0;
  for (const c of s) {
    if (c in KANJI_DIGITS) cur = KANJI_DIGITS[c];
    else {
      const unit = { 十: 10, 百: 100, 千: 1000 }[c];
      if (!unit) return null;
      total += (cur || 1) * unit;
      cur = 0;
    }
  }
  return total + cur;
}

const PREF_RE = new RegExp(`^(${PREFECTURES.join('|')})`);
// 都道府県らしいが一覧にないもの（「東京府」「大坂府」など）。
// 「大阪市都島区」「横浜市都筑区」「太宰府市」「松山市道後」は、市区町村名の一部なので含めない
const PREF_LIKE = /^([^\s\d市区町村郡]{2,3}[都道府県])(?![市区町村])/;

// 郡のあとの町村名に「町・村」を含むもの（「杵島郡大町町」を「杵島郡大町」で切らないように）
const TRICKY_TOWNS = ['大町町', '玉村町', '市貝町', '上市町', '下市町', '中村町'];
// 名前の長さに上限を付けて、長い文でも時間がかからないようにする
const N = '[^\\s\\d]{1,12}?';
const CITY_RE = new RegExp(`^(${TRICKY_CITIES.join('|')}|${N}郡(?:${TRICKY_TOWNS.join('|')})|${N}郡${N}[町村]|${N}市${N}区|${N}[市区町村])`);

const POSTAL = /^〒?\s*(\d{3})-?(\d{4})\s*/;

// 住所を分ける。分けられない部分は rest に残す
export function parseAddress(value) {
  // 郵便番号の「ー」（長音記号）などもハイフンとして読む
  let s = String(value).trim().replace(/^(〒?\s*\d{3})[‐‑‒–—―−ー－](\d{4})/, '$1-$2');
  const out = { postal: null, prefecture: null, city: null, rest: '' };
  const postal = s.match(POSTAL);
  // 〒がなければ、郵便番号のあとに都道府県が続く場合だけ郵便番号とみなす
  if (postal && (s.startsWith('〒') || PREF_RE.test(s.slice(postal[0].length)))) {
    out.postal = `${postal[1]}-${postal[2]}`;
    s = s.slice(postal[0].length);
  }
  const pref = s.match(PREF_RE);
  if (pref) {
    out.prefecture = pref[1];
    s = s.slice(pref[1].length).trim();
  }
  const city = s.match(CITY_RE);
  if (city) {
    out.city = city[1];
    s = s.slice(city[1].length).trim();
  }
  out.rest = s;
  return out;
}

// 番地の数：アラビア数字か、正しい書き方の漢数字だけ。
//   位取りの書き方（一二・二〇）か、十・百・千を使う書き方（十二・二十三・百五）。
//   「十〇」「十一一」「十十」のような崩れた書き方や、伏せ字の「〇」で始まるものは数とみなさない
const KANJI = '[一二三四五六七八九][〇一二三四五六七八九]*|(?=[一二三四五六七八九十百千])(?:[二三四五六七八九]?千)?(?:[二三四五六七八九]?百)?(?:[二三四五六七八九]?十)?[一二三四五六七八九]?';
const NUM = `(\\d+|${KANJI})`;
const HY = '[-‐‑‒–—―−ー－]';
// 番地の部分の決まった形。部分全体がどれかに一致したときだけ変える（並びは試す順）
const BLOCKS = [
  [new RegExp(`^${NUM}丁目${NUM}(?:番地?の?|${HY}|の)${NUM}(?:号)?$`), (a, b, c) => `${a}-${b}-${c}`],
  [new RegExp(`^${NUM}丁目${NUM}(?:番地?|号)$`), (a, b) => `${a}-${b}`],
  [new RegExp(`^${NUM}丁目$`), (a) => `${a}丁目`],
  [new RegExp(`^${NUM}番地?(?:の|${HY})?${NUM}(?:号)?$`), (a, b) => `${a}-${b}`],
  [new RegExp(`^${NUM}番地$`), (a) => `${a}`],
  [new RegExp(`^${NUM}(?:${HY}|の)${NUM}(?:(?:${HY}|の)${NUM})?(?:(?:${HY}|の)${NUM})?$`), (...n) => n.filter(Boolean).join('-')],
  [/^(\d+)$/, (a) => a],
];
// 番地らしい（丁目・番・号かハイフンを含む）形。都道府県のない値を住所と判定するのに使う
const STRUCTURED = new Set([0, 1, 2, 3, 4, 5]);

const isKanji = (n) => n !== undefined && !/^\d+$/.test(n);
// 「番」の書き方（N番N）で、漢数字とアラビア数字が区切りなしに並ぶもの（「麻布十番2」）は町名の一部の可能性が高い
const MIXED_BAN = 3;

const toNumber = (n) => (n === undefined || /^\d+$/.test(n) ? n : String(kanjiToNumber(n) ?? n));

// 町名と番地を分ける：先頭から順に、そこから最初の空白までが決まった形の番地になる位置を探す
export function splitBlock(rest) {
  const space = rest.search(/\s/);
  const head = space < 0 ? rest : rest.slice(0, space);
  const tail = space < 0 ? '' : rest.slice(space);
  if (head.length > 80) return null;
  for (let i = 0; i < head.length; i++) {
    // 数の途中（アラビア数字・漢数字の続き）からは始めない（「十一一」を「一一」から読まない）
    if (!/[\d一二三四五六七八九十百千]/.test(head[i]) || /[\d〇一二三四五六七八九十百千]/.test(head[i - 1] ?? '')) continue;
    const block = head.slice(i);
    for (let k = 0; k < BLOCKS.length; k++) {
      const m = block.match(BLOCKS[k][0]);
      if (!m) continue;
      if (k === MIXED_BAN && isKanji(m[1]) !== isKanji(m[2])) break; // この位置からは番地とみなさない
      const normalized = BLOCKS[k][1](...m.slice(1).map(toNumber));
      // 番地が完結しているか（号で終わる・3つ以上の数）。完結していれば、空白のあとの部屋番号は番地の続きではない
      const complete = /号$/.test(block) || normalized.split('-').length >= 3;
      return { town: head.slice(0, i), block, normalized, structured: STRUCTURED.has(k), complete, tail };
    }
  }
  return null;
}

// 町名のあとの番地を「4-6-16」の形にする。決まった形でなければ、何も変えない
export function normalizeBlock(rest) {
  const b = splitBlock(rest);
  if (!b) return rest;
  // 空白のあとが「先・付近・内・外」なら、番地と一体の言葉なので変えない（「12番地 先」）
  if (/^\s+(?:地?先|付近|地?内|外|ほか)/.test(b.tail)) return rest;
  // 番地が完結していないのに、空白のあとが数の続き（「1丁目2番 3号」「12番地 3」「1丁目2番 3-4」）なら変えない。
  // 完結していれば（「四丁目6番16号 301」「1-2-3 101」）、空白のあとは部屋番号などなので番地だけ揃える
  if (!b.complete && /^\s+(?:\d+|[一二三四五六七八九十百千]+)(?:[-の]\d+)*(?:号|番地?)?(?:\s|$)/.test(b.tail)) return rest;
  return b.town + b.normalized + b.tail;
}

// 都道府県のない値を住所と言えるのは、「〜市」「〜区」のあとに町名と、丁目・番・ハイフンを含む番地が続くもの
// （「中村1」「港区みなと祭り2024」「新宿区1号店」のような名前を住所にしないため）
function looksLikeAddress(a, hinted) {
  const b = splitBlock(a.rest);
  // 都道府県があっても、市区町村がなければ住所としない（「東京都大会2024」「北海道日本ハムファイターズ2024」）
  if (a.prefecture) return a.city ? !!b : !!(hinted && !a.rest);
  if (!a.city || !/[市区]$/.test(a.city)) return false;
  return !!(b && b.town && b.structured);
}

function parse(raw) {
  const v = clean(raw);
  const a = parseAddress(v);
  if (!a.prefecture && !a.city) return null;

  if (!a.prefecture) {
    // 「東京府」「大坂府」など、都道府県らしいが一覧にない名前は解釈しない（要確認に挙げる）
    const wrong = v.replace(POSTAL, '').match(PREF_LIKE);
    if (wrong && !PREFECTURES.includes(wrong[1])) return null;
  }

  // 番地を揃えるのは市区町村がある場合だけ（「東京都選抜1の2」のような名前を変えない）
  const rest = a.city ? normalizeBlock(a.rest) : a.rest;
  const join = (pref) => {
    const body = `${pref ?? ''}${a.city ?? ''}${rest}`;
    return a.postal ? `〒${a.postal} ${body}` : body;
  };
  const value = join(a.prefecture);
  const note = rest !== a.rest ? '丁目・番地の表記を統一' : '住所の表記を統一';
  const result = { value, confidence: 1, note, parts: { ...a, rest } };

  // 都道府県の補完は、住所と言える形のときだけ、別の提案にする（番地の統一は確実なので先に適用する）
  if (!a.prefecture && looksLikeAddress(a, false)) {
    const guess = DESIGNATED[a.city?.match(/^[^\s\d]+?市/)?.[0]] ?? (TOKYO_WARDS.includes(a.city) ? '東京都' : null);
    if (guess) result.suggest = { value: join(guess), confidence: 0.8, note: `都道府県（${guess}）を市区名から補った` };
  }
  return result;
}

export const addressRule = {
  type: 'address',
  label: '住所',
  hint: /住所|所在地|address|addr|送付先|届け先/i,
  match: (v, ctx = {}) => looksLikeAddress(parseAddress(clean(v)), ctx.hinted),
  normalize: parse,
};

export default function address() {
  return { name: 'address', rules: [addressRule] };
}
