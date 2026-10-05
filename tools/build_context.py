"""Build data/context.json ("Explain more" content) from the batch files in data/context/.

Each batch file is a JSON object keyed by item id: {"ex": [...], "use": [...], "family": [...]}.
Run from the repo root:  python3 tools/build_context.py   (exits with an error if a batch is invalid)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "context"
OUT = ROOT / "data" / "context.json"


def check(iid, c, ids):
    errs = []
    if iid not in ids:
        errs.append("id not in cards.json")
    ex = c.get("ex", [])
    if len(ex) != 3:
        errs.append(f"{len(ex)} examples (want 3)")
    for e in ex:
        for k in ("ca", "es", "en", "ar"):
            if not str(e.get(k, "")).strip():
                errs.append(f"example missing {k}")
    if not 1 <= len(c.get("use", [])) <= 4:
        errs.append(f"{len(c.get('use', []))} use notes (want 1-4)")
    fam = c.get("family", [])
    if not 1 <= len(fam) <= 6:
        errs.append(f"{len(fam)} family entries (want 1-6)")
    for f in fam:
        if not (str(f.get("ca", "")).strip() and str(f.get("en", "")).strip()):
            errs.append("family entry missing ca/en")
    extra = set(c) - {"ex", "use", "family"}
    if extra:
        errs.append(f"unknown fields {sorted(extra)}")
    return errs


def main():
    deck = json.loads((ROOT / "data" / "cards.json").read_text(encoding="utf-8"))
    ids = {i["id"] for i in deck["items"]}
    out, bad = {}, []
    for f in sorted(SRC.glob("*.json")):
        batch = json.loads(f.read_text(encoding="utf-8"))
        for iid, c in batch.items():
            errs = check(iid, c, ids)
            if errs:
                bad.append(f"{f.name} {iid}: {'; '.join(errs)}")
            out[iid] = {k: c[k] for k in ("ex", "use", "family") if k in c}
    if bad:
        print("\n".join(bad))
        sys.exit(1)
    OUT.write_text(json.dumps({"version": 1, "items": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} items with context -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
