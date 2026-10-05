"""Build data/cards.json from the CSV snapshot of the "Vocab Catala" sheet.

Run from the repo root:  python3 tools/build_deck.py
Item ids are stable (hash of type + Catalan), so review progress survives a rebuild.
"""
import csv, hashlib, json, re, unicodedata
from pathlib import Path

from conjugate import conjugate

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"
OUT = ROOT / "data" / "cards.json"

TENSES = ["Present", "Perfet", "Imperfet", "Passat perifràstic", "Futur",
          "Condicional", "Present de subjuntiu"]
TENSE_KEYS = ["present", "perfet", "imperfet", "perifrastic", "futur",
              "condicional", "subjuntiu"]
# "Regular" in the sheet but not conjugated by the -ar / -eix- rules
NOT_REGULAR = {"bullir", "ajupir-se", "descobrir", "vestir-se", "correr", "sentir"}
# Sheet tables with spelling mistakes (truces → truques, pleges → plegues): use the rules instead
SHEET_ERRORS = {"trucar", "plegar"}
# Marked "Irregular" in the sheet, but they follow the regular rules
ALSO_REGULAR = {"donar", "portar", "posar", "tornar", "establir", "preferir", "servir", "repetir"}
ARTICLES = r"^(el|la|els|les|l['’]|un|una|uns|unes)\s*"


def rows(name):
    with open(SRC / name, encoding="utf-8") as f:
        return list(csv.reader(f))


PLACEHOLDERS = {"—", "-", "–", "exemple pendent de revisió.", "revisar model irregular."}


def clean(s):
    s = (s or "").strip()
    return "" if s.lower() in PLACEHOLDERS else s


def norm(s):
    s = unicodedata.normalize("NFC", clean(s).lower()).replace("'", "’")
    return re.sub(r"\s+", " ", s.rstrip(".!?¡¿"))


def bare(s):
    """Catalan term without its article, for matching."""
    return re.sub(ARTICLES, "", norm(s))


def make_id(kind, ca):
    return hashlib.sha1(f"{kind}|{norm(ca)}".encode()).hexdigest()[:10]


items = {}       # id -> item
by_key = {}      # (kind-group, norm ca) -> id


def add(kind, ca, **f):
    ca = clean(ca)
    if not ca:
        return None
    group = "verb" if kind == "verb" else "lex"
    key = (group, norm(ca))
    if key in by_key:
        it = items[by_key[key]]
        for k, v in f.items():
            if k == "tags":
                it["tags"] = sorted(set(it.get("tags", [])) | set(v))
            elif v and not it.get(k):
                it[k] = v
        return it
    iid = make_id(kind, ca)
    it = {"id": iid, "type": kind, "ca": ca}
    for k, v in f.items():
        if v:
            it[k] = sorted(set(v)) if k == "tags" else v
    items[iid] = it
    by_key[key] = iid
    return it


def persons(cell):
    """'jo: vaig\\ntu: vas\\n…' -> ['vaig', 'vas', …] (6 forms)."""
    out = [l.split(":", 1)[1].strip() if ":" in l else l.strip()
           for l in clean(cell).split("\n") if l.strip()]
    return out if len(out) == 6 else None


# Verbs first, so vocab rows that repeat an infinitive merge into the verb.
r = rows("verbs_by_unit.csv")
h = r[0]
col = {name: i for i, name in enumerate(h)}
for x in r[1:]:
    g = lambda n: clean(x[col[n]]) if col[n] < len(x) else ""
    conj = {}
    for t, k in zip(TENSES, TENSE_KEYS):
        p = persons(g(t))
        if p:
            conj[k] = p
    imp = [l.strip() for l in g("Imperatiu").split("\n") if l.strip()]
    if len(imp) == 5:
        conj["imperatiu"] = imp
    kind = "verb" if g("Verb Category") != "Expression" else "expr"
    verb, ger, part, auto = g("Verb"), g("Gerundi"), g("Participi"), None
    if (verb in SHEET_ERRORS or (not conj and (g("Verb Category") == "Regular" or verb in ALSO_REGULAR))) \
            and verb not in NOT_REGULAR and g("Conjugation Group") in ("-ar", "-ir"):
        res = conjugate(verb)
        if res:
            conj, part, ger = res
            auto = True
    add(kind, verb, es=g("Spanish"), ar=g("Arabic"), en=g("English"),
        ex=g("Example Sentence"), unit=g("Unit ID"),
        cat=f'{g("Verb Category")} {g("Conjugation Group")}'.strip(),
        ger=ger, part=part, notes="" if auto else g("Notes"),
        conj=conj or None, conjAuto=auto, tags=["src:verbs"])

verb_inf = {bare(it["ca"]) for it in items.values() if it["type"] == "verb"}

r = rows("vocab_by_unit.csv")
for x in r[1:]:
    unit, uname, ca, lemma, gender, pattern, pron, ex, es, ar, en = (x + [""] * 12)[:11]
    if bare(ca) in verb_inf:
        continue
    kind = "expr" if pattern == "phrase / expression" else "word"
    notes = f"lemma: {lemma}" if clean(lemma) not in ("", "-") and norm(lemma) != bare(ca) else ""
    add(kind, ca, es=clean(es), ar=clean(ar), en=clean(en), ex=clean(ex),
        pron=clean(pron), gender=clean(gender) if gender != "-" else "",
        unit=unit, notes=notes, tags=["src:vocab"])

r = rows("others.csv")
for x in r[2:]:
    cat, ca, sub, es, ar, notes, ex = (x + [""] * 7)[:7]
    if not clean(ca) or not clean(cat):
        continue
    kind = "expr" if cat.startswith("expressions") else "word"
    add(kind, ca, es=clean(es), ar=clean(ar), ex=clean(ex), notes=clean(notes),
        cat=" · ".join(c for c in (clean(cat), clean(sub)) if c),
        tags=["src:others", "others:" + clean(cat).lower()])

theme = None
for x in rows("exam_focus.csv"):
    x = (x + [""] * 8)[:8]
    if re.match(r"^\d+\. ", x[0]) and not any(x[1:]):
        theme = re.sub(r"^\d+\.\s*", "", x[0]).split(" — ")[0].strip()
        continue
    if not theme or x[0] == "Subtheme" or not clean(x[2]):
        continue
    sub, typ, ca, es, en, unit, ex, _ = x
    kind = "verb" if typ == "verb" else "expr" if typ == "expression" else "word"
    if kind == "verb" and bare(ca) not in verb_inf:
        kind = "word"
    add(kind, ca, es=clean(es), en=clean(en), ex=clean(ex), unit=unit,
        tags=["exam:" + theme])

r = rows("new_vocab.csv")
for x in r:
    x = (x + [""] * 3)[:3]
    if clean(x[0]):
        add("word", x[0], ar=clean(x[1]), en=clean(x[2]), tags=["src:new"])

# CPNL Elemental 1 course units (optional, derived term lists)
cpnl = ROOT / "data" / "source" / "cpnl_terms.json"
if cpnl.exists():
    terms = json.loads(cpnl.read_text(encoding="utf-8"))
    for it in items.values():
        units = terms.get(bare(it["ca"]))
        if units:
            it["tags"] = sorted(set(it.get("tags", [])) | {f"cpnl:U{u}" for u in units})

units = {}
for x in rows("unit_guide.csv")[5:]:
    if len(x) > 2 and re.match(r"^U\d\d$", x[1]):
        units[x[1]] = x[2]

deck = {"version": 1, "units": units,
        "items": sorted(items.values(), key=lambda i: (i.get("unit") or "U99", i["ca"].lower()))}
OUT.write_text(json.dumps(deck, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

from collections import Counter
print(len(items), "items", dict(Counter(i["type"] for i in items.values())))
print("with conjugations:", sum(1 for i in items.values() if i.get("conj")),
      "(rule-generated:", sum(1 for i in items.values() if i.get("conjAuto")), ")")
print("verbs without conjugations:", ", ".join(sorted(i["ca"] for i in items.values() if i["type"] == "verb" and not i.get("conj"))))
print("missing es/en/ar:", *(sum(1 for i in items.values() if not i.get(k)) for k in ("es", "en", "ar")))
print("cpnl-tagged:", sum(1 for i in items.values() if any(t.startswith("cpnl:") for t in i.get("tags", []))))
