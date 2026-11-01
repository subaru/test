// 住所の正規化プラグイン。
//
//   import { tidy } from 'nihon-tidy';
//   import address from 'nihon-tidy/address';
//   await tidy(file, { plugins: [address()] });   // 文字列で plugins: ['address'] とも書ける
//
// 辞書を持たない軽量版。できること：
//   - 表記の統一：「銀座四丁目6番16号」→「銀座4-6-16」、「1ー2ー3」→「1-2-3」、〒の書式
//   - 都道府県の補完：政令指定都市と、ほかの都市と名前が重ならない東京23区から補う（提案にとどめる）
//   - 都道府県名の誤り（「東京府」など）を要確認にする
//   - parseAddress() で 郵便番号・都道府県・市区町村・それ以降 に分ける
// 市区町村の実在の確認や、全国の市町村からの都道府県の補完には、辞書を持つ専用のライブラリを組み合わせる。

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
const TRICKY_CITIES = ['四日市市', '廿日市市', '野々市市', '市原市', '市川市', '大町市', '十日町市', '町田市', '村山市', '東村山市', '武蔵村山市', '大村市', '羽村市', '村上市', '田村市', '東大和市', '大和市', '郡山市', '大和郡山市', '郡上市', '市貝町', '上市町', '下市町', '玉村町', '大町町', '中村区'];

const KANJI_DIGITS = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// 漢数字（〜九十九、百・千を含む）を数に。伏せ字の「〇〇」や空の文字列は null
export function kanjiToNumber(s) {
  if (!s || /^〇/.test(s)) return s === '〇' ? 0 : null;
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

const KANJI_NUM = '[〇一二三四五六七八九十百千]+';
// 号のあとに続くと「号室・号館」などになる文字。番地の「号」として扱わない
const NOT_GO = '(?![室館棟車線機])';

// 丁目・番地・号の表記を「4-6-16」の形にする。
// 空白のあと（建物名・階・部屋番号）には触れない。迷う書き方はそのまま残す
export function normalizeBlock(rest) {
  const space = rest.search(/\s/);
  let s = space < 0 ? rest : rest.slice(0, space);
  const tail = space < 0 ? '' : rest.slice(space);

  // 漢数字は、丁目・番・号の並びの中だけ数字にする（「三番町」「麻布十番」「第二号館」「三の丸」は地名・建物名）
  s = s.replace(new RegExp(`(${KANJI_NUM})(?=丁目)`, 'g'), (m) => String(kanjiToNumber(m) ?? m));
  s = s.replace(new RegExp(`(?<=(?:\\d|丁目|番地?|号)-?)(${KANJI_NUM})(?=番地?|号${NOT_GO}|$)`, 'g'), (m) => String(kanjiToNumber(m) ?? m));
  // 数字の間のハイフンに見える文字と「の」を -
  s = s.replace(/(?<=\d)[‐‑‒–—―−ー－の](?=\d)/g, '-');

  // 部屋番号らしいもの（「405号室」）が空白なしで続くなら、番地はまとめない（取り違えを避ける）
  if (/\d号[室館棟]/.test(s)) return rest;

  const END = `(?=$|[^\\d号階FＦｆ-])`;
  s = s.replace(new RegExp(`(\\d+)丁目(\\d+)(?:番地?|-)(\\d+)(?:号${NOT_GO})?${END}`, 'g'), '$1-$2-$3');
  s = s.replace(new RegExp(`(\\d+)丁目(\\d+)(?:番地?|号${NOT_GO})${END}`, 'g'), '$1-$2');
  s = s.replace(new RegExp(`(\\d+)番地?の?(\\d+)(?:号${NOT_GO})?${END}`, 'g'), '$1-$2');
  s = s.replace(new RegExp(`(\\d+)番地${END}`, 'g'), '$1');
  return s + tail;
}

function parse(v) {
  const a = parseAddress(v);
  if (!a.prefecture && !a.city) return null;
  const notes = [];
  let confidence = 1;

  let prefecture = a.prefecture;
  if (!prefecture) {
    // 「東京府」「大坂府」など、都道府県らしいが一覧にない名前は解釈しない（要確認に挙げる）
    const wrong = v.replace(POSTAL, '').match(PREF_LIKE);
    if (wrong && !PREFECTURES.includes(wrong[1])) return null;
    const guess = DESIGNATED[a.city?.match(/^[^\s\d]+?市/)?.[0]] ?? (TOKYO_WARDS.includes(a.city) ? '東京都' : null);
    if (guess) {
      prefecture = guess;
      confidence = 0.8;
      notes.push(`都道府県（${guess}）を市区名から補った`);
    }
  }

  const rest = normalizeBlock(a.rest);
  if (rest !== a.rest) notes.push('丁目・番地の表記を統一');
  const body = `${prefecture ?? ''}${a.city ?? ''}${rest}`;
  const value = a.postal ? `〒${a.postal} ${body}` : body;
  return { value, confidence, note: notes.join('、') || '住所の表記を統一', parts: { ...a, prefecture, rest } };
}

// 市区町村のあとが「立・役所・議会」などなら、住所ではなく施設・組織の名前
const NOT_ADDRESS = /^(?:立|役所|役場|議会|内|民|長|政|域|分|画|場|販売|営)/;
const BLOCK_LIKE = /\d|[〇一二三四五六七八九十]+丁目/;

export const addressRule = {
  type: 'address',
  label: '住所',
  hint: /住所|所在地|address|addr|送付先|届け先/i,
  // 住所の列だと言えるのは、市区町村があり、そのあとに番地らしい数字があるもの。
  // 都道府県だけの値は、列名が住所らしい場合だけ
  match: (v, ctx = {}) => {
    const a = parseAddress(v);
    if (a.city) return !NOT_ADDRESS.test(a.rest) && BLOCK_LIKE.test(a.rest);
    return !!(a.prefecture && ctx.hinted && (!a.rest || BLOCK_LIKE.test(a.rest)));
  },
  normalize: parse,
};

export default function address() {
  return { name: 'address', rules: [addressRule] };
}
