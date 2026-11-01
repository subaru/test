# examples/sample.xlsx を作る（実務でよくある形：タイトル行の結合、縦の結合、和暦書式の日付）
import datetime, sys
from openpyxl import Workbook

wb = Workbook()
ws = wb.active
ws.title = "顧客一覧"
ws["A1"] = "2024年度 顧客一覧"
ws.merge_cells("A1:G1")
ws.append([])
ws.append(["地域", "顧客名", "フリガナ", "電話番号", "登録日", "購入金額", "会員"])
rows = [
    ["関東", "株式会社ＡＢＣ", "かぶしきがいしゃえーびーしー", "０３（１２３４）５６７８", datetime.date(2024, 4, 1), 12000, "○"],
    [None, "山田　太郎", "ﾔﾏﾀﾞ ﾀﾛｳ", "090 1234 5678", datetime.date(2024, 4, 2), 3500, "×"],
    [None, "佐藤花子", "さとう はなこ", "03-9876-5432", "令和6年4月3日", "△500", "有"],
    ["関西", "鈴木一郎", "スズキ イチロウ", "+81 6-1234-5678", datetime.date(2024, 4, 4), "1万2千円", "無"],
    [None, "ＴＥＳＴ商事", "テストショウジ", "0120-123-456", "2024/4/5", 0, "済"],
]
for r in rows:
    ws.append(r)
ws.merge_cells("A4:A6")
ws.merge_cells("A7:A8")
for row in ws.iter_rows(min_row=4, min_col=5, max_col=5):
    for c in row:
        if isinstance(c.value, datetime.date):
            c.number_format = '[$-ja-JP]ggge"年"m"月"d"日"'

ws2 = wb.create_sheet("メモ")
ws2.append(["項目", "内容"])
ws2.append(["作成者", "営業部"])
wb.save(sys.argv[1])
