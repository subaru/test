# examples/sample-2row.xlsx を作る（2段の見出し：結合した「売上」「連絡先」の下に「上期・下期」「電話・メール」）
import sys
from openpyxl import Workbook

wb = Workbook()
ws = wb.active
ws.title = "店舗別売上"
ws["A1"] = "2024年度 店舗別売上"
ws.merge_cells("A1:F1")
ws.append([])
ws.append(["店舗", "売上", None, "連絡先", None, "開店日"])
ws.append([None, "上期", "下期", "電話", "メール", None])
ws.merge_cells("A3:A4")
ws.merge_cells("B3:C3")
ws.merge_cells("D3:E3")
ws.merge_cells("F3:F4")
for r in [
    ["本店", "1,200,000", "△50,000", "03-1234-5678", "honten@example.jp", "平成元年4月1日"],
    ["大阪店", 980000, 1010000, "06-1234-5678", "osaka@example.jp", "2010/10/10"],
    ["札幌店", 450000, 520000, "011-123-4567", "sapporo@example.jp", "R2.5.1"],
]:
    ws.append(r)
wb.save(sys.argv[1])
