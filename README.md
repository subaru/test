# nihon-tidy

日本語データの**列の種類を推論**し、**自動で正規化**して、**何を変えたかをHTMLレポートで出す** JavaScriptライブラリです。

- ブラウザだけで動きます（データを外部に送りません）。Node.jsでも動きます。
- 実行時の依存パッケージはありません。
- 変更はすべて記録されます。確信度の低い変換は適用せず「提案」として残します。

> 開発中（v0.1）です。APIは変わる可能性があります。

## できること（v0.1）

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

入力は CSV / TSV（**Shift_JISを自動判定**）、JSON（ネストは `user.name` のように平らにします）、オブジェクトの配列です。

## 使い方

### ブラウザ（コンテンツHTML）

```html
<div id="app"></div>
<script type="module">
  import { tidy } from './src/index.js';

  const input = document.querySelector('input[type=file]');
  input.addEventListener('change', async () => {
    const result = await tidy(input.files[0]);
    result.render('#app');                 // 検索・並べ替えできる表で表示
    const reportHTML = result.toReport();  // 分析レポートHTML
  });
</script>
```

デモは `examples/content.html` にあります。ES Modulesを使うため、ローカルサーバー経由で開いてください。

```sh
python3 -m http.server 8000
# http://localhost:8000/examples/content.html
```

### Node.js / CLI

```sh
node bin/cli.js examples/sample-sjis.csv --report report.html --out output.json
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
```

段階ごとに `read` → `detect` → `normalize` → `toReport` を個別に呼ぶこともできます。

## 構成

```
src/
  read/      入力の読み込み（文字コード判定・CSV・JSON）
  rules/     日本語の正規化規則（日付・電話・郵便番号・数値…）
  detect.js  列の種類の推論
  normalize.js 正規化と変更ログ
  report/    分析レポートHTMLの生成
  view/      コンテンツHTML用の表示
bin/cli.js   コマンドライン
```

## ロードマップ

- [x] v0.1 CSV/JSON、Shift_JIS、日付・電話・郵便番号・数値ほか、変更ログ、分析レポートHTML、表の表示
- [ ] v0.2 Excel（SheetJS）、カード表示、Web Components（`<tidy-table>`）
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
