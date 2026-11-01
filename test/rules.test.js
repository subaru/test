import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean } from '../src/rules/common.js';
import { ruleByType } from '../src/rules/index.js';

const norm = (type, v, ctx) => ruleByType[type].normalize(clean(v), ctx)?.value ?? null;

test('共通: 全角・半角カナ・空白を統一', () => {
  assert.equal(clean('　ＡＢＣ　１２３ '), 'ABC 123');
  assert.equal(clean('ﾃｽﾄ'), 'テスト');
  assert.equal(clean('㈱テスト'), '(株)テスト');
});

test('日付: 西暦・和暦', () => {
  assert.equal(norm('date', '2024/4/1'), '2024-04-01');
  assert.equal(norm('date', '２０２４年４月１日'), '2024-04-01');
  assert.equal(norm('date', '令和6年4月1日'), '2024-04-01');
  assert.equal(norm('date', '平成元年1月8日'), '1989-01-08');
  assert.equal(norm('date', 'S60.4.1'), '1985-04-01');
  assert.equal(norm('date', 'r2/12/1'), '2020-12-01');
});

test('日付: 存在しない日付は解釈しない', () => {
  assert.equal(norm('date', '2024/2/30'), null);
  assert.equal(norm('date', 'R2.2.30'), null);
});

test('日付: 8桁とExcelシリアル値は列名のヒントがある場合だけ', () => {
  assert.equal(norm('date', '20240404'), null);
  assert.equal(norm('date', '20240404', { hinted: true }), '2024-04-04');
  assert.equal(norm('date', '45383', { hinted: true }), '2024-04-01');
});

test('電話番号', () => {
  assert.equal(norm('phone', '０３（１２３４）５６７８'), '03-1234-5678');
  // 数字だけの値は、列名のヒントがなければ電話番号とみなさない（IDの場合がある）
  assert.equal(norm('phone', '09012345678'), null);
  assert.equal(norm('phone', '09012345678', { hinted: true }), '090-1234-5678');
  assert.equal(ruleByType.phone.normalize('09012345678', { typed: true }).confidence, 0.8);
  assert.equal(norm('phone', '+81 6-1234-5678'), '06-1234-5678');
  assert.equal(norm('phone', 'TEL:0120-123-456'), '0120-123-456');
  assert.equal(ruleByType.phone.normalize('0451234567', { hinted: true }).confidence, 0.6);
  assert.equal(norm('phone', '12345'), null);
});

test('郵便番号', () => {
  assert.equal(norm('postal', '〒100-0001'), '100-0001');
  assert.equal(norm('postal', '〒150ー0002'), '150-0002');
  assert.equal(norm('postal', '1000001'), null);
  assert.equal(norm('postal', '1000001', { hinted: true }), '100-0001');
});

test('数値', () => {
  assert.equal(norm('number', '¥12,000'), 12000);
  assert.equal(norm('number', '1万2千円'), 12000);
  assert.equal(norm('number', '3.5億'), 350000000);
  assert.equal(norm('number', '△500'), -500);
  assert.equal(norm('number', '(1,200)'), -1200);
  assert.equal(norm('number', 'abc'), null);
});

test('真偽値・フリガナ・メール', () => {
  assert.equal(norm('boolean', '○'), true);
  assert.equal(norm('boolean', '無'), false);
  assert.equal(norm('kana', 'やまだ たろう'), 'ヤマダ タロウ');
  assert.equal(norm('email', 'Info@ABC.CO.JP'), 'Info@abc.co.jp');
});
