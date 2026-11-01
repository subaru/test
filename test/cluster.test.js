import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidy, fingerprint } from '../src/index.js';

const CSV = `会社,金額
株式会社ＡＢＣ,100
(株)ABC,200
株式会社 ABC,300
ABC株式会社,400
(有)さくら商店,500
有限会社サクラ商店,600
有限会社サクラ商店,700
`;

test('指紋: 法人格の略称・空白・かな・大小文字を無視する', () => {
  assert.equal(fingerprint('(株)ABC'), fingerprint('株式会社 abc'));
  assert.equal(fingerprint('さくら商店'), fingerprint('サクラ・商店'));
  assert.notEqual(fingerprint('株式会社ABC'), fingerprint('ABC株式会社'));
});

test('厳密な表記ゆれは自動で統一し、最も多い表記に揃える', async () => {
  const r = await tidy(CSV);
  assert.deepEqual(r.data.map((d) => d.会社), ['株式会社ABC', '株式会社ABC', '株式会社ABC', 'ABC株式会社', '有限会社サクラ商店', '有限会社サクラ商店', '有限会社サクラ商店']);
  const abc = r.clusters.find((c) => c.applied && c.canonical === '株式会社ABC');
  assert.equal(abc.variants.length, 3);
  // 元の値（全角）が変更ログに残る
  assert.equal(r.changes.find((c) => c.row === 0 && c.column === '会社').rule, 'common');
  assert.equal(r.changes.find((c) => c.row === 1 && c.column === '会社').before, '(株)ABC');
});

test('前株・後株の違いは提案にとどめる', async () => {
  const r = await tidy(CSV);
  const loose = r.clusters.find((c) => !c.applied);
  assert.equal(loose.canonical, '株式会社ABC');
  assert.deepEqual(loose.variants.map((v) => v.value).sort(), ['ABC株式会社', '株式会社ABC']);
  assert.ok(r.issues.some((i) => i.row === 3 && i.suggestion === '株式会社ABC'));
});

test('cluster: false で無効にできる', async () => {
  const r = await tidy(CSV, { cluster: false });
  assert.equal(r.clusters.length, 0);
  assert.equal(r.data[1].会社, '(株)ABC');
});
