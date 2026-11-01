# nihon-tidy

日本語データの**列の種類を推論**し、**自動で正規化**して、**何を変えたかをHTMLレポートで出す** JavaScriptライブラリです。

- ブラウザだけで動きます（データを外部に送りません）。Node.jsでも動きます。
- 実行時の依存パッケージはありません。
- 変更はすべて記録されます。確信度の低い変換は適用せず「提案」として残します。

> 開発中（v0.3.1）です。APIは変わる可能性があります。

## できること（v0.3）

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

### 入力

| 形式 | 対応内容 |
|---|---|
| CSV / TSV | 文字コードを自動判定（UTF-8・**Shift_JIS**・UTF-16）、区切り文字の推定、引用符内の改行 |
| JSON | ネストは `user.name` のように平らにする。配列は `1 / 2`、オブジェクトの配列はJSON文字列にする |
| Excel（.xlsx） | 外部ライブラリなしで読み込み。**結合セルを埋める**（縦に結合した「地域」など）、**タイトル行を飛ばして見出し行を探す**、日付・日時・時刻の書式（和暦書式を含む）のセルを変換、1904年基準のブック、ふりがな（rPh）を除去、シートの選択。LibreOfficeで保存したファイルにも対応 |
| オブジェクトの配列 | そのまま（`Date` は日付の文字列にする） |

旧形式の `.xls` には未対応です。Excelの見出しが2段以上ある表は、最初に見つかった見出し行だけを使います（結合した見出しは `連絡先`・`連絡先_2` のようになります）。

## 使い方

### ブラウザ（コンテンツHTML）

```html
<div id="app"></div>
<script type="module">
  import { tidy } from './src/index.js';

  const input = document.querySelector('input[type=file]');
  input.addEventListener('change', async () => {
    const result = await tidy(input.files[0]);
    result.render('#app', { view: 'cards' }); // 'table' | 'cards'。検索・並べ替えつき
    result.renderReview('#review');            // 要確認を直す画面
    const reportHTML = result.toReport();  // 分析レポートHTML
  });
</script>
```

デモは `examples/content.html` にあります。ES Modulesを使うため、ローカルサーバー経由で開いてください。

```sh
python3 -m http.server 8000
# http://localhost:8000/examples/content.html
```

### Web Component（タグを置くだけ）

```html
<!-- npmからは import 'nihon-tidy/element' -->
<script type="module" src="./src/view/element.js"></script>

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

JavaScriptから `element.input = file` で処理させたり、`element.result` で結果を読んだり、`element.openReport()` でレポートを開いたりできます。イベントは `tidy-load`（読み込み完了）・`tidy-change`（修正のたび）・`tidy-error`（読み込みの失敗）で、結果やエラーは `e.detail` に入ります。デモは `examples/element.html` です。

### Node.js / CLI

```sh
node bin/cli.js examples/sample-sjis.csv --report report.html --out output.json
node bin/cli.js examples/sample.xlsx --sheet 顧客一覧 --out output.csv   # CSVはBOM付き
node bin/cli.js data.csv --min-confidence 0.8                                # --help で一覧
```

```js
import { tidy } from 'nihon-tidy';

const result = await tidy(csvText, {
  columns: { 社員コード: { type: 'text' } }, // 推論を上書き（列ごとに cluster: false も指定可）
  minConfidence: 0.9,                        // これ未満の変換は提案にとどめる
  cluster: true,                             // 表記ゆれの統一
  // 読み込み：format（'csv'|'json'|'xlsx'）・delimiter・header（false で見出しなし）・sheet・headerRow
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
result.toTableHTML() / result.toCardsHTML({ titleColumn: '顧客名' }) // 文字列のHTML（サーバー側で使う場合）
result.render(el, { view: 'table', placeholder: '検索', style: false }) // style: false で既定のCSSを入れない

// 修正（Node.jsでも使える）。fix・accept・setCanonical は変更ログに残る
result.fix(row, '登録日', '2024-04-02') // 任意の値に直す
result.accept(row, '電話番号')          // 未適用の提案を適用
result.dismiss(row, '電話番号')         // 今の値のままにする（提案は「見送り」として残る）
result.acceptAll()                      // 提案をすべて適用
result.setCanonical(0, '(株)ABC')       // 表記ゆれの統一先を選び直す
```

段階ごとに `read` → `detect` → `normalize` → `cluster` → `toReport` を個別に呼ぶこともできます。比較用の `fingerprint`、規則の一覧 `rules` も公開しています。

## 構成

```
src/
  read/      入力の読み込み（文字コード判定・CSV・JSON・Excel・ZIP展開）
  rules/     日本語の正規化規則（日付・電話・郵便番号・数値…）
  detect.js  列の種類の推論
  normalize.js 正規化と変更ログ
  cluster.js 表記ゆれの統一
  fix.js     要確認の修正（fix / accept / dismiss）
  report/    分析レポートHTMLの生成
  view/      コンテンツHTML用の表示（表・カード・修正画面・<tidy-table>）
bin/cli.js   コマンドライン
scripts/     サンプルデータの生成
```

## ロードマップ

- [x] v0.1 CSV/JSON、Shift_JIS、日付・電話・郵便番号・数値ほか、変更ログ、分析レポートHTML、表の表示
- [x] v0.2 Excel（.xlsx、依存なし）、カード表示、Web Component（`<tidy-table>`）
- [x] v0.3 表記ゆれの統一（「(株)ABC」「株式会社ABC」）、要確認をその場で直す画面
- [ ] v0.4 スクレイピング結果（HTMLの表・繰り返し構造）、構造のないテキストの推論
- [ ] v1.0 住所の正規化プラグイン、Web Worker対応、API安定化、npm公開

## 開発

```sh
npm test        # node:test
npm run example # サンプルからレポートを生成
```

## ライセンス

MIT
