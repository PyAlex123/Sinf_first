"""The sample practice "Оформи документ" (stage 3, H16): its template and two reference files.

The lesson is a sample made by the developer to try the practice in Word end to end, not the
author's content. The template is a plain document as a child gets it: a title and a few lines in
the default style. The reference files are the same document done right and half done; the
server tests and tools/e2e/h16.cjs use them.

Run from the repository root (needs python-docx):

    python3 tools/fixtures/make_practice_sample.py

The files are committed; this script only explains how they were made and remakes them.
"""

from datetime import datetime
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

FIXED = datetime(2026, 11, 21)
ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "content" / "proba-praktiki" / "templates" / "oformi-dokument.docx"
REFERENCE = ROOT / "apps" / "server" / "test" / "fixtures" / "practice"

TITLE = "Мой компьютер"
INTRO = (
    "Компьютер помогает учиться, рисовать и писать тексты. "
    "Внутри у него много важных частей."
)
PARTS = ["Процессор", "Память", "Жёсткий диск"]
TABLE = [("Часть", "Для чего"), ("Процессор", "считает"), ("Память", "помнит")]


def plain(doc):
    """The template: everything in the default style, nothing formatted."""
    doc.add_paragraph(TITLE)
    doc.add_paragraph(INTRO)
    for part in PARTS:
        doc.add_paragraph(part)
    doc.add_paragraph("Добавь сюда таблицу.")


def done(doc, *, list_and_table=True):
    doc.styles["Normal"].font.size = Pt(14)
    heading = doc.add_heading(TITLE, level=1)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph(INTRO)
    if not list_and_table:
        for part in PARTS:
            doc.add_paragraph(part)
        return
    for part in PARTS:
        doc.add_paragraph(part, style="List Bullet")
    table = doc.add_table(rows=len(TABLE), cols=2)
    for r, row in enumerate(TABLE):
        for c, value in enumerate(row):
            table.cell(r, c).text = value


def save(doc, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # One date on every run: python-docx stamps the time otherwise.
    doc.core_properties.created = FIXED
    doc.core_properties.modified = FIXED
    doc.core_properties.author = "Sinf"
    doc.core_properties.last_modified_by = "Sinf"
    doc.save(path)
    print(path.relative_to(ROOT))


def main():
    doc = Document()
    plain(doc)
    save(doc, TEMPLATE)

    doc = Document()
    done(doc)
    save(doc, REFERENCE / "oformi-dokument-done.docx")

    doc = Document()
    done(doc, list_and_table=False)
    save(doc, REFERENCE / "oformi-dokument-half.docx")


if __name__ == "__main__":
    main()
