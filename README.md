# nihon-tidy

日本語データの**列の種類を推論**し、**自動で正規化**して、**何を変えたかをHTMLレポートで出す** JavaScriptライブラリです。

- ブラウザだけで動きます（データを外部に送りません）。Node.jsでも動きます。
- 実行時の依存パッケージはありません。
- 変更はすべて記録されます。確信度の低い変換は適用せず「提案」として残します。

> 開発中（v0.2）です。APIは変わる可能性があります。

## できること（v0.2）

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

JavaScriptから `element.input = file` で処理させたり、`tidy-load` イベントで結果（`e.detail`）を受け取ったりできます。デモは `examples/element.html` です。

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
result.toReport() // 分析レポートHTML（1ファイルで完結）
result.toCSV()
result.toTableHTML() / result.toCardsHTML() // 文字列のHTML（サーバー側で使う場合）
```

段階ごとに `read` → `detect` → `normalize` → `toReport` を個別に呼ぶこともできます。

## 構成

```
src/
  read/      入力の読み込み（文字コード判定・CSV・JSON・Excel・ZIP展開）
  rules/     日本語の正規化規則（日付・電話・郵便番号・数値…）
  detect.js  列の種類の推論
  normalize.js 正規化と変更ログ
  report/    分析レポートHTMLの生成
  view/      コンテンツHTML用の表示（表・カード・<tidy-table>）
bin/cli.js   コマンドライン
scripts/     サンプルデータの生成
```

## ロードマップ

- [x] v0.1 CSV/JSON、Shift_JIS、日付・電話・郵便番号・数値ほか、変更ログ、分析レポートHTML、表の表示
- [x] v0.2 Excel（.xlsx、依存なし）、カード表示、Web Component（`<tidy-table>`）
- [ ] v0.3 表記ゆれのクラスタリング（「(株)ABC」「株式会社ABC」）、要確認をその場で直すUI
- [ ] v0.4 スクレイピング結果（HTMLの表・繰り返し構造）、構造のないテキストの推論
- [ ] v1.0 住所の正規化プラグイン、Web Worker対応、API安定化、npm公開

## 開発

```sh
npm test        # node:test
npm run example # サンプルからレポートを生成
```

## ライセンス

MIT
