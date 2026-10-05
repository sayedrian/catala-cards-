# "Explain more" content

Shown in the app after the answer (button **💡 Explain more**): 1) examples, 2) how to use it, 3) word family. Decided 05/10/2026: no links, no grammar notes, app only (not printed cards).

- One JSON file per batch here (keyed by item id). `python3 tools/build_context.py` checks them and writes `data/context.json` (loaded by the app, works offline).
- Batches: `cpnl-u1-u2.json` = CPNL Elemental 1 Unit 1–2 words in the deck (101 items, 05/10/2026), written by Claude from the course topics, then reviewed by a second pass (2 Arabic fixes, 4 notes rewritten).
- Next batches: CPNL U3–U4 words, Exam_Focus words, then the rest of the sheet; new words added in the app.

Writing guide used for every batch:

---

# "Explain more" content: writing guide

Learner: adult, CPNL **Elemental 1** (≈A2), studies Catalan via **Spanish** (main bridge), also English and Arabic (native-level reader of Arabic). Goal: pass the oral tasks (Unit 1 "Fer amics": describe people, character, clothes, habits, daily routine; Unit 2: hobbies/likes with agradar, describing objects, colours, materials) and really learn Catalan.

For each input item write 3 parts. The **input item's own translations (es/en/ar) define the meaning** — when a word has several meanings (e.g. "el cap" = head vs "cap" = none), write only about the meaning given. `course` tells you which CPNL activity/topic it comes from: set the examples in that topic when it fits naturally.

## 1. `ex`: 3 example sentences
- Standard central Catalan (IEC norms, correct apostrophes ’ and accents, l·l). Level A2: short (≤ 12 words), everyday, concrete, natural.
- Each sentence uses the item (any correct form: feminine/plural, conjugated, with pronoun).
- 3 **different** situations/meanings-in-use; do not repeat the item's existing example (`ex` in the input).
- Prefer the item's course topic (describing a friend, clothes, daily routine, hobbies, objects…), present tense mostly; one can be a short question+answer if natural.
- Each with translations: `es` (Spain Spanish), `en`, `ar` (Modern Standard Arabic, natural, fully correct). Translate the meaning naturally, not word by word.
- Do NOT copy sentences from CPNL course materials (the app is public); write your own.

## 2. `use`: how to use it (2–4 short notes, English)
Pick what is genuinely useful for THIS word, e.g.:
- common word partners / set phrases, with the Catalan in *italics-free plain text* (e.g. "fer fosc = to get dark").
- formal vs informal / spoken vs written, if relevant.
- **typical mistakes for Spanish speakers** — only real ones (false friends, different gender than Spanish, different preposition, Spanish-like forms that are wrong in Catalan, e.g. "✗ *bueno* → ✓ bo / bé"). Mark wrong forms with ✗ and right with ✓.
- for verbs: the construction that matters (e.g. "agradar works like gustar: m’agrada el cinema"; "queixar-se de").
No grammar lectures, no links. Each note ≤ 25 words. Never invent rules; if unsure, leave it out.

## 3. `family`: word family (2–6 entries)
Related words that help memory: feminine/plural forms (for adjectives/nouns when not trivial), nouns/verbs/adjectives from the same root, opposites (prefix the Catalan with "↔ "), close synonyms (prefix "≈ "). Each entry: `{"ca": "...", "en": "short meaning or role"}`. Only real, standard words (DIEC). For nouns include the article (la foscor).

## Output
A JSON object keyed by item id, exactly:
```json
{
  "8c10a2e4c7": {
    "ex": [
      {"ca": "A l’hivern fa fosc molt d’hora.", "es": "En invierno oscurece muy pronto.", "en": "In winter it gets dark very early.", "ar": "في الشتاء يحلّ الظلام مبكرًا جدًا."},
      {"ca": "...", "es": "...", "en": "...", "ar": "..."},
      {"ca": "...", "es": "...", "en": "...", "ar": "..."}
    ],
    "use": ["fer fosc = to get dark (weather, time of day).", "de color fosc / blau fosc = dark colour / dark blue (adjective after the colour)."],
    "family": [{"ca": "fosca, foscos, fosques", "en": "feminine / plurals"}, {"ca": "la foscor", "en": "darkness"}, {"ca": "enfosquir-se", "en": "to get dark"}, {"ca": "↔ clar", "en": "light, bright"}]
  }
}
```
Every input id must appear. Valid JSON (UTF-8, no comments, no trailing commas).
