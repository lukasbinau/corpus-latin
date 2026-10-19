"""Merge the source list, generated content and images into docs/data/words.json for the app.

Usage: python tools/build_data.py

Words without generated content fall back to the spreadsheet's English, so the app
also works before the API run.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "source" / "words_source.json"
GENERATED = ROOT / "content" / "generated.json"
IMAGES = ROOT / "content" / "images.json"
OUT = ROOT / "docs" / "data" / "words.json"


def load(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


CZECH_NOTES = {"(nesklonné)": "(ubøjeligt)", "(plurál)": "(flertal)"}


def display_full(latin_full):
    for cz, da in CZECH_NOTES.items():
        latin_full = latin_full.replace(cz, da)
    return latin_full


def fallback_headword(latin_full):
    # "(os) hyoideum" -> "os hyoideum"; "abdomen, inis, n." -> "abdomen"
    head = re.split(r",|\s\(", latin_full)[0]
    return re.sub(r"[()]", "", head).strip() or latin_full


def symmetric_similar(generated):
    """Words that must never be answer options together: listed as similar either way,
    or sharing the same English meaning (e.g. lingua and glossa, both "tongue")."""
    similar = {i: set(g["similar_ids"]) for i, g in generated.items()}
    for i, g in generated.items():
        for j in g["similar_ids"]:
            similar.setdefault(j, set()).add(i)
    by_english = {}
    for i, g in generated.items():
        by_english.setdefault(g["english"].strip().lower(), []).append(i)
    for ids in by_english.values():
        for i in ids:
            similar.setdefault(i, set()).update(x for x in ids if x != i)
    return similar


def main():
    source = load(SOURCE, [])
    generated = load(GENERATED, {})
    images = load(IMAGES, {})
    similar = symmetric_similar(generated)
    out = []
    for w in source:
        g = generated.get(w["id"])
        img = images.get(w["id"])
        sections = w["sections"]
        entry = {
            "id": w["id"],
            "latin": g["headword"] if g else fallback_headword(w["latin_full"]),
            "latinFull": display_full(w["latin_full"]),
            "english": g["english"] if g else (w["english_original"] or "?"),
            "englishTerm": g.get("english_term", "") if g else "",
            "englishOriginal": w["english_original"] if g and g["english_changed"] else None,
            "danish": g["danish"] if g else "",
            "explanation": g["explanation_da"] if g else "",
            "mnemonic": g["mnemonic_da"] if g else "",
            "wordType": g["word_type"] if g else "other",
            "wordTypeDa": g["word_type_da"] if g else "",
            "category": g["category"] if g else "general",
            "letter": next((s for s in sections if len(s) <= 2), sections[0]),
            "directions": "Retninger og planer" in sections,
            "distractors": g["distractor_ids"] if g else [],
            "similar": sorted(similar.get(w["id"], ())),
            "image": img if img and img.get("approved") else None,
        }
        if entry["image"]:
            entry["image"] = {k: img[k] for k in ("src", "credit", "license", "page")}
        out.append(entry)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_gen = sum(1 for w in source if w["id"] in generated)
    n_img = sum(1 for e in out if e["image"])
    print(f"Wrote {len(out)} words to {OUT.relative_to(ROOT)} ({n_gen} with generated content, {n_img} with images)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
