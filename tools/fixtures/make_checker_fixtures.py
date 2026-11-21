"""Reference files for packages/checkers (PLAN.md 3.6, stage 3 H13, ADR-016).

Every format gets a "good" file that passes every criterion of its test task and a "bad" one that
fails them, plus files with what real Office programs do and python libraries do not: Russian Word
style ids, words split into runs, theme fonts, formulas filled down ("shared"), cached values,
slides in another order, old binary files, Notepad's encodings.

Run from the repository root (needs python-docx, openpyxl, python-pptx):

    python3 tools/fixtures/make_checker_fixtures.py

The files are committed; this script only explains how they were made and remakes them.
"""

import io
import re
import struct
import zipfile
import zlib
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Border, Font, PatternFill, Side
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches

OUT = Path(__file__).resolve().parents[2] / "packages" / "checkers" / "fixtures"


def png(width=4, height=4, rgb=(220, 60, 40)):
    """A tiny PNG without any image library."""
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def rewrite(path, edits):
    """Rewrites XML parts of an Office file in place: {part: function(xml) -> xml}."""
    src = path.read_bytes()
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(src)) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in edits:
                data = edits[item.filename](data.decode("utf-8")).encode("utf-8")
            zout.writestr(item, data)
    path.write_bytes(out.getvalue())


# ---------- docx


def good_docx(path):
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(14)
    doc.add_heading("Моя школа", level=1)
    for text in [
        "Наша школа стоит в центре города. В ней учатся шестьсот учеников.",
        "В компьютерном классе пятнадцать компьютеров и проектор.",
        "Больше всего я люблю уроки информатики.",
    ]:
        p = doc.add_paragraph(text)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.line_spacing = 1.5
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.line_spacing = 1.5
    p.add_run("Важно: ").bold = True
    p.add_run("сохранять работу каждые пять минут.")
    doc.add_heading("Что есть в классе", level=2)
    for item in ["Компьютеры", "Проектор", "Принтер"]:
        doc.add_paragraph(item, style="List Number")
    table = doc.add_table(rows=3, cols=2)
    for r, (a, b) in enumerate([("Предмет", "Часов"), ("Информатика", "2"), ("Математика", "5")]):
        table.cell(r, 0).text = a
        table.cell(r, 1).text = b
    doc.add_picture(io.BytesIO(png()))
    doc.save(path)


def bad_docx(path):
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    p = doc.add_paragraph()
    run = p.add_run("Моя школа")
    run.font.size = Pt(20)
    doc.add_paragraph("Наша школа стоит в центре города.")
    doc.save(path)


def russian_word_docx(path):
    """What a Russian Word writes: the style ids are its own, the run is cut by the spell-checker,
    the font comes from the theme and the size from the document defaults."""
    good_docx(path)

    def styles(xml):
        xml = xml.replace('w:styleId="Heading1"', 'w:styleId="1"').replace('w:styleId="Heading2"', 'w:styleId="2"')
        xml = xml.replace('<w:basedOn w:val="Heading1"/>', '<w:basedOn w:val="1"/>')
        # Body font through the theme, size from the defaults.
        xml = re.sub(
            r'(<w:style w:type="paragraph" w:default="1" w:styleId="Normal">.*?<w:rPr>).*?(</w:rPr>)',
            r'\1<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>\2',
            xml,
            flags=re.S,
        )
        xml = re.sub(r"<w:rPrDefault>.*?</w:rPrDefault>", '<w:rPrDefault><w:rPr><w:sz w:val="28"/></w:rPr></w:rPrDefault>', xml, flags=re.S)
        return xml

    def document(xml):
        xml = xml.replace('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="1"/>').replace(
            '<w:pStyle w:val="Heading2"/>', '<w:pStyle w:val="2"/>'
        )
        # "Наша школа" cut in three runs, as the spell-checker leaves it.
        return xml.replace(
            "<w:r><w:t>Наша школа стоит в центре города. В ней учатся шестьсот учеников.</w:t></w:r>",
            '<w:r><w:t xml:space="preserve">На</w:t></w:r><w:proofErr w:type="spellStart"/>'
            "<w:r><w:t>ша</w:t></w:r><w:proofErr w:type=\"spellEnd\"/>"
            '<w:r><w:t xml:space="preserve"> школа стоит в центре города. В ней учатся шестьсот учеников.</w:t></w:r>'
            '<w:del w:id="1" w:author="Учитель"><w:r><w:delText>лишнее</w:delText></w:r></w:del>',
        )

    def theme(xml):
        return re.sub(r'(<a:minorFont>\s*<a:latin typeface=")[^"]*"', r'\1Times New Roman"', xml)

    rewrite(path, {"word/styles.xml": styles, "word/document.xml": document, "word/theme/theme1.xml": theme})


# ---------- xlsx


def good_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Расходы"
    rows = [("Покупка", "Цена", "Две штуки", "Доля", "Дата"), ("Тетрадь", 10, None, 0.2, None), ("Ручка", 15, None, 0.3, None), ("Пенал", 25, None, 0.5, None)]
    for row in rows:
        ws.append(row)
    for r in (2, 3, 4):
        ws[f"C{r}"] = f"=B{r}*2"
        ws[f"D{r}"].number_format = "0%"
    ws["B5"] = "=SUM(B2:B4)"
    ws["B2"].number_format = "0.00"
    import datetime

    ws["E2"] = datetime.date(2026, 11, 21)
    ws["E2"].number_format = "dd.mm.yyyy"
    ws["A1"].font = Font(bold=True)
    ws["B1"].font = Font(bold=True)
    ws["A1"].fill = PatternFill("solid", fgColor="FFFF00")
    thin = Side(style="thin")
    ws["A1"].border = Border(left=thin, right=thin, top=thin, bottom=thin)
    chart = BarChart()
    chart.add_data(Reference(ws, min_col=2, min_row=1, max_row=4), titles_from_data=True)
    ws.add_chart(chart, "G2")
    wb.create_sheet("Итог")["A1"] = "Готово"
    wb.save(path)

    # Excel keeps the value it calculated next to every formula, and stores a filled-down formula
    # once. openpyxl does neither: the file gets what Excel would write.
    def sheet(xml):
        xml = re.sub(r"<f>SUM\(B2:B4\)</f>(<v></v>|<v/>)?", "<f>SUM(B2:B4)</f><v>50</v>", xml)
        xml = re.sub(r'<c r="C2"><f>B2\*2</f>(<v></v>|<v/>)?</c>', '<c r="C2"><f t="shared" ref="C2:C4" si="0">B2*2</f><v>20</v></c>', xml)
        for r, v in ((3, 30), (4, 50)):
            xml = re.sub(rf'<c r="C{r}"><f>B{r}\*2</f>(<v></v>)?</c>', f'<c r="C{r}"><f t="shared" si="0"/><v>{v}</v></c>', xml)
        return xml

    rewrite(path, {"xl/worksheets/sheet1.xml": sheet})


def bad_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Расходы"
    for row in [("Покупка", "Цена"), ("Тетрадь", 10), ("Ручка", 15), ("Пенал", 25)]:
        ws.append(row)
    ws["B5"] = 60  # typed in, not counted
    wb.save(path)


def no_cache_xlsx(path):
    """Saved by a program that does not calculate (openpyxl): the formula has no value."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Расходы"
    for row in [("Покупка", "Цена"), ("Тетрадь", 10), ("Ручка", 15), ("Пенал", 25)]:
        ws.append(row)
    ws["B5"] = "=SUM(B2:B4)"
    wb.save(path)


# ---------- pptx


def good_pptx(path):
    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[0])
    s1.shapes.title.text = "Моя школа"
    s1.placeholders[1].text = "Презентация ученика 5 класса"
    s2 = prs.slides.add_slide(prs.slide_layouts[1])
    s2.shapes.title.text = "Наш класс"
    s2.placeholders[1].text = "Пятнадцать компьютеров и проектор"
    s2.notes_slide.notes_text_frame.text = "Рассказать про проектор"
    s3 = prs.slides.add_slide(prs.slide_layouts[5])
    s3.shapes.title.text = "Фотография"
    s3.shapes.add_picture(io.BytesIO(png()), Inches(1), Inches(2), Inches(2), Inches(2))
    s4 = prs.slides.add_slide(prs.slide_layouts[5])
    s4.shapes.title.text = "Расписание"
    table = s4.shapes.add_table(3, 2, Inches(1), Inches(2), Inches(6), Inches(2)).table
    for r, (a, b) in enumerate([("День", "Урок"), ("Понедельник", "Информатика"), ("Среда", "Математика")]):
        table.cell(r, 0).text = a
        table.cell(r, 1).text = b
    data = CategoryChartData()
    data.categories = ["5А", "5Б"]
    data.add_series("Ученики", (25, 28))
    s4.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(4.5), Inches(4), Inches(2), data)
    prs.save(path)

    # Transitions on slides 2 and 3, the way PowerPoint writes them for its older versions too.
    transition = (
        '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
        '<mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">'
        '<p:transition spd="med" p14:dur="700"><p:fade/></p:transition></mc:Choice>'
        '<mc:Fallback><p:transition spd="med"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>'
    )

    def with_transition(xml):
        return xml.replace("</p:cSld>", "</p:cSld>" + transition, 1)

    rewrite(path, {"ppt/slides/slide2.xml": with_transition, "ppt/slides/slide3.xml": with_transition})


def bad_pptx(path):
    prs = Presentation()
    prs.slides.add_slide(prs.slide_layouts[1])  # title left empty
    prs.save(path)


def reordered_pptx(path):
    """The child moved the last slide to the front: the files keep their names, the list changes."""
    good_pptx(path)

    def presentation(xml):
        ids = re.findall(r"<p:sldId [^>]*/>", xml)
        return xml.replace("".join(ids), "".join([ids[-1], *ids[:-1]]))

    rewrite(path, {"ppt/presentation.xml": presentation})


# ---------- html, css, txt

GOOD_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Моя школа</title>
  <link rel="stylesheet" href="style.css">
  <style>
    h1 { color: navy; text-align: center; }
    p, li { font-size: 14px; }
  </style>
</head>
<body>
  <h1>Моя школа</h1>
  <p>Наша школа стоит в центре города.</p>
  <img src="school.png" alt="Здание школы">
  <ul>
    <li>Компьютеры</li>
    <li>Проектор</li>
    <li>Принтер</li>
  </ul>
  <table border="1">
    <tr><th>Предмет</th><th>Часов</th></tr>
    <tr><td>Информатика</td><td>2</td></tr>
    <tr><td>Математика</td><td>5</td></tr>
  </table>
  <p>Сайт школы: <a href="https://example.uz">example.uz</a></p>
  <p style="color: green">Спасибо!</p>
</body>
</html>
"""

BAD_HTML = """<html>
<head><title></title></head>
<body>
  <h2>Моя школа
  <p>Наша школа стоит в центре города.
  <img src="school.png">
  <ul><li>Компьютеры</ul>
</body>
</html>
"""

STYLE_CSS = """/* Оформление сайта школы */
body { font-family: Arial, sans-serif; background: #f4f4f4; }
h1 { color: navy; }
@media (max-width: 600px) {
  table { width: 100%; }
}
"""

GOOD_TXT = "Моя школа\nНаша школа стоит в центре города.\nВ ней учатся шестьсот учеников.\nКонец.\n"


def lesson_pptx(path):
    """A teacher's presentation for the lesson builder's import (stage 6, B4)."""
    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[0])
    s1.shapes.title.text = "Компьютер и его части"
    s1.placeholders[1].text = "Урок 1"
    s2 = prs.slides.add_slide(prs.slide_layouts[1])
    s2.shapes.title.text = "Устройства ввода"
    body = s2.placeholders[1].text_frame
    body.text = "Клавиатура"
    for point in ("Мышь", "Микрофон", "Сканер"):
        body.add_paragraph().text = point
    s3 = prs.slides.add_slide(prs.slide_layouts[5])
    s3.shapes.title.text = "Монитор"
    s3.shapes.add_picture(io.BytesIO(png(64, 40, (40, 90, 200))), Inches(1), Inches(2), Inches(4), Inches(2.5))
    s3.shapes.add_textbox(Inches(5.5), Inches(2), Inches(3), Inches(1)).text_frame.text = "Показывает изображение"
    s4 = prs.slides.add_slide(prs.slide_layouts[6])
    s4.shapes.add_picture(io.BytesIO(png(48, 48, (30, 160, 80))), Inches(2), Inches(1), Inches(4), Inches(4))
    prs.save(path)


def main():
    for sub in ("docx", "xlsx", "pptx", "html", "txt"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    good_docx(OUT / "docx" / "good.docx")
    bad_docx(OUT / "docx" / "bad.docx")
    russian_word_docx(OUT / "docx" / "russian-word.docx")
    # An old .doc, or a new one saved with a password: both are a "compound file".
    (OUT / "docx" / "protected.docx").write_bytes(bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + b"\x00" * 504)
    (OUT / "docx" / "renamed-text.docx").write_bytes("это просто текст, переименованный в .docx".encode("utf-8"))
    good_xlsx(OUT / "xlsx" / "good.xlsx")
    bad_xlsx(OUT / "xlsx" / "bad.xlsx")
    no_cache_xlsx(OUT / "xlsx" / "no-cache.xlsx")
    good_pptx(OUT / "pptx" / "good.pptx")
    bad_pptx(OUT / "pptx" / "bad.pptx")
    reordered_pptx(OUT / "pptx" / "reordered.pptx")
    lesson_pptx(OUT / "pptx" / "lesson.pptx")
    (OUT / "html" / "good.html").write_text(GOOD_HTML, encoding="utf-8")
    (OUT / "html" / "bad.html").write_text(BAD_HTML, encoding="utf-8")
    (OUT / "html" / "style.css").write_text(STYLE_CSS, encoding="utf-8")
    (OUT / "txt" / "good.txt").write_text(GOOD_TXT, encoding="utf-8")
    (OUT / "txt" / "good-1251.txt").write_bytes(GOOD_TXT.replace("\n", "\r\n").encode("cp1251"))
    (OUT / "txt" / "good-utf16.txt").write_bytes(b"\xff\xfe" + GOOD_TXT.encode("utf-16-le"))
    (OUT / "txt" / "bad.txt").write_text("моя школа\n", encoding="utf-8")
    print("fixtures written to", OUT)


if __name__ == "__main__":
    main()
