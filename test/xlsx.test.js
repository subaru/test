import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { read, tidy, toCardsHTML } from '../src/index.js';
import { parseSharedStrings, parseDateStyles } from '../src/read/xlsx.js';

const sample = () => readFile(new URL('../examples/sample.xlsx', import.meta.url));

test('xlsx: タイトル行を飛ばし、結合セルを埋める', async () => {
  const table = await read(await sample());
  assert.equal(table.meta.source, 'xlsx');
  assert.deepEqual(table.meta.sheets, ['顧客一覧', 'メモ']);
  assert.equal(table.meta.headerRow, 3);
  assert.equal(table.columns[0], '地域');
  assert.deepEqual(table.rows.map((r) => r[0]), ['関東', '関東', '関東', '関西', '関西']);
});

test('xlsx: 和暦書式の日付セルを日付として読む', async () => {
  const table = await read(await sample());
  assert.equal(table.rows[0][4], '2024-04-01');
});

test('xlsx: シートを名前で選ぶ', async () => {
  const table = await read(await sample(), { sheet: 'メモ' });
  assert.deepEqual(table.columns, ['項目', '内容']);
  await assert.rejects(read(await sample(), { sheet: 'ない' }), /シートが見つかりません/);
});

test('xlsx: tidy まで通す', async () => {
  const r = await tidy(await sample());
  assert.equal(r.data[0].電話番号, '03-1234-5678');
  assert.equal(r.data[2].登録日, '2024-04-03');
  assert.equal(r.data[3].購入金額, 12000);
});

test('共有文字列: ふりがな（rPh）を除き、リッチテキストを連結する', () => {
  const xml = '<sst><si><r><t>山田</t></r><r><t>太郎</t></r><rPh sb="0" eb="2"><t>ヤマダ</t></rPh></si><si><t>A&amp;B</t></si></sst>';
  assert.deepEqual(parseSharedStrings(xml), ['山田太郎', 'A&B']);
});

test('書式: 組み込み・和暦・独自の日付書式を判定する', () => {
  const xml = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[$-ja-JP]ggge&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/><numFmt numFmtId="165" formatCode="#,##0&quot;円&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
  assert.deepEqual(parseDateStyles(xml), [false, true, true, false]);
});

test('旧形式の.xlsは分かりやすいエラーにする', async () => {
  await assert.rejects(read(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), /\.xls/);
});

test('カード表示: 見出し列とフリガナを使う', async () => {
  const r = await tidy(await sample());
  const html = toCardsHTML(r, { titleColumn: '顧客名' });
  assert.match(html, /<small>カブシキガイシャエービーシー<\/small><h3>株式会社ABC<\/h3>/);
});
