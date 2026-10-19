"""Extract the Latin word list from the Medical Terminology Excel file into source/words_source.json.

Usage: python -I tools/extract_words.py "path/to/Medical Terminology.xlsx" source/words_source.json
Stdlib only (no openpyxl needed).
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
T = "{%s}t" % NS["m"]


def read_sheet(path, sheet_name):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        shared = ["".join(t.text or "" for t in si.iter(T)) for si in root.findall("m:si", NS)]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {r.get("Id"): r.get("Target") for r in rels}
    for s in wb.find("m:sheets", NS):
        if s.get("name") != sheet_name:
            continue
        target = relmap[s.get("{%s}id" % NS["r"])].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
            cells = {}
            for c in row.findall("m:c", NS):
                col = re.match(r"[A-Z]+", c.get("r")).group()
                v = c.find("m:v", NS)
                if c.get("t") == "s" and v is not None:
                    cells[col] = shared[int(v.text)]
                elif c.get("t") == "inlineStr":
                    cells[col] = "".join(x.text or "" for x in c.iter(T))
                elif v is not None:
                    cells[col] = v.text
            rows.append(cells)
        return rows
    raise SystemExit(f"Sheet {sheet_name!r} not found")


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\u00a0", " ")).strip()


def main(xlsx, out):
    rows = read_sheet(xlsx, "Words")
    words, by_key = [], {}
    section = "Retninger og planer"  # the block above "A" is anatomical terms of location
    for r in rows[2:]:
        if clean(r.get("A")):
            section = clean(r.get("A"))
            continue
        latin = clean(r.get("B"))
        if not latin:
            continue
        key = latin.lower()
        if key in by_key:  # direction terms appear both in the top block and in A-Z
            by_key[key]["sections"].append(section)
            continue
        w = {
            "latin_full": latin,
            "english_original": clean(r.get("D")),
            "german": clean(r.get("E")),
            "czech": clean(r.get("C")),
            "sections": [section],
        }
        by_key[key] = w
        words.append(w)
    for i, w in enumerate(words, 1):
        w["id"] = f"w{i:03d}"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=1)
    print(f"{len(words)} unique words written to {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
