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

// --- v0.4 のレビューで見つかった不具合の再発防止 ---

test('CSVの後退なし: 列数がそろわない・URLを含む・1列の「項目：値」・曜日付きの日付', async () => {
  const cases = [
    ['氏名,住所,電話,備考\n山田,東京都 港区,03-1234-5678\n佐藤,大阪府,06-1234-5678,至急\n鈴木,愛知県,052-123-4567\n', ['氏名', '住所', '電話', '備考']],
    ['name,url\nA,https://a.com,x\nB,https://b.com,y\nC,https://c.com\n', ['name', 'url', '列3']],
    ['氏名,住所,電話,\n山田,東京,03\n', ['氏名', '住所', '電話', '列4']],
    ['備考\n注意：割れ物\n至急：本日中\n', ['備考']],
    [`備考\n${Array.from({ length: 10 }, (_, i) => `注意：項目${i}`).join('\n')}\n`, ['備考']],
    ['メモ\n時刻：10:00\n場所：A\n', ['メモ']],
    ['日付\n2024/04/01 (月)\n2024/04/02 (火)\n', ['日付']],
  ];
  for (const [csv, columns] of cases) {
    const t = await read(csv);
    assert.equal(t.meta.source, 'csv', csv);
    assert.deepEqual(t.columns, columns, csv);
  }
});

test('テキスト: 電話番号のパターンが時刻・日付の一部を取り込まない', async () => {
  const r = await tidy('受付 9:00〜18:00 03-1234-5678\n予約 2024-04-01 06-1234-5678\n担当 (03)1234-5678 へ\n');
  assert.deepEqual(r.data.map((d) => d.電話番号), ['03-1234-5678', '06-1234-5678', '03-1234-5678']);
  assert.equal(r.data[1].日付, '2024-04-01');
  assert.equal(r.data[0].本文, '受付 9:00〜18:00');
});

test('テキスト: URLの後の日本語・英字1文字の元号・秒つきの時刻', async () => {
  const t = await read('詳細は https://example.com/aをご覧ください。\n申込は https://example.com/b から。大阪府 T 4-5-6\n2026-10-01 10:00:05 INFO 起動\n');
  const col = (n) => t.rows.map((r) => r[t.columns.indexOf(n)]);
  assert.deepEqual(col('URL').slice(0, 2), ['https://example.com/a', 'https://example.com/b']);
  assert.deepEqual(col('日付'), ['', '', '2026-10-01 10:00:05']);
});

test('テキスト: 空白のない文章も抜き出し・抜き出すもののない文章は本文', async () => {
  const a = await read('令和6年4月1日に開始しました\n令和6年5月1日に終了しました\n令和6年6月1日に再開しました\n');
  assert.deepEqual(a.columns, ['本文', '日付']);
  const b = await read('今日は良い天気です。\n明日も晴れるでしょう。\n来週は雨の予定です。\n');
  assert.deepEqual(b.columns, ['本文']);
  assert.equal(b.rows.length, 3);
});

test('テキスト: メールの引用・区切り線・値の中の段落・番号付きの項目', () => {
  const q = readText('お名前：山田\nメール：a@example.com\n> お名前：前の人\n=====\nお名前：佐藤\nメール：b@example.com\n');
  assert.deepEqual(q.columns, ['お名前', 'メール']);
  assert.equal(q.rows.length, 2);
  const p = readText('氏名：山田\n内容：商品について\n質問があります。\n\nよろしくお願いします。\n\n氏名：佐藤\n内容：返品\n');
  assert.equal(p.rows[0][1], '商品について\n質問があります。\n\nよろしくお願いします。');
  const n = readText('氏名：山田\n住所：東京\n電話1：03-1234-5678\n電話2：090-1234-5678\n部署：営業\n');
  assert.deepEqual(n.columns, ['氏名', '住所', '電話1', '電話2', '部署']);
});

test('テキスト: 空白でそろえた表の空欄で列がずれない', () => {
  const t = readText('氏名      部署      電話\n山田      営業      03-1111-2222\n佐藤                06-1111-2222\n鈴木      総務      03-3333-4444\n');
  assert.deepEqual(t.rows[1], ['佐藤', '', '06-1111-2222']);
});

test('テキスト: 長い行でも時間が行の長さに比例する', async () => {
  for (const s of ['あ\n' + '1,'.repeat(100000) + 'x', 'a\nb x\n' + ' '.repeat(100000) + 'x', 'b c\n' + 'a'.repeat(100000)]) {
    const t = Date.now();
    await read(s);
    assert.ok(Date.now() - t < 2000, `${Date.now() - t}ms`);
  }
});

test('HTML: リンクで囲んだカード・<br>区切りのカード・時刻・件ごとに違う見出し', async () => {
  const a = await read('<ul>' + [1, 2, 3].map((i) => `<li class="card"><a href="/p/${i}"><span class="name">商品${i}</span><span class="price">¥1,000</span></a></li>`).join('') + '</ul>');
  assert.deepEqual(a.columns, ['name', 'price', 'リンク']);
  const b = await read('<div>' + [1, 2, 3].map((i) => `<div class=card>名前：A${i}<br>価格：100円<br>TEL：03-1111-222${i}</div>`).join('') + '</div>');
  assert.deepEqual(b.columns, ['名前', '価格', 'TEL']);
  const c = await read('<ul>' + ['新宿', '渋谷', '池袋'].map((n) => `<li class="shop"><h3 class="name">${n}</h3><span class="hours">10:00〜19:00</span></li>`).join('') + '</ul>');
  assert.deepEqual(c.rows[0], ['新宿', '10:00〜19:00']);
  const d = await read('<div>' + ['セール：春', '新商品：夏', '限定：秋'].map((t) => `<div class="item"><h3 class="title">${t}</h3><span class="price">¥100</span></div>`).join('') + '</div>');
  assert.deepEqual(d.columns, ['title', 'price']);
  assert.equal(d.rows[0][0], 'セール：春');
});

test('HTML: お知らせの dt/dd・閉じタグの省略・リンクだけのメニュー・全件同じ値の列', async () => {
  const news = await read('<dl class=news>' + [1, 2, 3].map((i) => `<dt>2026.10.0${i}</dt><dd><a href=/a${i}>お知らせ${i}</a></dd>`).join('') + '</dl>');
  assert.deepEqual(news.rows[0], ['2026.10.01', 'お知らせ1', '/a1']);
  const open = await read('<ul>' + [1, 2, 3].map((i) => `<li class=r><b>T${i}</b><p>説明${i}`).join('') + '</ul>');
  assert.equal(open.rows.length, 3);
  const menu = await read('<ul><li><a href=/a>Home</a></li><li><a href=/b>About</a></li><li><a href=/c>News</a></li></ul>');
  assert.equal(menu.rows.length, 0);
  const pref = await read('<ul>' + [1, 2, 3].map((i) => `<li class=s><b class=name>店${i}</b><span class=pref>東京都</span><a href=/s/${i}>詳しく見る</a></li>`).join('') + '</ul>');
  assert.deepEqual(pref.columns, ['name', 'pref', 'リンク']);
});

test('HTML: rowspan は同じ tbody・thead の中まで・空の角の2段見出し・自分で閉じる svg・href の末尾の /', async () => {
  assert.equal((await read('<table><tr><th>地域</th><th>店</th></tr><tr><td>東京</td><td>A</td></tr><tr><td rowspan=3>大阪</td><td>B</td></tr></table>')).rows.length, 2);
  assert.deepEqual((await read('<table><thead><tr><th rowspan=2>名前</th><th>電話</th></tr></thead><tbody><tr><td>山田</td><td>03</td></tr></tbody></table>')).rows, [['山田', '03']]);
  assert.deepEqual((await read('<table><tr><td></td><th colspan=2>売上</th></tr><tr><td></td><th>上期</th><th>下期</th></tr><tr><td>本店</td><td>1</td><td>2</td></tr></table>')).columns, ['列1', '売上・上期', '売上・下期']);
  assert.deepEqual((await read('<table><tr><th>a</th><th>b</th></tr><tr><td><svg class=i /></td><td>1</td></tr><tr><td>X</td><td>2</td></tr></table>')).rows, [['', '1'], ['X', '2']]);
  const root = parseHTML('<a href=/p/1/>タイトル</a>');
  assert.equal(textContent(root.children[0]), 'タイトル');
});

test('HTML: <meta> などで始まるHTML・タグの断片を判定する', async () => {
  assert.equal((await read('<meta charset="utf-8"><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>')).meta.source, 'html');
  assert.equal((await read('<li class=x><b>A</b><i>1</i></li><li class=x><b>B</b><i>2</i></li><li class=x><b>C</b><i>3</i></li>')).rows.length, 3);
  assert.equal((await read('<メモ>,金額\nx,1\n')).meta.source, 'csv');
});

test('HTML: 深い入れ子・多数の svg・閉じない < でも落ちず、時間が長さに比例する', async () => {
  for (const h of ['<div>'.repeat(20000) + 'x', '<ul>' + '<li><svg><path/></svg>x</li>'.repeat(20000) + '</ul>', '<a '.repeat(40000), '<table><tr>' + '<td rowspan=1000 colspan=100>x</td>'.repeat(20) + '</tr></table>']) {
    const t = Date.now();
    await read(h, { format: 'html' });
    assert.ok(Date.now() - t < 3000, `${Date.now() - t}ms`);
  }
});
