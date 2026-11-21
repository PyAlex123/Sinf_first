"""Reference grade sheet (stage 4, W13): grades a teacher kept in Excel before the platform.

Names as teachers type them: in capitals, with an initial, "ё" as "е", a typo, a child who is not in
the class; the header has dates and one column that is not a date ("Контрольная"); cells hold
grades, "н", "нб" and an empty one. Names follow the demo class 1А (apps/server/src/db/seed.ts).

Run from the repository root (needs openpyxl):

    python3 tools/fixtures/make_grades_fixture.py

The file is committed; this script only explains how it was made and remakes it.
"""

from datetime import datetime
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "server" / "test" / "fixtures" / "grades"
FIXED = datetime(2026, 11, 21)

HEADER = ["№", "Ф.И.О.", "05.11", "12.11", "Контрольная"]
ROWS = [
    (1, "Алиев Тимур", "5", "4", "5"),
    (2, "КАРИМОВА МАДИНА", "4", "н", "4"),
    (3, "Иванов Артем", "3", "", "нб"),
    (4, "Кузнецова В.", "5", "5", "5"),
    (5, "Мирзаев Азз", "4", "4", "3"),
    (6, "Петров Сергей", "5", "5", "5"),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "Оценки 1А"
    ws.append(["Информатика, 1А, II четверть"])
    ws.append(HEADER)
    for row in ROWS:
        ws.append(list(row))
    wb.properties.created = FIXED
    wb.properties.modified = FIXED
    wb.save(OUT / "grades.xlsx")


if __name__ == "__main__":
    main()
