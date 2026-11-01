# nihon-tidy

日本語データの**列の種類を推論**し、**自動で正規化**して、**何を変えたかをHTMLレポートで出す** JavaScriptライブラリです。

- ブラウザだけで動きます（データを外部に送りません）。Node.jsでも動きます。
- 実行時の依存パッケージはありません。
- 変更はすべて記録されます。確信度の低い変換は適用せず「提案」として残します。

> 開発中（v0.3）です。APIは変わる可能性があります。

## できること（v0.3）

| 列の種類 | 例 | 正規化後 |
|---|---|---|
| 日付 | `令和6年4月1日` / `S60.4.1` / `2024/4/1` / `20240401`※ / `45383`※（Excelのシリアル値） | `2024-04-01` |
| 電話番号 | `０３（１２３４）５６７８` / `+81 6-1234-5678` / `09012345678` | `03-1234-5678` |
| 郵便番号 | `〒100-0001` / `〒150ー0002` / `1000001`※ | `100-0001` |
| 数値 | `¥12,000` / `1万2千円` / `△500` / `(1,200)` | `12000` / `-500` |
| 真偽値 | `○` `×` `有` `無` `済` `未` | `true` / `false` |
| フリガナ | `やまだ たろう` / `ﾔﾏﾀﾞ ﾀﾛｳ` | `ヤマダ タロウ` |
| メールアドレス | `Info@ABC.CO.JP` | `Info@abc.co.jp` |
| すべての列 | 全角英数字、半角カナ、`㈱`、余分な空白 | NFKC正規化と空白の整理 |

※ 数値と紛らわしい形式は、列名に「日」「郵便」などのヒントがある場合だけ変換します。

### 表記ゆれの統一

テキストの列で、同じものを指す別の表記をまとめ、最も多い表記に揃えます。

| まとめ方 | 例 | 扱い |
|---|---|---|
| 厳密 | `(株)ABC` / `株式会社ＡＢＣ` / `株式会社 ABC` ・ `(有)さくら商店` / `有限会社サクラ商店` | 自動で統一 |
| 緩い | `株式会社ABC` / `ABC株式会社`（前株・後株） | **提案のみ**（別の会社の場合があるため） |

比較には法人格の略称の展開、空白・記号の除去、ひらがな→カタカナ、大文字・小文字の無視を使います。`cluster: false` で無効にできます（列ごとは `columns: { 備考: { cluster: false } }`）。

### 要確認をその場で直す

解釈できなかった値・確信度の低い提案・表記ゆれの候補を一覧にし、ブラウザ上で直せます。

- 「提案を適用」「この値にする」（手入力）「そのまま」「提案をすべて適用」
- 表記ゆれのまとまりごとに、統一後の表記を選び直す
- 直した結果を CSV（Excelで開けるBOM付き）/ JSON で保存
- 直した内容も変更ログに「手動」として残り、分析レポートに反映されます

### 入力

| 形式 | 対応内容 |
|---|---|
| CSV / TSV | **Shift_JISを自動判定**、区切り文字の推定、引用符内の改行 |
| JSON | ネストは `user.name` のように平らにする |
| Excel（.xlsx） | 外部ライブラリなしで読み込み。**結合セルを埋める**（縦に結合した「地域」など）、**タイトル行を飛ばして見出し行を探す**、日付書式（和暦書式を含む）のセルを日付に変換、ふりがな（rPh）を除去、シートの選択 |
| オブジェクトの配列 | そのまま |

旧形式の `.xls` には未対応です。

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

JavaScriptから `element.input = file` で処理させたり、`tidy-load`（読み込み完了）・`tidy-change`（修正のたび）イベントで結果（`e.detail`）を受け取ったりできます。デモは `examples/element.html` です。

### Node.js / CLI

```sh
node bin/cli.js examples/sample-sjis.csv --report report.html --out output.json
node bin/cli.js examples/sample.xlsx --sheet 顧客一覧 --out output.csv
```

```js
import { tidy } from 'nihon-tidy';

const result = await tidy(csvText, {
  columns: { 社員コード: { type: 'text' } }, // 推論を上書き
  minConfidence: 0.9,                        // これ未満の変換は提案にとどめる
});

result.data      // 正規化済みのレコード
result.schema    // 列の種類・確信度・他の候補
result.changes   // { row, column, before, after, rule, note, confidence, applied }
result.issues    // 解釈できなかった値・未適用の提案
result.clusters  // 表記ゆれのまとまり { column, canonical, variants, confidence, applied, rows }
result.toReport() // 分析レポートHTML（1ファイルで完結）
result.toCSV()
result.toTableHTML() / result.toCardsHTML() // 文字列のHTML（サーバー側で使う場合）

// 修正（Node.jsでも使える。どれも変更ログに残る）
result.fix(row, '登録日', '2024-04-02') // 任意の値に直す
result.accept(row, '電話番号')          // 未適用の提案を適用
result.dismiss(row, '電話番号')         // 今の値のままにする
result.acceptAll()                      // 提案をすべて適用
result.setCanonical(0, '(株)ABC')       // 表記ゆれの統一先を選び直す
```

段階ごとに `read` → `detect` → `normalize` → `toReport` を個別に呼ぶこともできます。

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
