import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidy } from '../src/index.js';

const CSV = '登録日,電話\n2024/4/1,0451234567\n不明,03-1234-5678\n';

test('fix: 任意の値に直し、変更ログに手動として残す', async () => {
  const r = await tidy(CSV);
  r.fix(1, '登録日', '2024-04-02');
  assert.equal(r.data[1].登録日, '2024-04-02');
  assert.ok(!r.issues.some((i) => i.row === 1 && i.column === '登録日'));
  const c = r.changes.find((c) => c.row === 1 && c.column === '登録日');
  assert.deepEqual([c.before, c.after, c.rule], ['不明', '2024-04-02', 'manual']);
});

test('accept: 未適用の提案を適用する', async () => {
  const r = await tidy(CSV);
  assert.equal(r.data[0].電話, '0451234567');
  assert.ok(r.accept(0, '電話'));
  assert.equal(r.data[0].電話, '045-123-4567');
  assert.equal(r.issues.length, 1);
});

test('dismiss: 今の値のままにして、提案は見送りとして残す', async () => {
  const r = await tidy(CSV);
  r.dismiss(0, '電話');
  assert.equal(r.data[0].電話, '0451234567');
  assert.ok(r.changes.find((c) => c.row === 0 && c.column === '電話').dismissed);
  assert.equal(r.acceptAll(), 0);
});

test('acceptAll と setCanonical', async () => {
  const r = await tidy('会社\n株式会社ABC\nABC株式会社\n');
  assert.equal(r.acceptAll(), 1);
  assert.equal(r.data[1].会社, '株式会社ABC');

  const r2 = await tidy('会社\n株式会社ABC\n(株)ABC\n');
  r2.setCanonical(0, '(株)ABC');
  assert.deepEqual(r2.data.map((d) => d.会社), ['(株)ABC', '(株)ABC']);
  assert.match(r2.toReport(), /表記ゆれ/);
});
