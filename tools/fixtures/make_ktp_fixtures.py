"""Reference KTP files (stage 4, W10): a calendar-thematic plan the way teachers keep it.

Excel: a title row over the table, the header in row 2, a real date column (Excel day numbers shown
as dates), hours as numbers. Word: a heading, then one table whose quarter rows ("I четверть") are a
single merged cell across the whole width.

Run from the repository root (needs openpyxl and python-docx):

    python3 tools/fixtures/make_ktp_fixtures.py

The files are committed; this script only explains how they were made and remakes them.
"""

from datetime import date, datetime
from pathlib import Path

from docx import Document
from docx.shared import Pt
from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "server" / "test" / "fixtures" / "ktp"
FIXED = datetime(2026, 11, 21)

TOPICS = [
    ("Техника безопасности. Что такое компьютер", 1, "1", date(2026, 9, 3), ""),
    ("Устройства ввода: клавиатура и мышь", 1, "1", date(2026, 9, 5), ""),
    ("Устройства вывода: монитор, принтер", 1, "2", date(2026, 9, 10), ""),
    ("Рабочий стол и окна", 1, "2", date(2026, 9, 12), "практика"),
    ("Текстовый редактор Word", 2, "3", date(2026, 9, 17), "2 урока"),
    ("Оформление текста: шрифт и абзац", 1, "4", date(2026, 9, 24), ""),
    ("Таблицы в Word", 1, "5", date(2026, 10, 1), ""),
    ("Контрольная работа", 1, "5", date(2026, 10, 3), "контроль"),
]


def xlsx():
    wb = Workbook()
    ws = wb.active
    ws.title = "КТП 5 класс"
    ws["A1"] = "Календарно-тематический план. Информатика, 5 класс, 2026–2027"
    ws.merge_cells("A1:F1")
    ws.append(["№", "Тема урока", "Кол-во часов", "Неделя", "Дата", "Примечание"])
    for i, (topic, hours, week, day, note) in enumerate(TOPICS, start=1):
        ws.append([i, topic, hours, week, day, note or None])
        ws.cell(row=ws.max_row, column=5).number_format = "DD.MM.YYYY"
    wb.properties.created = FIXED
    wb.properties.modified = FIXED
    wb.save(OUT / "ktp.xlsx")


def docx():
    doc = Document()
    doc.add_heading("КТП по информатике, 5 класс", level=1)
    table = doc.add_table(rows=1, cols=5)
    for cell, text in zip(table.rows[0].cells, ["№ п/п", "Тема", "Часы", "Дата", "Примечание"]):
        cell.text = text
    quarter = table.add_row().cells
    merged = quarter[0].merge(quarter[4])
    merged.text = "I четверть"
    for i, (topic, hours, _week, day, note) in enumerate(TOPICS, start=1):
        cells = table.add_row().cells
        for cell, text in zip(cells, [str(i), topic, str(hours), day.strftime("%d.%m"), note]):
            cell.text = text
    doc.core_properties.created = FIXED
    doc.core_properties.modified = FIXED
    doc.save(OUT / "ktp.docx")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    xlsx()
    docx()
    print("ok")
