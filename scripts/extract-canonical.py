#!/usr/bin/env python3
"""Extract workbook sheets to references/canonical/ in the pack's own JSON format.

Why this exists (HALLAZGO H-01 / contradiction CC-02 in the build plan):
`03_TARGET_ARCHITECTURE.md` and `14_DATA_INTEGRATION_ADAPTERS.md` both cite "S2 36"
as authority, but sheet 36 — which holds FC-01…FC-14, the functional contracts
between domains, i.e. Interfaces A and B — was never extracted into
references/canonical/. The same applies to sheets 39 (gates), 45 (relational-model
findings, incl. the still-open MR-10), 46 (core ERD), 47 (Habilita naming) and
59–62 (per-domain rule detail that can refine sheet 57).

This script closes that gap. It does not touch the workbook: it reads data_only
values and reproduces exactly the shape the existing extracts use, so the new files
are indistinguishable in format from the ones shipped with the pack:

    {"source": "S2", "sheet": "<name>", "extraction": "<caveat>",
     "rows": [{"source_row": <1-based Excel row>, "cells": [...]}]}

Rules matched against the shipped extracts (verified against sheet 44):
  - rows where every cell is empty are omitted, so source_row has gaps;
  - `cells` is the full row width for that sheet, padded with nulls;
  - values are raw data_only values; strings keep their embedded newlines;
  - source_row is the real Excel row number, never a sequential index.

Requires openpyxl (the pack's own extracts were produced the same way). The repo's
JS toolchain deliberately does not take an xlsx dependency for a one-off
maintenance task.

    python scripts/extract-canonical.py            # the H-01 set
    python scripts/extract-canonical.py 17 25 30   # any sheet by leading number
    python scripts/extract-canonical.py --check     # re-extract and diff, write nothing
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

try:
    import openpyxl
except ModuleNotFoundError:  # pragma: no cover
    sys.exit("openpyxl is required: python -m pip install openpyxl")

REPO_ROOT = Path(__file__).resolve().parent.parent
PACK = REPO_ROOT / "full-implementation-pack"
REFERENCES = PACK / "references"
CANONICAL = REFERENCES / "canonical"
MANIFEST = PACK / "reference_manifest.json"
WORKBOOK = (
    REFERENCES / "Diccionario_Canonico_v3.0_BASELINE_FUNCIONAL_1.0_FROZEN_VDS.xlsx"
)

EXTRACTION_CAVEAT = (
    "data_only values; original workbook authoritative for formulas, "
    "formatting and validations"
)

# The H-01 set: sheets the pack cites or depends on but did not extract.
H01_SHEETS = ["36", "39", "45", "46", "47", "59", "60", "61", "62"]


def normalise(value: object) -> object:
    """Make a cell value JSON-safe without changing what it means."""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return str(value)


def extract(worksheet) -> dict:
    rows_out = []
    for index, row in enumerate(worksheet.iter_rows(values_only=True), start=1):
        cells = [normalise(cell) for cell in row]
        if all(cell is None or cell == "" for cell in cells):
            continue  # all-empty rows are omitted; source_row keeps the real number
        rows_out.append({"source_row": index, "cells": cells})

    # iter_rows pads to the widest row in the sheet; assert that so a format change
    # in openpyxl cannot silently produce ragged output.
    widths = {len(r["cells"]) for r in rows_out}
    if len(widths) > 1:
        raise RuntimeError(
            f"{worksheet.title}: ragged rows {sorted(widths)} — "
            "shipped extracts are uniform width; refusing to write"
        )

    return {
        "source": "S2",
        "sheet": worksheet.title,
        "extraction": EXTRACTION_CAVEAT,
        "rows": rows_out,
    }


def resolve_sheets(workbook, selectors: list[str]) -> list[str]:
    """Map leading sheet numbers (e.g. "36") to full sheet names."""
    resolved = []
    for selector in selectors:
        matches = [
            name
            for name in workbook.sheetnames
            if name == selector or name.split("_", 1)[0] == selector
        ]
        if not matches:
            sys.exit(f"No sheet matches {selector!r}. Available: {workbook.sheetnames}")
        if len(matches) > 1:
            sys.exit(f"{selector!r} is ambiguous: {matches}")
        resolved.append(matches[0])
    return resolved


def update_manifest(sheet_names: list[str]) -> list[str]:
    """Record the new sheets in reference_manifest.json: extracted_sheets."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    existing = manifest.get("extracted_sheets", [])
    added = [name for name in sheet_names if name not in existing]
    if not added:
        return []
    # Keep the list ordered by leading sheet number, as the pack had it.
    merged = sorted(existing + added, key=lambda n: int(n.split("_", 1)[0]))
    manifest["extracted_sheets"] = merged
    # newline="\n": reference_manifest.json sits under the pack, and the canonical
    # extracts it indexes are marked -text in .gitattributes, so bytes written here are
    # the bytes committed. Keep the whole pack on LF rather than letting the platform decide.
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return added


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheets", nargs="*", default=None, help="sheet numbers or names")
    parser.add_argument(
        "--check",
        action="store_true",
        help="re-extract and report differences without writing",
    )
    args = parser.parse_args()

    selectors = args.sheets or H01_SHEETS
    workbook = openpyxl.load_workbook(WORKBOOK, data_only=True, read_only=True)
    sheet_names = resolve_sheets(workbook, selectors)

    changed, unchanged = [], []
    for name in sheet_names:
        payload = extract(workbook[name])
        text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        target = CANONICAL / f"{name}.json"
        # newline="": compare raw bytes-as-text so a CRLF file never looks equal to LF.
        current = (
            target.read_text(encoding="utf-8", newline="") if target.exists() else None
        )

        if current == text:
            unchanged.append(name)
            print(f"  =  {target.relative_to(REPO_ROOT)}  ({len(payload['rows'])} rows)")
            continue

        changed.append(name)
        verb = "would write" if args.check else "wrote"
        if not args.check:
            target.write_text(text, encoding="utf-8", newline="\n")
        print(
            f"  {'?' if args.check else '+'}  {target.relative_to(REPO_ROOT)}  "
            f"({len(payload['rows'])} rows) — {verb}"
        )

    if args.check:
        if changed:
            print(f"\n{len(changed)} sheet(s) differ from the committed extract: {changed}")
            return 1
        print(f"\n{len(unchanged)} sheet(s) match the committed extracts.")
        return 0

    added = update_manifest(sheet_names)
    if added:
        print(f"\nreference_manifest.json: extracted_sheets += {added}")
    print(f"\n{len(changed)} written, {len(unchanged)} already current.")
    print("The workbook was not modified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
