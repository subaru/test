// v1.0 のレビューで見つかった不具合の再発防止
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidy, tidyInWorker, hydrate, read, detect, normalize, ruleSet } from '../src/index.js';
import address, { addressRule, parseAddress, kanjiToNumber } from '../src/plugins/address.js';

// 住所の規則は値を変えず提案を返すので、提案の値（なければ元の値）を見る
const norm = (v) => { const r = addressRule.normalize(v); return r ? (r.suggest?.value ?? r.value) : null; };

test('住所: 空白のあと（部屋番号・階）を番地につなげない', () => {
  assert.equal(norm('東京都港区赤坂1-2-3 101'), '東京都港区赤坂1-2-3 101');
  assert.equal(norm('東京都中央区新川1-2 3階'), '東京都中央区新川1-2 3階');
  assert.equal(norm('東京都港区赤坂一丁目2番3号 4階'), '東京都港区赤坂1-2-3 4階');
  assert.equal(norm('東京都港区赤坂123番地 2階'), '東京都港区赤坂123 2階');
  assert.equal(norm('東京都中央区銀座4丁目 3F'), '東京都中央区銀座4丁目 3F');
});

test('住所: 「号室」「号館」の号を消さない・迷う書き方はまとめない', () => {
  assert.equal(norm('東京都港区赤坂1丁目2番地 405号室'), '東京都港区赤坂1-2 405号室');
  assert.equal(norm('東京都港区赤坂5番地 101号室'), '東京都港区赤坂5 101号室');
  assert.equal(norm('東京都港区赤坂1丁目2番405号室'), '東京都港区赤坂1丁目2番405号室');
});

test('住所: 地名・建物名の中の漢数字はそのまま', () => {
  assert.equal(norm('東京都千代田区三番町6-1'), '東京都千代田区三番町6-1');
  assert.equal(norm('東京都港区麻布十番2-3-1'), '東京都港区麻布十番2-3-1');
  assert.equal(norm('宮城県仙台市青葉区一番町一丁目1番1号'), '宮城県仙台市青葉区一番町1-1-1');
  assert.equal(norm('愛知県名古屋市中区三の丸三丁目1番2号'), '愛知県名古屋市中区三の丸3-1-2');
  assert.equal(norm('東京都荒川区南千住三の輪1-1'), '東京都荒川区南千住三の輪1-1');
  assert.equal(norm('東京都中央区銀座四丁目六番十六号'), '東京都中央区銀座4-6-16');
  assert.equal(norm('東京都港区〇〇番地'), '東京都港区〇〇番地');
  assert.equal(kanjiToNumber('〇〇'), null);
  assert.equal(kanjiToNumber(''), null);
});

test('住所: 都道府県の誤りの判定を、市区町村名の中の「都・府・道」に当てない', () => {
  assert.equal(addressRule.normalize('大阪市都島区東野田町1-1').suggest.value, '大阪府大阪市都島区東野田町1-1');
  assert.equal(addressRule.normalize('横浜市都筑区茅ケ崎中央1-1').suggest.value, '神奈川県横浜市都筑区茅ケ崎中央1-1');
  assert.equal(norm('太宰府市宰府4-7-1'), '太宰府市宰府4-7-1');
  assert.equal(norm('松山市道後湯之町1-1'), '松山市道後湯之町1-1');
  assert.equal(norm('東京府千代田区1-1'), null);
});

test('住所: 番地の・〒のない郵便番号・郡の町村名', () => {
  assert.equal(norm('埼玉県川越市大字小仙波123番地の4'), '埼玉県川越市大字小仙波123-4');
  assert.equal(norm('100-0001東京都千代田区千代田1-1'), '〒100-0001 東京都千代田区千代田1-1');
  assert.equal(norm('1000001 東京都千代田区千代田1-1'), '〒100-0001 東京都千代田区千代田1-1');
  assert.equal(parseAddress('佐賀県杵島郡大町町大字福母1').city, '杵島郡大町町');
  assert.equal(parseAddress('群馬県佐波郡玉村町下新田1').city, '佐波郡玉村町');
});

test('住所: 施設・組織の名前の列を住所にしない', async () => {
  const r = await tidy('所属,学校\n北海道大学 第二号館,新宿区立第2小学校\n東京都交通局 一番線,渋谷区立第1中学校\n大阪府立大学 3号棟,港区立第3小学校\n', { plugins: ['address'] });
  assert.deepEqual(r.schema.map((c) => c.type), ['text', 'text']);
  assert.equal(r.data[0].所属, '北海道大学 第二号館');
  for (const v of ['市場調査', '区分', '町内会の集まり']) assert.equal(addressRule.match(v), false);
});

test('住所: 長い文でも時間がかからない', () => {
  const t = Date.now();
  addressRule.match('郡'.repeat(20000));
  addressRule.match('市場の動向について議論した。'.repeat(2000));
  assert.ok(Date.now() - t < 500);
});

// --- プラグインの仕組み ---

test('プラグイン: 組み込みと同じ type なら、判定にも正規化にもプラグインの規則を使う', async () => {
  const phone = { type: 'phone', label: '内線', hint: /tel/i, match: (v) => /^\d{3}$/.test(v), normalize: (v) => ({ value: `#${v}`, confidence: 1, note: '内線' }) };
  const r = await tidy('tel\n123\n456\n', { plugins: [{ name: 'ext', rules: [phone] }] });
  assert.equal(r.schema[0].label, '内線');
  assert.deepEqual(r.data.map((d) => d.tel), ['#123', '#456']);
});

test('プラグイン: 規則の形の誤り・規則の中のエラーは、名前の付いたエラーにする', async () => {
  await assert.rejects(tidy('a\n1\n', { plugins: [{ name: 'p', rules: [{ type: 'x' }] }] }), /プラグイン「p」の規則「x」：match と normalize/);
  await assert.rejects(tidy('a\n1\n', { plugins: [{ name: 'p', rules: [null] }] }), /オブジェクトではありません/);
  const boom = { type: 'b', label: 'B', match: () => { throw new Error('壊れた'); }, normalize: () => null };
  await assert.rejects(tidy('a\n1\n', { plugins: [{ name: 'p', rules: [boom] }] }), /プラグイン「p」の規則「b」の match でエラー.*壊れた/);
  const bad = { type: 'c', label: 'C', match: () => true, normalize: (v) => v };
  await assert.rejects(tidy('a\n1\n', { plugins: [{ name: 'p', rules: [bad] }] }), /normalize は \{ value, confidence, note \}/);
  await assert.rejects(tidy('a\n1\n', { plugins: 'address' }), /配列で指定/);
  assert.equal((await tidy('a\n1\n', { plugins: null })).data.length, 1);
});

test('プラグイン: hint の g フラグで結果が交互に変わらない', async () => {
  const sku = { type: 'sku', label: '品番', hint: /sku/g, minRatio: 0, match: (v, ctx) => ctx.hinted && /^\w+$/.test(v), normalize: (v) => ({ value: v.toUpperCase(), confidence: 1, note: '' }) };
  const r = await tidy('sku_a,sku_b,sku_c,sku_d\nx,x,x,x\n', { plugins: [{ name: 's', rules: [sku] }] });
  assert.deepEqual(r.schema.map((c) => c.type), ['sku', 'sku', 'sku', 'sku']);
});

test('列の種類の指定：存在しない種類はエラーにする', async () => {
  await assert.rejects(tidy('住所\n東京都千代田区1-1\n', { columns: { 住所: { type: 'address' } } }), /plugins: \['address'\]/);
  await assert.rejects(tidy('a\n1\n', { columns: { a: { type: 'bogus' } } }), /種類「bogus」はありません/);
  const r = await tidy('住所\n東京都千代田区1-1\n', { columns: { 住所: { type: 'address' } }, plugins: ['address'] });
  assert.equal(r.schema[0].type, 'address');
});

test('段階ごとの呼び出しでもプラグインを使える', async () => {
  const table = await read('住所\n東京都中央区銀座四丁目6番16号\n');
  assert.equal(detect(table, { plugins: [address()] })[0].type, 'address');
  const schema = detect(table, { ruleSet: ruleSet(address().rules) });
  const n = normalize(table, schema, { plugins: [address()] });
  assert.equal(n.data[0].住所, '東京都中央区銀座四丁目6番16号'); // 値は変えない
  assert.equal(n.issues[0].suggestion, '東京都中央区銀座4-6-16');
  assert.throws(() => detect(table, { plugins: ['address'] }), /オブジェクトで渡して/);
});

// --- hydrate・toPlain・Worker ---

test('hydrate: 入力を確かめ、clusters・meta がなくても使える', async () => {
  for (const bad of [null, 'abc', {}, { data: [] }]) assert.throws(() => hydrate(bad), /hydrate/);
  const h = hydrate({ data: [{ a: '1' }], schema: [{ name: 'a', type: 'text', label: 'テキスト' }], changes: [], issues: [], clusters: undefined });
  assert.deepEqual(h.clusters, []);
  assert.match(h.toReport(), /<!DOCTYPE html>/);
});

test('toPlain: その時点の写しで、後の修正は反映されない', async () => {
  const r = await tidy('a\nx\n');
  const snap = r.toPlain();
  r.fix(0, 'a', 'y');
  assert.equal(snap.data[0].a, 'x');
  assert.equal(r.data[0].a, 'y');
});

test('tidyInWorker: プラグインをオブジェクトで渡すとどの環境でもエラー', async () => {
  await assert.rejects(tidyInWorker('a\n1\n', { plugins: [address()] }), /名前の配列/);
});

test('src/worker.js を Worker の外で読み込んでも何もしない', async () => {
  await import('../src/worker.js');
  assert.equal(globalThis.onmessage ?? null, null);
});

// --- 2回目のレビュー：「確実に分かる形だけを変える」方式への作り直し ---

test('住所: 番地の部分が決まった形でなければ変えない（後ろに建物名・B1F・地先などが続く）', () => {
  for (const v of [
    '東京都新宿区歌舞伎町1-2-3一番街ビル',
    '東京都新宿区西新宿1-2-3一番館101',
    '東京都港区芝1丁目2番3号一番館',
    '東京都千代田区丸の内1丁目9番1号B1F',
    '東京都港区芝1丁目2番3号B101',
    '東京都港区芝1丁目2番3号店',
    '東京都港区芝12番地先',
    '東京都港区芝12番地内',
    '東京都港区芝12番地付近',
  ]) assert.equal(norm(v), v, v);
});

test('住所: 空白のあとが番地の続きなら変えない・伏せ字の〇は数にしない', () => {
  assert.equal(norm('東京都港区芝1丁目2番 3号'), '東京都港区芝1丁目2番 3号');
  assert.equal(norm('東京都港区芝12番地 3'), '東京都港区芝12番地 3');
  assert.equal(norm('東京都港区芝〇丁目〇番〇号'), '東京都港区芝〇丁目〇番〇号');
  assert.equal(norm('東京都港区芝1丁目〇番〇号'), '東京都港区芝1丁目〇番〇号');
});

test('住所: 決まった形の番地は、漢数字・番地の・北海道の条丁目も揃える', () => {
  assert.equal(norm('東京都港区芝十二番地'), '東京都港区芝12');
  assert.equal(norm('東京都千代田区千代田一の一'), '東京都千代田区千代田1-1');
  assert.equal(norm('北海道札幌市中央区南1条西2丁目3番地'), '北海道札幌市中央区南1条西2-3');
  assert.equal(norm('北海道札幌市中央区北1条西2丁目'), '北海道札幌市中央区北1条西2丁目');
  assert.equal(norm('東京都港区芝１丁目２番３号'), '東京都港区芝1-2-3'); // 全角の数字（直接呼んだ場合も）
});

test('住所: 名前の列を住所にせず、「内・立・長」で始まる町名は住所にする', () => {
  for (const v of ['中村1', '関東地区1', '下町ロケット2', '港区みなと祭り2024', '新宿区1号店', 'A工区1', '渋谷区役所前店']) {
    assert.equal(addressRule.match(v), false, v);
  }
  for (const v of ['東京都千代田区内神田1-1-1', '東京都葛飾区立石1-1', '千代田区内神田1-1-1', '大阪市中央区内本町1-1', '仙台市太白区長町1-1']) {
    assert.equal(addressRule.match(v), true, v);
  }
});

test('住所: 値は自動では変えず、番地の統一と都道府県の補完をまとめて提案にする（適用すると両方そろう）', async () => {
  const r = await tidy('住所\n大阪市北区梅田1丁目1番地\n千代田区丸の内二丁目7番2号\n', { plugins: ['address'] });
  assert.deepEqual(r.data.map((d) => d.住所), ['大阪市北区梅田1丁目1番地', '千代田区丸の内二丁目7番2号']);
  assert.ok(r.issues.some((i) => i.row === 0 && i.suggestion === '大阪府大阪市北区梅田1-1'));
  // minConfidence を下げても提案のまま
  const low = await tidy('住所\n大阪市北区梅田1丁目1番地\n', { plugins: ['address'], minConfidence: 0.5 });
  assert.equal(low.data[0].住所, '大阪市北区梅田1丁目1番地');
  r.accept(0, '住所');
  assert.equal(r.data[0].住所, '大阪府大阪市北区梅田1-1');
  assert.equal(r.changes.filter((c) => c.row === 0).length, 1);
  assert.equal(r.changes.find((c) => c.row === 0).before, '大阪市北区梅田1丁目1番地');
});

test('tidy は ruleSet を使い、ruleSet でも規則の形を確かめる', async () => {
  const r = await tidy('住所\n東京都中央区銀座四丁目6番16号\n', { ruleSet: ruleSet(address().rules) });
  assert.equal(r.schema[0].type, 'address');
  assert.equal(r.issues[0].suggestion, '東京都中央区銀座4-6-16');
  assert.throws(() => ruleSet([{ type: 'x' }]), /match と normalize/);
});

test('クラスで書いた規則の getter（minRatio など）を引き継ぐ', async () => {
  class Strict {
    type = 'code';
    label = 'コード';
    get minRatio() {
      return 1;
    }
    match(v) {
      return /^[A-Z]\d$/.test(v);
    }
    normalize(v) {
      return { value: v, confidence: 1, note: '' };
    }
  }
  // 4件中3件しか一致しないので、minRatio 1 の規則は選ばれない
  const r = await tidy('c\nA1\nB2\nC3\nxyz\n', { plugins: [{ name: 's', rules: [new Strict()] }] });
  assert.equal(r.schema[0].type, 'text');
});

test('normalize を段階ごとに呼ぶとき、規則のない種類はエラーにする', async () => {
  const table = await read('住所\n東京都中央区銀座四丁目6番16号\n');
  const schema = detect(table, { plugins: [address()] });
  assert.throws(() => normalize(table, schema), /規則がありません/);
});

test('tidyInWorker では ruleSet を使えない', async () => {
  await assert.rejects(tidyInWorker('a\n1\n', { ruleSet: ruleSet() }), /ruleSet は使えません/);
});

// --- 3回目のレビュー ---

test('住所: 「〜番」で終わる町名と、崩れた漢数字・伏せ字は変えない', () => {
  for (const v of [
    '東京都港区麻布十番2',
    '東京都港区麻布十番3号',
    '愛知県名古屋市熱田区一番2',
    '愛知県名古屋市熱田区二番3号',
    '東京都港区芝十〇番地',
    '東京都港区芝三丁目十〇番',
    '東京都港区芝五丁目十〇番十〇号',
    '東京都港区芝十一一番地',
    '東京都港区芝十十番地',
    '東京都港区芝百十百番地',
  ]) assert.equal(norm(v), v, v);
  assert.deepEqual(['十二', '二十三', '百五', '一二', '二〇'].map(kanjiToNumber), [12, 23, 105, 12, 20]);
  assert.deepEqual(['十〇', '十一一', '十十', '〇〇'].map(kanjiToNumber), [null, null, null, null]);
});

test('住所: 空白のあと — 「先・付近・外」と番地の続きは変えず、完結した番地のあとの部屋番号は揃える', () => {
  for (const v of ['東京都港区芝12番地 先', '東京都港区芝12番地 付近', '東京都港区芝12番地 外', '東京都港区芝1丁目2番 3-4', '東京都港区芝1丁目2番 3の4']) {
    assert.equal(norm(v), v, v);
  }
  assert.equal(norm('東京都港区芝四丁目6番16号 301'), '東京都港区芝4-6-16 301');
  assert.equal(norm('東京都港区芝1ー2ー3 101'), '東京都港区芝1-2-3 101');
});

test('住所: 丁目のあとの「番地の」「の」を区切りとして揃える', () => {
  assert.equal(norm('東京都港区芝2丁目3番地の4'), '東京都港区芝2-3-4');
  assert.equal(norm('東京都港区芝三丁目二の五'), '東京都港区芝3-2-5');
});

test('住所: 都道府県のあとに市区町村がない名前（大会名・チーム名）は住所にせず、変えない', async () => {
  const r = await tidy('大会名\n東京都大会2024\n北海道予選2023\n大阪府大会2022\n神奈川県選手権2021\n', { plugins: ['address'] });
  assert.equal(r.schema[0].type, 'text');
  assert.equal(addressRule.match('北海道日本ハムファイターズ2024'), false);
  assert.equal(norm('東京都選抜1の2'), '東京都選抜1の2');
});

// --- 4回目のレビュー：住所の変換をすべて提案にする・名前の列を住所にしない ---

test('住所: 4回目に見つかった書き方も、値は変わらない（提案だけ）', async () => {
  const rows = ['東京都港区芝1丁目2番 3ー4', '東京都港区芝1丁目2番 三の四', '東京都港区芝12番地 3番4号', '東京都港区麻布十番二', '東京都港区芝12番地、13番地', '東京都港区芝1〜3丁目2番', '東京都港区芝12番地 他2筆', '東京都港区芝1丁目2号'];
  const r = await tidy(`住所\n${rows.join('\n')}\n`, { plugins: ['address'] });
  assert.deepEqual(r.data.map((d) => d.住所), rows);
  assert.ok(r.changes.every((c) => !c.applied || c.rule === 'common'));
  r.acceptAll(); // 利用者が承認すれば揃う
  assert.notDeepEqual(r.data.map((d) => d.住所), rows);
});

test('住所: 都道府県と市区町村のあとが名前と数字だけの列は住所にしない', async () => {
  const r = await tidy('イベント\n東京都港区みなと祭り2024\n神奈川県横浜市花火大会2025\n大阪府大阪市マラソン2024\n北海道札幌市雪まつり2026\n', { plugins: ['address'] });
  assert.equal(r.schema[0].type, 'text');
  // 列名が住所らしければ、数字だけの番地（地番）も住所とみなす
  assert.equal(addressRule.match('長野県北佐久郡軽井沢町軽井沢1323', { hinted: true }), true);
  assert.equal(addressRule.match('長野県北佐久郡軽井沢町軽井沢1323'), false);
});
