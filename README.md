# nihon-tidy

日本語データの**列の種類を推論**し、**自動で正規化**して、**何を変えたかをHTMLレポートで出す** JavaScriptライブラリです。

- ブラウザだけで動きます（データを外部に送りません）。Node.jsでも動きます。
- 実行時の依存パッケージはありません。
- 変更はすべて記録されます。確信度の低い変換は適用せず「提案」として残します。

> v1.0。公開APIは[セマンティック バージョニング](https://semver.org/lang/ja/)に従います（下記「API」）。変更履歴は [CHANGELOG.md](CHANGELOG.md)。

## インストール

```sh
npm install nihon-tidy
```

Node.js 18以上、または ES Modules と `DecompressionStream` に対応したブラウザで動きます。TypeScript の型定義を同梱しています。

## できること

| 列の種類 | 入力 → 正規化後 |
|---|---|
| 日付 | `令和6年4月1日` → `2024-04-01`、`S60.4.1` → `1985-04-01`、`2024/4/1 9:05` → `2024-04-01 09:05`、`20240401`※ → `2024-04-01` |
| 電話番号 | `０３（１２３４）５６７８` → `03-1234-5678`、`+81 6-1234-5678` → `06-1234-5678`、`09012345678`※ → `090-1234-5678` |
| 郵便番号 | `〒100-0001` → `100-0001`、`〒150ー0002` → `150-0002`、`1000001`※ → `100-0001` |
| 数値 | `¥12,000` → `12000`、`1万2千円` → `12000`、`△500` → `-500`、`(1,200)` → `-1200` |
| 真偽値 | `○` → `true`、`×` → `false`（`有` `無` `済` `未` は、列名が「会員」「有無」などのときだけ自動、それ以外は提案） |
| フリガナ | `やまだ たろう` / `ﾔﾏﾀﾞ ﾀﾛｳ` → `ヤマダ タロウ` |
| メールアドレス | `Info@ABC.CO.JP` → `Info@abc.co.jp` |
| すべての列 | 全角英数字→半角、半角カナ→全角、`㈱`→`(株)`、余分な空白を詰める（NFKC正規化） |

※ 数字だけの値は、列名にヒント（「日」で終わる・「日付」「電話」「郵便」など）がある場合だけ変換します。Excelのシリアル値（`45383`）と市外局番の桁数を推測する電話番号（`0451234567`）は、確信度が低いので**提案**にとどめます。

### 迷ったら変換しない

正規化で一番困るのは、ライブラリが黙ってデータを壊すことです。紛らわしいものは変換せず、テキストのまま残すか「提案」にします。

- 先頭が0の数字（`0012`）、16桁以上の整数（口座番号など）、`(1)` のような番号、不正な桁区切り（`1,2,3`）は数値にしない
- 列名にヒントのない数字だけのID（`09012345678`）は電話番号にしない。「日数」「日当」は日付にしない
- 「有・無・要確認」のように一部だけ一致する列は真偽値にしない
- 元号の期間外の和暦（`令和元年4月1日`、`昭和64年1月10日`）は提案にとどめる
- 丸数字（`①`）・分数（`½`）・上付き数字（`m²`）・波ダッシュ（`～`）は意味が変わるのでNFKCをかけない。セル内の改行は残す
- 型のある列の `-` `N/A` などは、値がないことを表す記号として空にする（変更ログに残る）
- 見出しより多いセルは捨てずに列を足し、要確認に挙げる。同じ名前の列は `名前_2` のように番号を付けて両方残す

### 表記ゆれの統一

テキストの列で、同じものを指す別の表記をまとめ、最も多い表記に揃えます。

| まとめ方 | 例 | 扱い |
|---|---|---|
| 厳密 | `(株)ABC` / `株式会社ＡＢＣ` / `株式会社 ABC` ・ `(有)さくら商店` / `有限会社サクラ商店` | 自動で統一 |
| 緩い | `株式会社ABC` / `ABC株式会社`（前株・後株） | **提案のみ**（別の会社の場合があるため） |

比較には法人格の略称の展開、空白・記号の除去、ひらがな→カタカナ、大文字・小文字の無視を使います。ただし数字と数字の間の区切りは区別するので、`港区1-23` と `港区12-3`、`ver1.5` と `ver15` はまとめません。法人格の種類が違うもの（`(有)ABC` と `(株)ABC`）は提案もしません。`cluster: false` で無効にできます（列ごとは `columns: { 備考: { cluster: false } }`）。

### 要確認をその場で直す

解釈できなかった値・確信度の低い提案・表記ゆれの候補を一覧にし、ブラウザ上で直せます。

- 「提案を適用」「この値にする」（手入力）「そのまま」「提案をすべて適用」
- 表記ゆれのまとまりごとに、統一後の表記を選び直す
- 直した結果を CSV（Excelで開けるBOM付き。`=` `@` などで始まる値は数式として実行されないよう先頭に `'` を付ける）/ JSON で保存
- 直した内容も変更ログに「手動」として残り、分析レポートに反映されます

### 住所の正規化（プラグイン）

```js
import { tidy } from 'nihon-tidy';
await tidy(file, { plugins: ['address'] }); // または import address from 'nihon-tidy/address' して plugins: [address()]
```

「**確実に分かる形だけを変える**」方式です。町名のあとの番地の部分（最初の空白まで）が、全体として決まった形（`4丁目6番16号`・`4丁目6番地16`・`十二番地`・`123番地の4`・`1ー2ー3`・`一の一` など）のときだけ `4-6-16` の形にし、それ以外は何も変えません。

| 入力 → 結果 | 扱い |
|---|---|
| `東京都中央区銀座四丁目6番16号` → `東京都中央区銀座4-6-16` | 自動（丁目・番地・号・漢数字・ハイフンの統一） |
| `〒100ー0001 東京都千代田区千代田1-1` → `〒100-0001 東京都千代田区千代田1-1` | 自動 |
| `大阪市北区梅田1丁目1番地` → `大阪市北区梅田1-1`、さらに `大阪府大阪市北区梅田1-1` を**提案** | 番地の統一は自動、都道府県の補完（政令指定都市から）は提案 |
| `千代田区丸の内二丁目7番2号` → `千代田区丸の内2-7-2`、さらに `東京都千代田区丸の内2-7-2` を**提案** | 都道府県の補完（東京23区から）は提案 |
| `港区六本木6-10-1`・`府中市宮西町2-24` | 補わない（同じ名前の区・市がほかの都市にある） |
| `東京都港区赤坂1丁目2番地 405号室` → `東京都港区赤坂1-2 405号室` | 空白のあと（建物名・階・部屋番号）には触れない |
| `東京都千代田区三番町6-1`・`東京都港区麻布十番2-3-1` | 変えない（地名の中の漢数字はそのまま） |
| `愛知県名古屋市中区三の丸三丁目1番2号` → `愛知県名古屋市中区三の丸3-1-2` | 番地の部分だけ数字にする |
| `東京都新宿区歌舞伎町1-2-3一番街ビル`・`…1丁目9番1号B1F`・`…12番地先`・`…芝〇丁目〇番〇号` | 変えない（番地のあとに空白なしで何か続く・伏せ字） |
| `東京都港区芝1丁目2番 3号` | 変えない（空白のあとが番地の続き） |
| `東京府千代田区1-1` | 要確認（都道府県名の誤り） |

**住所の列と判定する条件**：都道府県で始まり、町名のあとに決まった形の番地があること。都道府県がない値は、「〜市」「〜区」のあとに町名と、丁目・番・号かハイフンを含む番地が続くこと。そのため「中村1」「港区みなと祭り2024」「新宿区立第2小学校」「北海道大学 第二号館」のような名前の列は住所にしません。都道府県だけの値は、列名が「住所」「所在地」などのときだけ住所とみなします。

`parseAddress('三重県四日市市諏訪町1-5')` で `{ postal, prefecture, city, rest }` に分けられます（「四日市市」「廿日市市」のような名前も扱います）。辞書を持たない軽量版なので、市区町村が実在するかの確認や、全国の市町村からの都道府県の補完はしません。必要なら、辞書を持つ専用のライブラリを独自のプラグインとして組み合わせてください。

### プラグイン

列の種類の規則を足せます。規則は `{ type, label, hint?, minRatio?, match(value, ctx), normalize(value, ctx) }` で、`normalize` は `{ value, confidence, note }` か `null`（解釈できない）を返します。`suggest: { value, confidence, note }` も返すと、`value` を適用したうえで別の提案として残します。プラグインの規則は組み込みの規則より先に試し、組み込みと同じ `type`（`phone` など）なら列の判定にも正規化にもプラグインの規則を使います。規則の形が違う・`match` や `normalize` がエラーを出した場合は、プラグイン名と規則名の付いたエラーになります。

`columns: { 住所: { type: 'address' } }` のように、存在しない種類（プラグインを指定していない `address` など）を指定するとエラーになります。

```js
const sku = {
  type: 'sku', label: '品番', hint: /品番/,
  match: (v) => /^[a-z]{2}-?\d{4}$/i.test(v),
  normalize: (v) => ({ value: v.toUpperCase().replace(/^([A-Z]{2})-?/, '$1-'), confidence: 1, note: '品番の書式を統一' }),
};
await tidy(file, { plugins: [{ name: 'sku', rules: [sku] }] });
```

### 大きなファイル（Web Worker）

```js
import { tidyInWorker } from 'nihon-tidy';
const result = await tidyInWorker(file, { plugins: ['address'] }); // tidy と同じ結果。画面を止めない
```

`<tidy-table worker>` でも使えます。Worker には関数を渡せないので、プラグインは名前で指定します（どの環境でも、オブジェクトで渡すとエラー）。

Worker が使えない場合は、メインスレッドで `tidy` を呼びます（コンソールに一度だけ注意を出します）：Node.js、ライブラリを別のオリジン（CDNなど）から読み込んだ場合（ブラウザの制限で Worker を作れない）、バンドラーが `worker.js` を出力しない場合。画面を止めたくない場合は、ライブラリをページと同じオリジンに置いてください。

処理時間はデータと環境によります（例：10万行×4列のCSVで数秒。Worker では結果の受け渡しの分だけ長くかかりますが、その間も画面は止まりません）。`tidyInWorker` では `ruleSet` は使えません（関数を Worker に渡せないため）。

### 入力

| 形式 | 対応内容 |
|---|---|
| CSV / TSV | 文字コードを自動判定（UTF-8・**Shift_JIS**・UTF-16）、区切り文字の推定、引用符内の改行 |
| JSON | ネストは `user.name` のように平らにする。配列は `1 / 2`、オブジェクトの配列はJSON文字列にする |
| Excel（.xlsx） | 外部ライブラリなしで読み込み。**結合セルを埋める**（縦に結合した「地域」など）、**タイトル行を飛ばして見出し行を探す**、日付・日時・時刻の書式（和暦書式を含む）のセルを変換、1904年基準のブック、ふりがな（rPh）を除去、シートの選択。LibreOfficeで保存したファイルにも対応 |
| HTML（スクレイピング結果） | 外部ライブラリなしで解析し、次の中から**取り出せるセルが最も多いもの**を使う（下記） |
| テキスト（.txt・貼り付けた文章） | 区切り文字の表、「項目：値」のまとまり、空白でそろえた表、文章からの抜き出し（下記） |
| オブジェクトの配列 | そのまま（`Date` は日付の文字列にする） |

#### HTMLの読み取り方

| 読み取り方 | 対象 | 1行になるもの |
|---|---|---|
| 表 | `<table>`。`colspan`・`rowspan` を展開し（`rowspan` は同じ `thead`・`tbody` の中まで）、2段の見出しは `売上・上期` のようにつなぐ。左上が空欄の見出しにも対応 | 表の1行 |
| 繰り返し構造 | 同じ形の要素が3つ以上並んだもの（商品カード・店舗一覧・検索結果など）と、`<dt>日付</dt><dd>見出し</dd>` のお知らせ一覧 | 要素1つ |
| 詳細ページ | ページ全体の `<dt>/<dd>`・縦の「項目｜値」の表・「項目：値」の行が3つ以上 | ページ全体で1行 |

- 取り出せるセルが最も多い候補を使います（同じなら表を優先）。詳細ページは、表と繰り返し構造のどちらもないときだけ使います。
- 繰り返し構造の項目名は `class`・`itemprop`・`<dt>`・`<th>`・`<br>` で区切った「TEL：…」の見出しから付け、最初のリンク先を `リンク` 列にします。リンクで囲まれたカードは中の要素ごとに分けます。
- 除くもの：リンク先を除いて項目が2つ未満の繰り返し（メニューなど）、3割未満の件にしかない項目、全件同じ文字のリンク・ボタン（「詳しく見る」）。全件同じ値でもリンク以外の列（全部「東京都」など）は残します。
- 「項目：値」の見出しが2件未満の件にしか出てこない場合（「セール：春の新作」のような見出し）は、項目名とみなしません。時刻（`10:00〜19:00`）のコロンも区切りとみなしません。
- 閉じタグの省略（`</li>` `</p>` `</td>` など）はブラウザと同じように補います。`<script>`・`<style>`・`<template>`・`<noscript>`・`<svg>`・コメントは読み飛ばし、画像は `alt` を文字として使います。入れ子が512段より深い部分は平らにします。
- `<meta charset>` は見ません（文字コードはバイト列から判定）。EUC-JP には未対応です。
- ページ内の表を指定するときは `table: 0`（CLIは `--table 0`）。指定すると繰り返し構造と詳細ページは探しません。HTML以外の入力では無視されます。
- 結果の `meta` には、使った読み取り方 `how`・ページ内の表の数 `tables`・ページの `title` が入ります（`how` はレポートとCLIにも表示）。

#### テキストの読み取り方

次の順に試し、最初に当てはまったものを使います。

1. **区切り文字の表**：区切り文字（カンマ・タブなど）が6割以上の行にあればCSVとして読む。列数がそろっていなくても（末尾の空欄を省いた出力・タイトル行があっても）CSV
2. **「項目：値」のまとまり**（フォームの通知メール・問い合わせ一覧など）。`氏名：山田`・`【氏名】山田`・`■氏名：山田` に対応
   - 「項目：値」の行とその続きの行が6割以上で、さらに「1行目が項目：値」「項目が2種類以上あり、どれかが繰り返し出てくる」「空行で区切ったまとまりが2つ以上」のどれかに当てはまること（`備考` の下に `注意：…` が並ぶ1列の表と区別するため）
   - 空行か、同じ項目の再登場で1件を区切る。項目のない行は直前の値の続き（空行をはさんだ段落も含める）
   - 時刻（`受付 9:05`）・URL（`https://`）・数字だけの項目のコロンは区切りとみなさない。`電話1：…` のような番号付きの項目は使える
   - メールの引用（`>` で始まる行）・署名（`--` の行から次の空行まで）・区切り線（`=====` など）は取り除く。項目が1つだけの断片（署名の `TEL：…` など）は直前の1件に含める
3. **空白でそろえた表**（2つ以上の空白・全角空白・タブ）。値の位置から列を決めるので、空欄があってもずれない
4. **文章からの抜き出し**：値と文章が混ざった行が半分以上あれば、行（空行で区切ったまとまりがあればまとまり）ごとに、日付（曜日・時刻つきも）・電話番号・郵便番号・メール・URL・金額を抜き出して列にし、残りを `本文` にする。`TEL：` などの見出しは本文から取り除く
5. **文章**：句点で終わる行や長い行が大半なら、1行（まとまり）を1件の `本文` にする

どれにも当てはまらないもの（1列だけの表など）は、従来どおり1列のCSVとして読みます。長い行でも処理時間が行の長さに比例するようにしています。

旧形式の `.xls` には未対応です。Excelの見出しが2段以上ある表は、最初に見つかった見出し行だけを使います（結合した見出しは `連絡先`・`連絡先_2` のようになります）。

## 使い方

### ブラウザ（コンテンツHTML）

```html
<div id="app"></div>
<script type="module">
  import { tidy } from 'nihon-tidy'; // CDN なら 'https://cdn.jsdelivr.net/npm/nihon-tidy/+esm'

  const input = document.querySelector('input[type=file]');
  input.addEventListener('change', async () => {
    const result = await tidy(input.files[0]);
    result.render('#app', { view: 'cards' }); // 'table' | 'cards'。検索・並べ替えつき
    result.renderReview('#review');            // 要確認を直す画面
    const reportHTML = result.toReport();  // 分析レポートHTML
  });
</script>
```

デモは `examples/content.html` にあります（CSV・Excel・HTML・テキストのサンプル付き）。ES Modulesを使うため、ローカルサーバー経由で開いてください。

```sh
python3 -m http.server 8000
# http://localhost:8000/examples/content.html
```

### Web Component（タグを置くだけ）

```html
<script type="module">import 'nihon-tidy/element';</script>
<!-- CDN なら <script type="module" src="https://cdn.jsdelivr.net/npm/nihon-tidy/src/view/element.js"></script> -->

<tidy-table src="customers.xlsx" view="cards" title-column="顧客名" report-button></tidy-table>
```

| 属性 | 内容 |
|---|---|
| `src` | 読み込むファイルのURL |
| `view` | `table`（既定）か `cards` |
| `title-column` | カードの見出しにする列（既定は最初のテキスト列） |
| `sheet` | Excelのシート名か番号 |
| `min-confidence` | これ未満の変換は提案にとどめる（既定 0.9） |
| `report-button` | 「分析レポートを開く」ボタンを表示 |
| `review` | 要確認を直す画面を表の上に表示 |
| `plugins` | プラグイン（`address` など、カンマ区切り） |
| `worker` | Web Worker で処理して画面を止めない |

JavaScriptから `element.input = file` で処理させたり、`element.result` で結果を読んだり、`element.openReport()` でレポートを開いたりできます。イベントは `tidy-load`（読み込み完了）・`tidy-change`（修正のたび）・`tidy-error`（読み込みの失敗）で、結果やエラーは `e.detail` に入ります。デモは `examples/element.html` です。

### Node.js / CLI

```sh
node bin/cli.js examples/sample-sjis.csv --report report.html --out output.json
node bin/cli.js examples/sample.xlsx --sheet 顧客一覧 --out output.csv   # CSVはBOM付き
node bin/cli.js examples/sample-scrape.html --table 0                         # HTMLのページ内の表を選ぶ
node bin/cli.js examples/sample-kv.txt --format text                         # 形式を指定
node bin/cli.js data.csv --plugins address                                   # 住所の正規化
node bin/cli.js data.csv --min-confidence 0.8                                # --help で一覧
```

npm からインストールした場合は `npx nihon-tidy data.csv …` で使えます。

```js
import { tidy } from 'nihon-tidy';

const result = await tidy(csvText, {
  columns: { 社員コード: { type: 'text' } }, // 推論を上書き（列ごとに cluster: false も指定可）
  minConfidence: 0.9,                        // これ未満の変換は提案にとどめる
  cluster: true,                             // 表記ゆれの統一
  plugins: ['address'],                      // プラグイン
  // 読み込み：format（'csv'|'json'|'xlsx'|'html'|'text'）・delimiter・header（false で見出しなし）・sheet・headerRow・table
  // 推論：threshold（既定 0.7）・hintedThreshold（列名にヒントがある場合、既定 0.5）
});

result.data      // 正規化済みのレコード
result.schema    // 列の種類・確信度・他の候補
result.changes   // { row, column, before, after, rule, note, confidence, applied }
result.issues    // 解釈できなかった値・未適用の提案
result.clusters  // 表記ゆれのまとまり { column, canonical, variants, confidence, applied, rows }
result.toReport() // 分析レポートHTML（1ファイルで完結）
result.toReport({ title: '顧客データ' })   // 見出しも変えられる
result.toCSV({ bom: true })   // safe: false で数式インジェクション対策を外す
result.toJSON()
result.toPlain()      // その時点の写し（素のオブジェクト）。保存したものは hydrate(plain) で操作を付け直せる（hydrate は配列をコピーせず共有する）
result.toTableHTML() / result.toCardsHTML({ titleColumn: '顧客名' }) // 文字列のHTML（サーバー側で使う場合）
result.render(el, { view: 'table', placeholder: '検索', style: false }) // style: false で既定のCSSを入れない

// 修正（Node.jsでも使える）。fix・accept・setCanonical は変更ログに残る
result.fix(row, '登録日', '2024-04-02') // 任意の値に直す
result.accept(row, '電話番号')          // 未適用の提案を適用
result.dismiss(row, '電話番号')         // 今の値のままにする（提案は「見送り」として残る）
result.acceptAll()                      // 提案をすべて適用
result.setCanonical(0, '(株)ABC')       // 表記ゆれの統一先を選び直す
```

段階ごとに `read` → `detect` → `normalize` → `cluster` → `toReport` を個別に呼ぶこともできます（プラグインは `plugins: [address()]` のようにオブジェクトで渡すか、`ruleSet: ruleSet(address().rules)` を渡します。名前での指定は `tidy` だけ。`ruleSet` は `tidy` でも使え、`plugins` より優先します）。比較用の `fingerprint`、規則の一覧 `rules` も公開しています。

## API

次のものを公開APIとし、1.x の間は互換性を保ちます（型は [index.d.ts](index.d.ts)）。

| 読み込み先 | 公開しているもの |
|---|---|
| `nihon-tidy` | `tidy`・`tidyInWorker`・`hydrate`・`read`・`detect`・`normalize`・`cluster`・`toReport`・`toCSV`・`toTableHTML`・`toCardsHTML`・`render`・`renderReview`・`fingerprint`・`rules`・`ruleSet`、処理結果のプロパティとメソッド、`TidyOptions` のオプション |
| `nihon-tidy/address` | `address()`・`parseAddress`・`normalizeBlock`・`kanjiToNumber`・`addressRule`・`PREFECTURES` |
| `nihon-tidy/element` | `<tidy-table>` の属性・プロパティ・イベント |
| `nihon-tidy/view` | `render`・`toTableHTML`・`toCardsHTML`・`format`（値を表示用の文字列に）・`STYLE`（既定のCSS） |
| CLI | `nihon-tidy` のオプション |

`src/worker.js` は `tidyInWorker` が内部で使うもので、公開APIではありません。

次のものは公開APIに含めません（マイナーバージョンでも変わることがあります）：推論・正規化の結果そのもの（判定の改善で、同じ入力でも結果が変わることがあります）、`change.note`・`issue.reason`・`meta.how` の文言、分析レポートHTMLの見た目、`src/` の中のその他のモジュール。

## 構成

```
src/
  read/      入力の読み込み（文字コード判定・CSV・JSON・Excel・ZIP展開・HTML・テキスト）
  rules/     日本語の正規化規則（日付・電話・郵便番号・数値…）
  detect.js  列の種類の推論
  normalize.js 正規化と変更ログ
  cluster.js 表記ゆれの統一
  fix.js     要確認の修正（fix / accept / dismiss）
  plugins/   プラグイン（address：住所の正規化）
  worker.js・worker-client.js  Web Worker での処理
  report/    分析レポートHTMLの生成
  view/      コンテンツHTML用の表示（表・カード・修正画面・<tidy-table>）
bin/cli.js   コマンドライン
index.d.ts・types/  型定義
scripts/     サンプルデータの生成
```

## ロードマップ

- [x] v0.1 CSV/JSON、Shift_JIS、日付・電話・郵便番号・数値ほか、変更ログ、分析レポートHTML、表の表示
- [x] v0.2 Excel（.xlsx、依存なし）、カード表示、Web Component（`<tidy-table>`）
- [x] v0.3 表記ゆれの統一（「(株)ABC」「株式会社ABC」）、要確認をその場で直す画面
- [x] v0.4 スクレイピング結果（HTMLの表・繰り返し構造・詳細ページ）、構造のないテキストの推論
- [x] v1.0 住所の正規化プラグイン、Web Worker対応、API安定化（型定義・CI）、npm公開の準備

今後の候補：辞書を使う住所プラグイン（市区町村の実在確認・全国からの都道府県の補完）、EUC-JP、Excelの2段見出し、表示の仮想スクロール（数万行）

## 開発

```sh
npm test               # node:test（CI は Node.js 18・20・22）
npm run example        # サンプルからレポートを生成
npm pack --dry-run     # 公開される中身の確認
npm publish            # 公開（npm のアカウントで。publish の前に npm test が走る）
```

## ライセンス

MIT
