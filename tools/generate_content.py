"""Generate study content for every word with the Claude API (one-off, offline).

The app never calls the API; this script writes content/generated.json, which
tools/build_data.py merges into docs/data/words.json.

Usage:
  python tools/generate_content.py test [--ids w001,w002,...]   # one synchronous request, prints result + cost
  python tools/generate_content.py submit                        # batch for all words not yet generated
  python tools/generate_content.py collect                       # wait for the batch and merge results
  python tools/generate_content.py status                        # show what is generated / missing

The API key is read from ANTHROPIC_API_KEY, then from the .env file in the project
root (git-ignored), then from the Windows user environment (HKCU\\Environment).
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "source" / "words_source.json"
CONTENT_DIR = ROOT / "content"
GENERATED = CONTENT_DIR / "generated.json"
BATCH_STATE = CONTENT_DIR / "batch.json"

MODEL = "claude-opus-5-5"
WORDS_PER_REQUEST = 10
# Claude Opus 5.5 list prices per million tokens; the Batch API halves them.
PRICE = {"input": 4.00, "cache_write": 5.00, "cache_read": 0.20, "output": 20.00}

CATEGORIES = [
    "direction",      # position, direction, plane (anterior, lateralis, sagittalis)
    "bone",           # bones and bony landmarks (scapula, acromion, vomer)
    "joint",          # joints, ligaments, cartilage
    "muscle",         # muscles and muscle functions (abductor, masseter)
    "nervous",        # brain, spinal cord, nerves
    "vessel",         # heart, arteries, veins, blood, lymph
    "digestive",      # mouth to anus, liver, pancreas
    "respiratory",    # nose, larynx, lungs
    "urogenital",     # kidneys, bladder, reproductive organs
    "senses",         # eye, ear, skin
    "region",         # body regions and surface parts (abdomen, genu, facies)
    "structure",      # generic structures: fossa, foramen, processus, membrana
    "shape",          # descriptive shape/quality adjectives (falciformis, rotundus)
    "general",        # everything else (vita, sanguis as a concept, numbers, prefixes)
]
WORD_TYPES = ["noun", "adjective", "plural", "prefix", "other"]

SYSTEM_INSTRUCTIONS = """You are writing study content for a Danish university student who must learn the meaning of about 690 Latin anatomical and medical terms for an exam. The content goes into a flashcard quiz app: she sees the Latin word, picks the English meaning from four options, and then sees a short Danish explanation and a memory tip.

The full word list is below. Each line is: id | Latin as written in her course list | English from a shared student spreadsheet | German | Czech. The English column was made by students and is often imprecise, wrong, or "???". The German and Czech columns are usually more reliable. Use your own knowledge of anatomical Latin (Terminologia Anatomica) as the authority.

For each word you are asked about, produce:

- headword: the Latin dictionary form without grammatical endings, e.g. "abdomen", "accessorius", "genio-", "vibrissae".
- word_type: noun, adjective, plural, prefix or other.
- word_type_da: a short Danish grammar label, e.g. "navneord, intetkøn (gen. abdominis)", "tillægsord", "forstavelse", "navneord i flertal".
- english: the accurate meaning in plain English, 1 to 6 words, lowercase except proper nouns. This is shown as a quiz answer option, so it must be precise, distinguishable from the other words' meanings, and must not give the answer away: do not repeat the Latin word or its obvious English cognate when a plain descriptive meaning exists (abdomen -> "belly", acromion -> "bony tip of the shoulder blade", mastoideus -> "nipple-shaped", caudalis -> "toward the tail", lateralis -> "toward the side"). Use the cognate only when no reasonable plain alternative exists. For adjectives use a form like "relating to the palm".
- english_term: the standard English anatomical term or cognate, e.g. "abdomen", "acromion", "mastoid", "caudal". It may be identical to english.
- english_changed: true if your meaning differs from the student spreadsheet's English in substance (missing, "???", wrong, or misleading). False if it only differs in wording, capitalization, spelling, or plain-English versus technical term.
- danish: the Danish meaning, 1 to 4 words, e.g. "bug, mave" or "skulderblad".
- explanation_da: 1 to 3 short sentences in Danish explaining what the word means and where it is used in anatomy, ideally with one real example term (e.g. "musculus abductor pollicis"). Write naturally, like a good Danish teaching assistant. No filler.
- mnemonic_da: 1 to 2 short sentences in Danish with a memory tip. Prefer real etymology and connections to Danish or English words she already knows (e.g. "dexter" and "dexterity"; "cornu" and "unicorn"; "vitreus" and "vitrine"). Never invent an etymology. If no honest connection exists, use a vivid visual image or a sound association, and present it as a memory trick, not as a fact.
- category: one of the categories in the schema.
- image_relevant: true only if a picture of a specific anatomical structure would really help her remember the word (bones, organs, muscles, specific structures like "acromion", "vomer", "cochlea"). False for directions, general adjectives, shapes, qualities, prefixes, concepts.
- wikipedia_title: if image_relevant, the exact English Wikipedia article title whose main image best shows the structure (e.g. "Scapula", "Acromion", "Vomer"); otherwise "".
- distractor_ids: exactly 6 ids of OTHER words from the list whose English meanings would be plausible but clearly wrong answer options for this word. Prefer the same word type and the same or a neighbouring category, so the quiz tests real understanding (a bone versus other bones, a direction versus other directions). Never include a word with the same or overlapping meaning.
- similar_ids: ids of other words in the list with the same or strongly overlapping meaning (e.g. anterior and ventralis, posterior and dorsalis), which must never appear as answer options together. Empty list if none.

Return one entry per requested id, in the requested order, with the exact ids given.

WORD LIST:
"""


def word_line(w):
    return " | ".join([w["id"], w["latin_full"], w["english_original"] or "-", w["german"] or "-", w["czech"] or "-"])


def build_system(words):
    listing = "\n".join(word_line(w) for w in words)
    return [{"type": "text", "text": SYSTEM_INSTRUCTIONS + listing, "cache_control": {"type": "ephemeral"}}]


def output_schema():
    entry = {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "headword": {"type": "string"},
            "word_type": {"type": "string", "enum": WORD_TYPES},
            "word_type_da": {"type": "string"},
            "english": {"type": "string"},
            "english_term": {"type": "string"},
            "english_changed": {"type": "boolean"},
            "danish": {"type": "string"},
            "explanation_da": {"type": "string"},
            "mnemonic_da": {"type": "string"},
            "category": {"type": "string", "enum": CATEGORIES},
            "image_relevant": {"type": "boolean"},
            "wikipedia_title": {"type": "string"},
            "distractor_ids": {"type": "array", "items": {"type": "string"}},
            "similar_ids": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "id", "headword", "word_type", "word_type_da", "english", "english_term", "english_changed", "danish",
            "explanation_da", "mnemonic_da", "category", "image_relevant", "wikipedia_title",
            "distractor_ids", "similar_ids",
        ],
        "additionalProperties": False,
    }
    return {
        "type": "json_schema",
        "schema": {
            "type": "object",
            "properties": {"words": {"type": "array", "items": entry}},
            "required": ["words"],
            "additionalProperties": False,
        },
    }


def request_params(words, ids):
    by_id = {w["id"]: w for w in words}
    asked = "\n".join(word_line(by_id[i]) for i in ids)
    return {
        "model": MODEL,
        "max_tokens": 32000,
        "system": build_system(words),
        "output_config": {"effort": "high", "format": output_schema()},
        "messages": [{"role": "user", "content": f"Write the content for these {len(ids)} words:\n{asked}"}],
    }


def read_dotenv():
    path = ROOT / ".env"
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        name, sep, value = line.partition("=")
        if sep and name.strip() == "ANTHROPIC_API_KEY":
            return value.strip().strip("\"'") or None
    return None


def load_api_key():
    key = os.environ.get("ANTHROPIC_API_KEY") or read_dotenv()
    if not key and sys.platform == "win32":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
                key, _ = winreg.QueryValueEx(k, "ANTHROPIC_API_KEY")
        except OSError:
            key = None
    if not key:
        sys.exit("No ANTHROPIC_API_KEY found (environment or Windows user environment).")
    return key.strip()


def load_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def cost(usage, batch):
    d = (
        (usage.input_tokens or 0) * PRICE["input"]
        + (usage.cache_creation_input_tokens or 0) * PRICE["cache_write"]
        + (usage.cache_read_input_tokens or 0) * PRICE["cache_read"]
        + (usage.output_tokens or 0) * PRICE["output"]
    ) / 1_000_000
    return d / 2 if batch else d


def parse_message(msg):
    if msg.stop_reason != "end_turn":
        raise ValueError(f"stop_reason={msg.stop_reason}")
    text = next(b.text for b in msg.content if b.type == "text")
    return json.loads(text)["words"]


def check_entries(entries, ids, valid_ids):
    got = [e["id"] for e in entries]
    problems = []
    if sorted(got) != sorted(ids):
        problems.append(f"ids mismatch: asked {ids}, got {got}")
    for e in entries:
        bad = [d for d in e["distractor_ids"] + e["similar_ids"] if d not in valid_ids or d == e["id"]]
        if bad:
            problems.append(f"{e['id']}: unknown or self ids {bad}")
            e["distractor_ids"] = [d for d in e["distractor_ids"] if d in valid_ids and d != e["id"]]
            e["similar_ids"] = [d for d in e["similar_ids"] if d in valid_ids and d != e["id"]]
    return problems


def cmd_test(args, words):
    ids = args.ids.split(",") if args.ids else [w["id"] for w in words[:WORDS_PER_REQUEST]]
    client = anthropic.Anthropic(api_key=load_api_key())
    t0 = time.time()
    with client.messages.stream(**request_params(words, ids)) as stream:
        msg = stream.get_final_message()
    entries = parse_message(msg)
    problems = check_entries(entries, ids, {w["id"] for w in words})
    save_json(CONTENT_DIR / "test.json", entries)
    u = msg.usage
    print(json.dumps(entries, ensure_ascii=False, indent=1))
    print(f"\n{len(entries)} words in {time.time() - t0:.0f}s")
    print(f"usage: in={u.input_tokens} cache_write={u.cache_creation_input_tokens} "
          f"cache_read={u.cache_read_input_tokens} out={u.output_tokens}")
    print(f"cost: ${cost(u, batch=False):.3f} (would be ${cost(u, batch=True):.3f} in a batch)")
    for p in problems:
        print("PROBLEM:", p)


def cmd_submit(args, words):
    done = load_json(GENERATED, {})
    todo = [w["id"] for w in words if w["id"] not in done]
    if not todo:
        print("Everything is already generated.")
        return
    chunks = [todo[i:i + WORDS_PER_REQUEST] for i in range(0, len(todo), WORDS_PER_REQUEST)]
    client = anthropic.Anthropic(api_key=load_api_key())
    batch = client.messages.batches.create(requests=[
        Request(custom_id=f"chunk-{n:03d}", params=MessageCreateParamsNonStreaming(**request_params(words, ids)))
        for n, ids in enumerate(chunks)
    ])
    save_json(BATCH_STATE, {"batch_id": batch.id, "chunks": {f"chunk-{n:03d}": ids for n, ids in enumerate(chunks)}})
    print(f"Submitted batch {batch.id}: {len(todo)} words in {len(chunks)} requests")


def cmd_collect(args, words):
    state = load_json(BATCH_STATE, None)
    if not state:
        sys.exit("No batch submitted.")
    client = anthropic.Anthropic(api_key=load_api_key())
    while True:
        batch = client.messages.batches.retrieve(state["batch_id"])
        c = batch.request_counts
        print(f"{batch.processing_status}: processing={c.processing} succeeded={c.succeeded} errored={c.errored}", flush=True)
        if batch.processing_status == "ended":
            break
        time.sleep(30)
    done = load_json(GENERATED, {})
    valid = {w["id"] for w in words}
    total = 0.0
    failed = []
    for result in client.messages.batches.results(state["batch_id"]):
        ids = state["chunks"][result.custom_id]
        if result.result.type != "succeeded":
            failed.append((result.custom_id, result.result.type))
            continue
        msg = result.result.message
        total += cost(msg.usage, batch=True)
        try:
            entries = parse_message(msg)
        except (ValueError, StopIteration, json.JSONDecodeError) as e:
            failed.append((result.custom_id, str(e)))
            continue
        for p in check_entries(entries, ids, valid):
            print("PROBLEM:", p)
        for e in entries:
            if e["id"] in ids:
                done[e["id"]] = e
    save_json(GENERATED, done)
    print(f"Merged. {len(done)}/{len(words)} words generated. Batch cost ≈ ${total:.2f}")
    for f in failed:
        print("FAILED:", f)


def cmd_status(args, words):
    done = load_json(GENERATED, {})
    missing = [w["id"] for w in words if w["id"] not in done]
    print(f"{len(done)}/{len(words)} generated; missing: {missing[:50]}{' ...' if len(missing) > 50 else ''}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["test", "submit", "collect", "status"])
    p.add_argument("--ids", help="comma-separated ids for the test command")
    args = p.parse_args()
    words = json.loads(SOURCE.read_text(encoding="utf-8"))
    {"test": cmd_test, "submit": cmd_submit, "collect": cmd_collect, "status": cmd_status}[args.command](args, words)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
