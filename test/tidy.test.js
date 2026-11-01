import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tidy, read } from '../src/index.js';

test('Shift_JISのCSVを判定して読み込む', async () => {
  const bytes = await readFile(new URL('../examples/sample-sjis.csv', import.meta.url));
  const table = await read(bytes);
  assert.equal(table.meta.encoding, 'shift_jis');
  assert.equal(table.columns[0], '顧客名');
  assert.equal(table.rows.length, 10);
});

test('CSV: 引用符内のカンマと改行', async () => {
  const table = await read('a,b\n"1,000","x\ny"\n');
  assert.deepEqual(table.rows, [['1,000', 'x\ny']]);
});

test('TSVの区切り文字を推定する', async () => {
  const table = await read('名前\t電話\n山田\t03-1234-5678\n');
  assert.equal(table.meta.delimiter, '\t');
  assert.deepEqual(table.columns, ['名前', '電話']);
});

test('ネストしたJSONを平らにする', async () => {
  const table = await read('[{"user":{"name":"山田","tel":"0312345678"}}]');
  assert.deepEqual(table.columns, ['user.name', 'user.tel']);
});

test('tidy: 推論・正規化・変更ログ・要確認', async () => {
  const csv = '生年月日,電話,金額\n令和6年4月1日,09012345678,"¥1,000"\n不明,0451234567,△500\n';
  const r = await tidy(csv);

  assert.deepEqual(r.schema.map((c) => c.type), ['date', 'phone', 'number']);
  assert.deepEqual(r.data[0], { 生年月日: '2024-04-01', 電話: '090-1234-5678', 金額: 1000 });

  // 確信度の低い変換は適用せず、提案として残す
  assert.equal(r.data[1].電話, '0451234567');
  const pending = r.changes.find((c) => !c.applied);
  assert.equal(pending.after, '045-123-4567');

  assert.ok(r.issues.some((i) => i.column === '生年月日' && i.value === '不明'));
});

test('tidy: 列の種類を指定して推論を上書きする', async () => {
  const r = await tidy('コード\n0312345678\n', { columns: { コード: { type: 'text' } } });
  assert.equal(r.schema[0].type, 'text');
  assert.equal(r.data[0].コード, '0312345678');
});

test('レポートHTMLは値をエスケープする', async () => {
  const r = await tidy('名前\n　<script>alert(1)</script>\n');
  const html = r.toReport();
  assert.ok(!html.includes('<script>alert(1)'));
});
