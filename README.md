# Català Cards

My Catalan flashcard app: words, verbs and expressions, Catalan ↔ Spanish + English + Arabic.
Installable web app (PWA) for Android; works offline. Design and plan: in my private `cpnl` repo (`app/PLAN.md`).

**Open it:** https://sayedrian.github.io/catala-cards-/ → in Chrome on Android: ⋮ menu → "Add to Home screen" / "Install app".

## What it does (Phase 1)
- **Study** with spaced repetition (FSRS). Each item gives two cards: Català → translations, and translations → Català. Rate Again / Hard / Good / Easy.
  A card is **learned** when its next review is 21+ days away; if I fail it later, it goes back to learning.
- **Decks:** everything, words, verbs, expressions, verb conjugations (choose the tenses in More). **Topics:** CPNL course unit, exam theme, sheet unit.
- **Add** a word: "Translate" suggests Spanish / English / Arabic (MyMemory, free). New words come first in the next session.
  Saved offline → translated when back online. New words stay "not checked" until reviewed.
- **Listen** (the phone's Catalan voice) and **record** myself, then "Model + me" to compare.
- **Print** A4: 10 cards per sheet, front = Català, back = translations (print double-sided, flip on long edge).
- **Backup:** More → Save backup file. Loading a backup merges it (newest wins, nothing is deleted).

## Data
- `data/source/*.csv`: snapshot of my Google Sheet "Vocab Catala" (05/10/2026) + `cpnl_terms.json` (CPNL Elemental 1 term lists, for the course-unit tags).
- `data/cards.json`: built by `python3 tools/build_deck.py`. Item ids are stable, so progress survives a rebuild.
- `tools/conjugate.py`: conjugations for regular -ar and -ir (-eix-) verbs that the sheet marks "Model regular" (shown as "made by rule").

Progress lives on the device (IndexedDB), not in this repo.

## Updating the app
After changing files, bump `CACHE` in `sw.js` (e.g. `v2`) so phones fetch the new version.
