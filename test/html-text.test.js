import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tidy, read } from '../src/index.js';
import { parseHTML, textContent, readHTML } from '../src/read/html.js';
import { readText } from '../src/read/text.js';

const sample = (name) => readFile(new URL(`../examples/${name}`, import.meta.url));
const file = async (name) => ({ name, arrayBuffer: async () => sample(name) });

// --- HTMLパーサー ---

test('HTML: 閉じタグの省略・script/style・コメント・文字参照', () => {
  const root = parseHTML('<ul><li>a &amp; b<li>c&nbsp;d&#x41;</ul><script>"<li>x</li>"</script><!-- <li>y</li> --><p>e<p>f');
  const text = textContent(root).replace(/\s+/g, ' ').trim();
  assert.equal(text, 'a & b c dA e f');
});

// --- 表 ---

test('HTML表: colspan・rowspan と2段の見出し', () => {
  const t = readHTML('<table><tr><th rowspan=2>店舗</th><th colspan=2>売上</th></tr><tr><th>上期</th><th>下期</th></tr><tr><td>本店</td><td>1</td><td>2</td></tr><tr><td rowspan=2>支店</td><td>3</td><td>4</td></tr><tr><td>5</td><td>6</td></tr></table>');
  assert.deepEqual(t.columns, ['店舗', '売上・上期', '売上・下期']);
  assert.deepEqual(t.rows, [['本店', '1', '2'], ['支店', '3', '4'], ['支店', '5', '6']]);
});

test('HTML表: 縦の「項目｜値」の表は1件にする', () => {
  const t = readHTML('<table><tr><th>会社名</th><td>ABC</td></tr><tr><th>設立</th><td>平成元年1月8日</td></tr></table>');
  assert.deepEqual(t.columns, ['会社名', '設立']);
  assert.deepEqual(t.rows, [['ABC', '平成元年1月8日']]);
});

test('HTML表: 見出しの印がなければ1行目を見出しにし、入れ子の表は別に扱う', () => {
  const t = readHTML('<table><tr><td>名前</td><td>電話</td></tr><tr><td>山田<table><tr><td>x</td></tr></table></td><td>03-1234-5678</td></tr></table>');
  assert.deepEqual(t.columns, ['名前', '電話']);
  assert.equal(t.rows.length, 1);
});

// --- 繰り返し構造・詳細ページ ---

test('HTML: 繰り返し構造を1件ずつの行にする（メニューと定型文は除く）', async () => {
  const t = await read(await file('sample-scrape.html'));
  assert.match(t.meta.how, /繰り返し構造/);
  assert.equal(t.meta.tables, 1);
  assert.deepEqual(t.columns, ['name', 'addr', 'TEL', '営業時間', '開店日', 'price', 'リンク']);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[2][6], '/shops/3');
});

test('HTML: table オプションでページ内の表を選ぶ', async () => {
  const t = await read(await file('sample-scrape.html'), { table: 0 });
  assert.deepEqual(t.columns, ['店舗', '売上・上期', '売上・下期']);
  await assert.rejects(read(await file('sample-scrape.html'), { table: 5 }), /表が見つかりません/);
});

test('HTML: 詳細ページの dt/dd と「項目：値」を1件にする', () => {
  const t = readHTML('<h1>会社概要</h1><dl><dt>社名</dt><dd>株式会社ABC</dd><dt>電話</dt><dd>03-1234-5678</dd></dl><p>設立：平成元年1月8日</p><p>ようこそ</p>');
  assert.deepEqual(t.columns, ['社名', '電話', '設立']);
  assert.deepEqual(t.rows, [['株式会社ABC', '03-1234-5678', '平成元年1月8日']]);
});

test('HTML: 文字列の先頭がタグならHTMLとして読み、tidy まで通す', async () => {
  const r = await tidy(await sample('sample-scrape.html').then(String));
  assert.equal(r.meta.source, 'html');
  assert.deepEqual(r.data.map((d) => d.TEL), ['03-1234-5678', '06-1234-5678', '011-123-4567']);
  assert.deepEqual(r.data.map((d) => d.開店日), ['1989-04-01', '2010-10-10', '2020-05-01']);
  assert.match(r.toReport(), /読み取り方：繰り返し構造/);
});

test('HTML: 取り出せる構造がなければ空の表', async () => {
  const r = await tidy('<p>こんにちは</p>');
  assert.equal(r.data.length, 0);
});

// --- テキスト ---

test('テキスト: 「項目：値」のまとまり（空行・続きの行・【】形式）', async () => {
  const r = await tidy(await file('sample-kv.txt'));
  assert.equal(r.meta.source, 'text');
  assert.deepEqual(r.schema.map((c) => c.name), ['氏名', 'フリガナ', '電話番号', 'メール', '受付日', '内容']);
  assert.equal(r.data.length, 3);
  assert.equal(r.data[0].内容, '商品の在庫について\n来週までに入荷するか知りたい');
  assert.deepEqual(r.data.map((d) => d.受付日), ['2024-04-01', '2024-04-02', '2024-04-03']);
});

test('テキスト: 空行がなくても同じ項目の再登場で1件を区切る', () => {
  const t = readText('名前：A\n電話：03-1234-5678\n名前：B\n電話：06-1234-5678\n');
  assert.deepEqual(t.rows, [['A', '03-1234-5678'], ['B', '06-1234-5678']]);
});

test('テキスト: 空白でそろえた表', () => {
  const t = readText('名前      電話            金額\n山田      03-1234-5678    1,000\n佐藤花子  06-1234-5678    2,000\n');
  assert.deepEqual(t.columns, ['名前', '電話', '金額']);
  assert.deepEqual(t.rows[1], ['佐藤花子', '06-1234-5678', '2,000']);
});

test('テキスト: 文章から日付・電話・郵便番号・金額・メール・URLを抜き出す', async () => {
  const r = await tidy(await file('sample-memo.txt'));
  assert.match(r.meta.how, /文章から抜き出し/);
  const row = r.data[2];
  assert.equal(row.電話番号, '011-123-4567');
  assert.equal(row.郵便番号, null); // 電話番号の後半を郵便番号にしない
  assert.equal(row.本文, 'さくら商店 佐藤様より電話 、納期の確認');
  assert.equal(r.data[4].金額, 30000);
  assert.equal(r.data[4].URL, 'https://example.com/invoice/123');
});

test('テキスト: CSVと1列の表は従来どおりCSVとして読む', async () => {
  assert.equal((await read('a,b\n1,2\n')).meta.source, 'csv');
  assert.deepEqual((await read('金額\n100\n200\n')).columns, ['金額']);
  assert.deepEqual((await read('登録日時\n2024/4/1 9:05\n2024-04-02 10:00\n')).columns, ['登録日時']);
  // .txt でも区切り文字の表ならCSV
  const t = await read({ name: 'a.txt', arrayBuffer: async () => new TextEncoder().encode('名前\t電話\n山田\t03-1234-5678\n') });
  assert.deepEqual(t.columns, ['名前', '電話']);
});
