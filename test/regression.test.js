// レビューで見つかった不具合の再発防止テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidy, read, toCSV, fingerprint } from '../src/index.js';
import { decode } from '../src/read/encoding.js';
import { parseSharedStrings, parseSheet, formatKind, serialToISO } from '../src/read/xlsx.js';
import { clean } from '../src/rules/common.js';
import { ruleByType } from '../src/rules/index.js';

const col = (r, name) => r.data.map((d) => d[name]);

// --- データを黙って壊さない ---

test('表記ゆれ: 数字の区切りが違う値はまとめない', async () => {
  const r = await tidy('住所\n港区1-23\n港区1-23\n港区12-3\n');
  assert.deepEqual(col(r, '住所'), ['港区1-23', '港区1-23', '港区12-3']);
  assert.notEqual(fingerprint('ver1.5'), fingerprint('ver15'));
  assert.notEqual(fingerprint('A-12'), fingerprint('A1-2'));
});

test('表記ゆれ: 法人格の種類が違うものは提案もしない', async () => {
  const r = await tidy('会社\n(有)ABC\n株式会社ABC\n');
  assert.equal(r.clusters.length, 0);
});

test('先頭が0のコードと大きな整数は数値にしない', async () => {
  const r = await tidy('商品コード,口座\n0012,12345678901234567890\n0345,12345678901234567891\n');
  assert.equal(r.schema[0].type, 'text');
  assert.deepEqual(col(r, '商品コード'), ['0012', '0345']);
  assert.deepEqual(col(r, '口座'), ['12345678901234567890', '12345678901234567891']);
  const j = await tidy('[{"s":"0012"},{"s":"0007"}]');
  assert.deepEqual(col(j, 's'), ['0012', '0007']);
});

test('同じ名前の列は番号を付けて両方残す', async () => {
  const r = await tidy('名前,名前,,列2\n山田,田中,p,q\n');
  assert.deepEqual(r.schema.map((c) => c.name), ['名前', '名前_2', '列3', '列2']);
  assert.deepEqual(r.data[0], { 名前: '山田', 名前_2: '田中', 列3: 'p', 列2: 'q' });
});

test('見出しより多いセルは捨てずに列を足し、要確認に挙げる', async () => {
  const r = await tidy('金額\n"1,200"\n1,200\n');
  assert.deepEqual(r.schema.map((c) => c.name), ['金額', '列2']);
  assert.equal(r.data[1].列2, 200);
  assert.ok(r.issues.some((i) => i.row === 1 && /多いセル/.test(i.reason)));
});

test('JSON: 数字の配列を1つの数にしない・日付やオブジェクトの配列を保つ', async () => {
  const r = await tidy([{ t: [1, 2], items: [{ sku: 'X1' }], d: new Date('2024-04-01T00:00:00Z') }]);
  assert.equal(r.data[0].t, '1 / 2');
  assert.equal(r.data[0].items, '[{"sku":"X1"}]');
  assert.equal(r.data[0].d, '2024-04-01');
});

test('数字だけのIDは電話番号に、備考の「済・未」は真偽値に変換しない', async () => {
  const r = await tidy('会員ID,備考\n09012345678,済\n09087654321,未\n08011112222,有\n');
  assert.notEqual(r.schema[0].type, 'phone');
  assert.equal(r.data[0].会員ID, '09012345678');
  // 言葉の真偽値は列名のヒントがなければ提案にとどめる
  assert.equal(r.data[0].備考, '済');
  assert.ok(r.changes.some((c) => c.column === '備考' && !c.applied));
});

test('真偽値: 一部だけ一致する列は真偽値にしない', async () => {
  const r = await tidy('状態\n有\n無\n有\n無\n要確認\n');
  assert.equal(r.schema[0].type, 'text');
});

test('「日数」「日当」は日付扱いしない', async () => {
  const r = await tidy('日数,日当\n20240401,25000\n');
  assert.equal(r.data[0].日数, 20240401);
  assert.equal(r.data[0].日当, 25000);
});

test('数値: 番号の(1)や不正な桁区切り・二重のマイナスは数値にしない', async () => {
  const r = await tidy('memo\n(1)\n(2)\n(3)\n');
  assert.deepEqual(col(r, 'memo'), ['(1)', '(2)', '(3)']);
  const num = (v) => ruleByType.number.normalize(clean(v))?.value ?? null;
  assert.deepEqual(['1,2,3', '1, 2', '(-500)', '△-500', '−500', '(1,200)', '(500)', '0.5', '0'].map(num), [null, null, null, null, -500, -1200, -500, 0.5, 0]);
});

test('型のある列の「-」は空として扱う', async () => {
  const r = await tidy('金額\n100\n-\n200\n');
  assert.deepEqual(col(r, '金額'), [100, null, 200]);
  assert.equal(r.issues.length, 0);
});

test('共通の統一: 丸数字・分数・波ダッシュ・改行は残す', () => {
  assert.equal(clean('①1½㎡～'), '①1½m2～');
  assert.equal(clean('一行目\r\n  二行目 '), '一行目\n二行目');
});

test('和暦: 元号の期間外は提案にとどめる', async () => {
  const r = await tidy('生年月日\n令和元年4月1日\n昭和64年1月10日\n平成元年1月8日\n');
  assert.deepEqual(col(r, '生年月日'), ['令和元年4月1日', '昭和64年1月10日', '1989-01-08']);
});

// --- 落ちない ---

test('空の入力・見出しだけの入力でも落ちない', async () => {
  for (const input of ['', '\n', '  \n \n', '﻿']) {
    const r = await tidy(input);
    assert.equal(r.data.length, 0);
    assert.equal(r.toCardsHTML(), '<div class="tidy-cards"></div>');
  }
  const h = await tidy('a,b\n');
  assert.deepEqual(h.schema.map((c) => c.name), ['a', 'b']);
  assert.throws(() => h.fix(0, 'a', 'x'), /行がありません/);
  await assert.rejects(tidy(null), /入力がありません/);
});

test('fix: 存在しない列はエラーにする', async () => {
  const r = await tidy('a\n1\n');
  assert.throws(() => r.fix(0, 'b', 'x'), /列がありません/);
});

test('文字列の先頭のBOM・引用符の前の空白・[で始まるCSV', async () => {
  assert.deepEqual((await read('﻿"名前","年齢"\n山田,30\n')).columns, ['名前', '年齢']);
  assert.deepEqual((await read('a, "b,c"\n1,2\n')).columns, ['a', 'b,c']);
  assert.deepEqual((await read('[メモ],金額\nx,1\n')).columns, ['[メモ]', '金額']);
});

test('UTF-16（BOMあり・なし）を判定する', () => {
  const le = new Uint8Array([0xff, 0xfe, ...[...'名前\t年齢'].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  assert.deepEqual(decode(le), { text: '名前\t年齢', encoding: 'utf-16le' });
  const bare = new Uint8Array([...'name,age\n'].flatMap((c) => [c.charCodeAt(0), 0]));
  assert.equal(decode(bare).encoding, 'utf-16le');
});

// --- Excel ---

test('xlsx: 空の共有文字列で番号がずれない・<t/> を扱う', () => {
  assert.deepEqual(parseSharedStrings('<sst><si><t>名前</t></si><si/><si><r><t/></r><r><t>山田</t></r></si></sst>'), ['名前', '', '山田']);
});

test('xlsx: 「General」書式（LibreOffice）を日付と誤判定しない', () => {
  assert.equal(formatKind('General'), null);
  assert.equal(formatKind('h:mm AM/PM'), 'time');
  assert.equal(formatKind('[h]:mm'), 'time');
});

test('xlsx: 日時・時刻・1904年基準・1900年2月以前', () => {
  assert.equal(serialToISO(45385.5), '2024-04-03 12:00');
  assert.equal(serialToISO(0.375), '09:00');
  assert.equal(serialToISO(43921, 'date', true), '2024-04-01');
  assert.equal(serialToISO(59), '1900-02-28');
  assert.equal(serialToISO(61), '1900-03-01');
});

test('xlsx: r属性がないセル・t="d" のセルを読む', () => {
  const xml = '<sheetData><row><c t="inlineStr"><is><t>日付</t></is></c><c t="inlineStr"><is><t>x</t></is></c></row><row><c s="1" t="d"><v>2024-04-01T00:00:00</v></c><c><v>5</v></c></row></sheetData>';
  assert.deepEqual(parseSheet(xml, [], [null, 'date']).rows, [['日付', 'x'], ['2024-04-01', '5']]);
});

test('日時の値を日付の列として扱う', async () => {
  const r = await tidy('登録日時\n2024/4/1 9:05\n2024-04-02 10:00\n');
  assert.deepEqual(col(r, '登録日時'), ['2024-04-01 09:05', '2024-04-02 10:00']);
});

// --- 修正の状態 ---

test('setCanonical: 手で直したセルを上書きせず、関連する提案も付け替える', async () => {
  const r = await tidy('会社\n株式会社ABC\n(株)ABC\n(株)ABC\nABC株式会社\n');
  r.fix(2, '会社', '株式会社XYZ');
  r.setCanonical(0, '(株)ABC');
  assert.deepEqual(col(r, '会社'), ['(株)ABC', '(株)ABC', '株式会社XYZ', 'ABC株式会社']);
  const issue = r.issues.find((i) => i.row === 3);
  assert.equal(issue.suggestion, '(株)ABC');
  r.accept(3, '会社');
  assert.equal(r.data[3].会社, '(株)ABC');
  assert.ok(r.clusters.every((c) => c.applied));
});

// --- 書き出し ---

test('CSV: 数式として実行される値の先頭に \' を付ける（数値は対象外）', () => {
  const schema = [{ name: '名前' }, { name: '金額' }];
  const csv = toCSV({ schema, data: [{ 名前: '=HYPERLINK("x")', 金額: -500 }, { 名前: '@SUM(1)', 金額: '-2+3' }, { 名前: '-500', 金額: null }] });
  assert.equal(csv, '名前,金額\r\n"\'=HYPERLINK(""x"")",-500\r\n\'@SUM(1),\'-2+3\r\n-500,\r\n');
  assert.ok(toCSV({ schema, data: [] }, { bom: true }).startsWith('﻿'));
  assert.equal(toCSV({ schema, data: [{ 名前: '=1' }] }, { safe: false }).split('\r\n')[1], '=1,');
});

test('処理時間: 表記ゆれが大量にあっても件数の2乗にならない', async () => {
  let csv = '会社\n';
  for (let i = 0; i < 20000; i++) csv += `(株)会社${i}\n株式会社会社${i}\n`;
  const t = Date.now();
  const r = await tidy(csv);
  assert.equal(r.clusters.length, 20000);
  assert.ok(Date.now() - t < 5000, `${Date.now() - t}ms`);
});
