"""Find, download and vet illustrations for the words that benefit from one.

Usage:
  python tools/images.py fetch   # main image of each word's Wikipedia article -> docs/img/, content/images.json
  python tools/images.py check   # Claude looks at every image and approves or rejects it

Only freely licensed images are used (Wikipedia's page images default to free
licenses); artist and license are stored for the credit line in the app.
"""
import base64
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATED = ROOT / "content" / "generated.json"
IMAGES = ROOT / "content" / "images.json"
IMG_DIR = ROOT / "docs" / "img"
USER_AGENT = "CorpusLatinQuiz/1.0 (study app; https://github.com/lukasbinau)"
THUMB_WIDTH = 520
MODEL = "claude-opus-5-5"


def get_json(url, params):
    full = url + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.write_bytes(r.read())


def strip_html(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def load(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def cmd_fetch():
    generated = load(GENERATED, {})
    images = load(IMAGES, {})
    wanted = {i: g["wikipedia_title"] for i, g in generated.items()
              if g["image_relevant"] and g["wikipedia_title"] and i not in images}
    print(f"{len(wanted)} words need an image lookup")
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    items = list(wanted.items())
    for start in range(0, len(items), 40):
        chunk = items[start:start + 40]
        data = get_json("https://en.wikipedia.org/w/api.php", {
            "action": "query", "prop": "pageimages", "redirects": 1, "piprop": "name",
            "titles": "|".join(t for _, t in chunk),
        })
        q = data.get("query", {})
        # follow normalisation and redirects back to the title we asked for
        alias = {}
        for kind in ("normalized", "redirects"):
            for n in q.get(kind, []):
                alias[n["to"]] = alias.get(n["from"], n["from"])
        page_image = {alias.get(p["title"], p["title"]): p.get("pageimage") for p in q.get("pages", [])}
        for word_id, title in chunk:
            name = page_image.get(title)
            if not name:
                images[word_id] = {"title": title, "approved": False, "reason": "no free page image"}
                continue
            info = get_json("https://commons.wikimedia.org/w/api.php", {
                "action": "query", "prop": "imageinfo", "titles": f"File:{name}",
                "iiprop": "url|extmetadata|mime", "iiurlwidth": THUMB_WIDTH,
            })
            pages = info.get("query", {}).get("pages", [])
            ii = pages[0].get("imageinfo") if pages else None
            if not ii:
                images[word_id] = {"title": title, "file": name, "approved": False, "reason": "not on Commons"}
                continue
            ii = ii[0]
            meta = ii.get("extmetadata", {})
            thumb = ii.get("thumburl") or ii["url"]
            ext = Path(urllib.parse.urlparse(thumb).path).suffix.lower()
            ext = ext if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp") else ".png"
            dest = IMG_DIR / f"{word_id}{ext}"
            try:
                download(thumb, dest)
            except Exception as e:  # noqa: BLE001 - log and move on
                images[word_id] = {"title": title, "file": name, "approved": False, "reason": f"download failed: {e}"}
                continue
            artist = strip_html(meta.get("Artist", {}).get("value")) or "Ukendt"
            images[word_id] = {
                "title": title,
                "file": name,
                "src": f"img/{dest.name}",
                "credit": artist[:120],
                "license": strip_html(meta.get("LicenseShortName", {}).get("value")),
                "page": ii.get("descriptionurl", ""),
                "approved": None,
            }
            time.sleep(0.2)
        save(IMAGES, images)
        print(f"  {min(start + 40, len(items))}/{len(items)}")
    ok = sum(1 for v in images.values() if v.get("src"))
    print(f"Downloaded {ok} images; run 'check' next.")


CHECK_PROMPT = """This picture will be shown in a flashcard app for a Danish university student learning Latin anatomical terms.
Term: {latin} — meaning: {english}. The picture is the main image of the English Wikipedia article "{title}".

Approve it only if it clearly helps her see what the term refers to: an anatomical drawing, diagram, model, or clear medical image where the structure is easy to find.
Reject it if it is unrelated or only loosely related, too cluttered or small to be useful, mostly text, a photo of nudity or genitals, graphic gore, or a photo of a person where the structure is not the point.
Reply with JSON only: {{"approved": true or false, "reason": "a few words"}}"""


def load_api_key():
    sys.path.insert(0, str(Path(__file__).parent))
    from generate_content import load_api_key as _load
    return _load()


def cmd_check():
    import anthropic
    client = anthropic.Anthropic(api_key=load_api_key())
    generated = load(GENERATED, {})
    images = load(IMAGES, {})
    todo = [i for i, v in images.items() if v.get("src") and v.get("approved") is None]
    print(f"Checking {len(todo)} images")
    media = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}

    def check(word_id):
        v = images[word_id]
        g = generated[word_id]
        path = ROOT / "docs" / v["src"]
        data = base64.standard_b64encode(path.read_bytes()).decode()
        msg = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": {
                "type": "object",
                "properties": {"approved": {"type": "boolean"}, "reason": {"type": "string"}},
                "required": ["approved", "reason"], "additionalProperties": False}}},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media[path.suffix.lower()], "data": data}},
                {"type": "text", "text": CHECK_PROMPT.format(latin=g["headword"], english=g["english"], title=v["title"])},
            ]}],
        )
        if msg.stop_reason != "end_turn":
            return word_id, {"approved": False, "reason": f"stop_reason={msg.stop_reason}"}
        return word_id, json.loads(next(b.text for b in msg.content if b.type == "text"))

    with ThreadPoolExecutor(max_workers=6) as pool:
        for n, (word_id, verdict) in enumerate(pool.map(check, todo), 1):
            images[word_id].update(verdict)
            if n % 20 == 0:
                save(IMAGES, images)
                print(f"  {n}/{len(todo)}")
    save(IMAGES, images)
    approved = [i for i, v in images.items() if v.get("approved")]
    print(f"Approved {len(approved)} of {sum(1 for v in images.values() if v.get('src'))} images")
    for i, v in images.items():
        if v.get("src") and not v.get("approved"):
            print(f"  rejected {i} {v['title']}: {v.get('reason')}")
    # remove files that will not be used, so they are not published
    for i, v in images.items():
        if v.get("src") and v.get("approved") is False:
            (ROOT / "docs" / v["src"]).unlink(missing_ok=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    {"fetch": cmd_fetch, "check": cmd_check}[sys.argv[1]]()
