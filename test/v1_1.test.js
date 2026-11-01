// v1.1：Excel の複数段の見出し
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { read, tidy } from '../src/index.js';
import { headerDepth } from '../src/read/xlsx.js';

const sample = () => readFile(new URL('../examples/sample-2row.xlsx', import.meta.url));

test('Excel: 結合した2段の見出しを「売上・上期」のようにつなぐ', async () => {
  const t = await read(await sample());
  assert.equal(t.meta.headerRows, 2);
  assert.deepEqual(t.columns, ['店舗', '売上・上期', '売上・下期', '連絡先・電話', '連絡先・メール', '開店日']);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[0][0], '本店');
  const r = await tidy(await sample());
  assert.deepEqual(r.schema.map((c) => c.type), ['text', 'number', 'number', 'phone', 'email', 'date']);
});

test('headerDepth: 横の結合・同じ値の並び・3段', () => {
  // 横の結合（売上が2列）＋縦の結合（店舗が2段）
  const rows = [['店舗', '売上', '売上'], ['店舗', '上期', '下期'], ['本店', '100', '200']];
  assert.equal(headerDepth(rows, 0, [{ r1: 0, c1: 1, r2: 0, c2: 2 }, { r1: 0, c1: 0, r2: 1, c2: 0 }]), 2);
  // 結合なしで同じ値が並ぶだけなら判定しない（候補を info.maybe に入れる）
  const info = {};
  assert.equal(headerDepth([['店舗', '売上', '売上'], ['', '上期', '下期'], ['本店', '1', '2']], 0, [], 3, info), 1);
  assert.equal(info.maybe, 2);
  // 上が空で下に単独の見出しがある列（縦の結合が別の列にある）
  assert.equal(headerDepth([['', '売上', '売上', '開店日'], ['店舗', '上期', '下期', '開店日'], ['本店', '1', '2', '2020-01-01']], 0, [{ r1: 0, c1: 1, r2: 0, c2: 2 }, { r1: 0, c1: 3, r2: 1, c2: 3 }]), 2);
  // 表の外の注記の結合（下が空）は無視する
  assert.equal(headerDepth([['店舗', '売上', '売上', '', '※単位：千円', '※単位：千円'], ['店舗', '上期', '下期', '', '', ''], ['本店', '1', '2', '', '', '']], 0, [{ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 1, r2: 0, c2: 2 }, { r1: 0, c1: 4, r2: 0, c2: 5 }]), 2);
  // 3段
  const three = [['地域', '売上', '売上', '売上', '売上'], ['地域', '上期', '上期', '下期', '下期'], ['地域', '国内', '海外', '国内', '海外'], ['東', '1', '2', '3', '4']];
  assert.equal(headerDepth(three, 0, [{ r1: 0, c1: 0, r2: 2, c2: 0 }, { r1: 0, c1: 1, r2: 0, c2: 4 }, { r1: 1, c1: 1, r2: 1, c2: 2 }, { r1: 1, c1: 3, r2: 1, c2: 4 }]), 3);
});

test('headerDepth: 2段目がデータの行なら1段（結合した「住所」の下に住所の値）', () => {
  const rows = [['氏名', '住所', '住所', '備考'], ['山田', '東京都', '千代田区1-1', 'なし'], ['佐藤', '大阪府', '北区1-1', 'あり']];
  assert.equal(headerDepth(rows, 0, [{ r1: 0, c1: 1, r2: 0, c2: 2 }]), 1);
  // 小見出しの下に数がある（＝データ）
  assert.equal(headerDepth([['店舗', '売上', '売上'], ['', '100', '200']], 0), 1);
  // 結合のない普通の見出し
  assert.equal(headerDepth([['a', 'b'], ['x', 'y']], 0), 1);
});

test('headerDepth: データの行を見出しとして飲み込まない（レビューで見つかった例）', () => {
  const h = (rows, merges) => headerDepth(rows, 0, merges);
  // 方眼紙：データの行も同じ範囲で横に結合している
  const grid = [{ r1: 0, c1: 0, r2: 0, c2: 1 }, { r1: 1, c1: 0, r2: 1, c2: 1 }];
  assert.equal(h([['氏名', '氏名', '備考'], ['山田太郎', '山田太郎', 'あり'], ['佐藤花子', '佐藤花子', 'なし']], grid), 1);
  // ほかの列が空で、結合した「連絡先」の下に電話とメール
  assert.equal(h([['No', '氏名', '連絡先', '連絡先', '備考'], ['', '', '03-1234-5678', 'a@example.jp', '']], [{ r1: 0, c1: 2, r2: 0, c2: 3 }]), 1);
  // 結合した「氏名」の下に姓と名（縦の結合がない）
  assert.equal(h([['氏名', '氏名', '住所'], ['山田', '太郎', '東京都'], ['佐藤', '花子', '大阪府']], [{ r1: 0, c1: 0, r2: 0, c2: 1 }]), 1);
  // たまたま上と同じ値
  assert.equal(h([['区分', '連絡先', '連絡先'], ['区分', '０３－１２３４－５６７８', 'a@example.jp']], [{ r1: 0, c1: 1, r2: 0, c2: 2 }]), 1);
  // 区分の行（範囲の下が同じ値）
  assert.equal(h([['品名', '単価', '備考', '備考'], ['', '', '食品', '食品'], ['りんご', '100', '', '']], [{ r1: 0, c1: 2, r2: 0, c2: 3 }, { r1: 1, c1: 2, r2: 1, c2: 3 }]), 1);
  // 本物の2段見出しの直後のデータ行を3段目にしない
  const two = [['店舗', '連絡先', '連絡先', '連絡先', '連絡先'], ['店舗', '電話', '電話', 'メール', 'メール'], ['', '03-1', '03-2', 'a@x.jp', 'b@x.jp']];
  assert.equal(h(two, [{ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 1, r2: 0, c2: 4 }, { r1: 1, c1: 1, r2: 1, c2: 2 }, { r1: 1, c1: 3, r2: 1, c2: 4 }]), 2);
});

test('Excel: headerRows の不正な値はエラー、行数より多い値は丸めて meta.headerNote に残す', async () => {
  for (const bad of [NaN, 'abc', 1.5, 0, -1]) await assert.rejects(read(await sample(), { headerRows: bad }), TypeError);
  const t = await read(await sample(), { headerRows: 99 });
  assert.match(t.meta.headerNote, /99/);
});

test('Excel: headerRows で見出しの段数を指定できる', async () => {
  const t = await read(await sample(), { headerRows: 1 });
  assert.equal(t.meta.headerRows, 1);
  assert.equal(t.columns[1], '売上');
  assert.equal(t.rows[0][1], '上期');
});

test('Excel: 以前のサンプル（1段の見出し・本文の縦の結合）は変わらない', async () => {
  const t = await read(await readFile(new URL('../examples/sample.xlsx', import.meta.url)));
  assert.equal(t.meta.headerRows, 1);
  assert.deepEqual(t.rows.map((r) => r[0]), ['関東', '関東', '関東', '関西', '関西']);
});
