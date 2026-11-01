import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidy, tidyInWorker, hydrate, read } from '../src/index.js';
import address, { parseAddress, normalizeBlock, kanjiToNumber, addressRule } from '../src/plugins/address.js';

// 住所の規則は値を変えず提案を返すので、提案の値（なければ元の値）を見る
const norm = (v) => { const r = addressRule.normalize(v); return r ? { ...r, value: r.suggest?.value ?? r.value } : null; };

// --- 住所プラグイン ---

test('住所: 丁目・番地・号の表記を統一する', () => {
  assert.equal(norm('東京都中央区銀座四丁目6番16号').value, '東京都中央区銀座4-6-16');
  assert.equal(norm('愛知県名古屋市中村区名駅1ー1ー4').value, '愛知県名古屋市中村区名駅1-1-4');
  assert.equal(norm('広島県廿日市市下平良1丁目11番1号').value, '広島県廿日市市下平良1-11-1');
  assert.equal(norm('〒100ー0001 東京都千代田区千代田1-1').value, '〒100-0001 東京都千代田区千代田1-1');
  assert.equal(normalizeBlock('六本木6丁目10番地1'), '六本木6-10-1');
  assert.equal(normalizeBlock('北1条西2丁目'), '北1条西2丁目');
  assert.deepEqual(['十二', '二十', '百五', '一二'].map(kanjiToNumber), [12, 20, 105, 12]);
});

test('住所: 都道府県の補完は提案にとどめ、名前が重なる区・市は補わない', () => {
  const a = addressRule.normalize('大阪市北区梅田1丁目1番地');
  // 値は変えず、番地の統一と都道府県の補完をまとめて提案にする
  assert.equal(a.value, '大阪市北区梅田1丁目1番地');
  assert.deepEqual([a.suggest.value, a.suggest.confidence], ['大阪府大阪市北区梅田1-1', 0.8]);
  assert.equal(norm('千代田区丸の内二丁目7番2号 JPタワー').value, '東京都千代田区丸の内2-7-2 JPタワー');
  assert.equal(norm('港区六本木6-10-1').value, '港区六本木6-10-1'); // 東京・名古屋・大阪にある
  assert.equal(norm('府中市宮西町2-24').value, '府中市宮西町2-24'); // 東京・広島にある
});

test('住所: 名前に「市」を含む市・郡・誤った都道府県名', () => {
  assert.deepEqual(parseAddress('三重県四日市市諏訪町1-5'), { postal: null, prefecture: '三重県', city: '四日市市', rest: '諏訪町1-5' });
  assert.equal(parseAddress('長野県北安曇郡白馬村北城1').city, '北安曇郡白馬村');
  assert.equal(parseAddress('神奈川県横浜市西区みなとみらい2-2-1').city, '横浜市西区');
  assert.equal(norm('東京府千代田区1-1'), null);
});

test('プラグイン: 名前・オブジェクトで指定でき、住所の列を判定する', async () => {
  const csv = '顧客,住所\nA,東京都中央区銀座四丁目6番16号\nB,大阪市北区梅田1丁目1番地\nC,東京府千代田区1-1\n';
  for (const plugins of [['address'], [address()]]) {
    const r = await tidy(csv, { plugins });
    assert.equal(r.schema[1].type, 'address');
    assert.equal(r.data[0].住所, '東京都中央区銀座四丁目6番16号'); // 値は変えず提案にする
    assert.ok(r.issues.some((i) => i.row === 0 && i.suggestion === '東京都中央区銀座4-6-16'));
    assert.ok(r.issues.some((i) => i.row === 1 && i.suggestion === '大阪府大阪市北区梅田1-1'));
    assert.ok(r.issues.some((i) => i.row === 2 && /解釈できません/.test(i.reason)));
  }
  // プラグインなしでは住所はテキストのまま
  assert.equal((await tidy(csv)).schema[1].type, 'text');
  await assert.rejects(tidy(csv, { plugins: ['nope'] }), /不明なプラグイン/);
  await assert.rejects(tidy(csv, { plugins: [{}] }), /プラグインは/);
});

test('プラグイン: 独自の規則を足せる', async () => {
  const sku = { type: 'sku', label: '品番', hint: /品番/, match: (v) => /^[a-z]{2}-?\d{4}$/i.test(v), normalize: (v) => ({ value: v.toUpperCase().replace(/^([A-Z]{2})-?/, '$1-'), confidence: 1, note: '品番の書式を統一' }) };
  const r = await tidy('品番\nab1234\nCD-5678\n', { plugins: [{ name: 'sku', rules: [sku] }] });
  assert.deepEqual(r.data.map((d) => d.品番), ['AB-1234', 'CD-5678']);
});

// --- hydrate・Worker ---

test('hydrate: toPlain の結果に操作を付け直す（JSONを通しても使える）', async () => {
  const r = await tidy('電話番号\n0451234567\n');
  const back = hydrate(JSON.parse(JSON.stringify(r.toPlain())));
  assert.ok(back.accept(0, '電話番号'));
  assert.equal(back.data[0].電話番号, '045-123-4567');
  assert.match(back.toReport(), /手動|適用/);
});

test('tidyInWorker: Worker のない環境では tidy と同じ結果', async () => {
  const csv = '住所\n東京都中央区銀座四丁目6番16号\n';
  const w = await tidyInWorker(csv, { plugins: ['address'] });
  assert.deepEqual(w.toPlain(), (await tidy(csv, { plugins: ['address'] })).toPlain());
  assert.equal(typeof w.fix, 'function');
});

// --- 大きな入力 ---

test('10万行を超えるCSVでもスタックが溢れない', async () => {
  let csv = 'a,b\n';
  for (let i = 0; i < 150000; i++) csv += `${i},x\n`;
  const t = await read(csv);
  assert.equal(t.rows.length, 150000);
});
