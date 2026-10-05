"""Integrity of data/cards.json, and that the build script reproduces it."""
import json
import re
import subprocess
import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "data" / "cards.json"
PLACEHOLDERS = {"—", "-", "–", "exemple pendent de revisió.", "revisar model irregular."}
TENSES = {"present", "perfet", "imperfet", "perifrastic", "futur", "condicional", "subjuntiu", "imperatiu"}
FIELDS = {"id", "type", "ca", "es", "en", "ar", "ex", "pron", "gender", "unit", "cat", "notes",
          "tags", "conj", "conjAuto", "ger", "part"}


class DeckData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.deck = json.loads(CARDS.read_text(encoding="utf-8"))
        cls.items = cls.deck["items"]

    def test_ids_unique_and_well_formed(self):
        ids = [i["id"] for i in self.items]
        self.assertEqual(len(ids), len(set(ids)))
        for i in ids:
            self.assertRegex(i, r"^[0-9a-f]{10}$")

    def test_types_fields_and_no_empty_catalan(self):
        for it in self.items:
            self.assertIn(it["type"], {"word", "verb", "expr"})
            self.assertTrue(it["ca"].strip(), it)
            self.assertLessEqual(set(it), FIELDS, it["ca"])
            if "unit" in it:
                self.assertRegex(it["unit"], r"^U\d\d$", it["ca"])

    def test_no_placeholders_or_blank_values(self):
        for it in self.items:
            for k, v in it.items():
                if isinstance(v, str):
                    self.assertNotIn(v.strip().lower(), PLACEHOLDERS, f'{it["ca"]}.{k}')
                    self.assertTrue(v.strip(), f'{it["ca"]}.{k} is blank')

    def test_conjugation_tables(self):
        n = 0
        for it in self.items:
            if "conj" not in it:
                continue
            n += 1
            self.assertLessEqual(set(it["conj"]), TENSES, it["ca"])
            for t, forms in it["conj"].items():
                self.assertEqual(len(forms), 5 if t == "imperatiu" else 6, f'{it["ca"]} {t}')
                for f in forms:
                    self.assertTrue(f.strip(), f'{it["ca"]} {t}')
                    self.assertNotIn(":", f, f'{it["ca"]} {t}: label left in form')
        self.assertGreaterEqual(n, 200)

    def test_tags_valid(self):
        for it in self.items:
            for t in it.get("tags", []):
                self.assertRegex(t, r"^(src|cpnl|exam|others):.+", it["ca"])
                if t.startswith("cpnl:"):
                    self.assertIn(t, {"cpnl:U1", "cpnl:U2", "cpnl:U3", "cpnl:U4"})

    def test_no_duplicate_catalan_within_a_type(self):
        def key(it):
            return (it["type"] == "verb", it["ca"].lower().replace("'", "’").rstrip(".!?"))
        dups = [k for k, n in Counter(key(i) for i in self.items).items() if n > 1]
        self.assertEqual(dups, [])

    def test_units_map(self):
        self.assertEqual(len(self.deck["units"]), 15)
        used = {i["unit"] for i in self.items if "unit" in i}
        self.assertLessEqual(used, set(self.deck["units"]))

    def test_rebuild_is_identical_and_ids_stable(self):
        before = CARDS.read_bytes()
        out = subprocess.run([sys.executable, str(ROOT / "tools/build_deck.py")],
                             capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(out.returncode, 0, out.stderr)
        after = CARDS.read_bytes()
        if after != before:
            CARDS.write_bytes(before)
            self.fail("build_deck.py output differs from the committed data/cards.json")


if __name__ == "__main__":
    unittest.main()
