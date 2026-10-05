# Test report: 05/10/2026 (Phase 1, version v3)

## Update v3 (your feedback after trying it)
- **Bug "cards never move to the next word":** in the default deck a verb came 4 times in a row (meaning + 3 conjugation tables, all showing the same big word). Also possible: right after an update, the offline cache could mix old and new files and freeze the buttons. Fixed: vocabulary and conjugation never mix; conjugation goes across verbs (present of anar, dir, estar…); the app now loads fresh files whenever online (cache only offline). New test: no word twice in a row, in both modes.
- **New "✓ I know it" button** while studying: the word (both directions) → learned, leaves the session; Undo for 8 seconds. On a conjugation card: only that verb × tense. Does not use a new-card slot.
- **Choose Vocabulary or Conjugation** on the Study screen: own stats, own daily limit (15 / 5, in More), tenses chosen right there; the choice is remembered.
- Tests now: **88** (31 JS unit + 15 Python + 42 browser), all pass; accessibility 0 violations; layout 48 screenshots OK.

---
## Earlier: first full test (v2)

**Result: 80 / 80 automated tests pass**, locally and against the live site https://sayedrian.github.io/catala-cards-/.
Re-run: `npm test` (and `npm run audit`). How: `tests/README.md`.

| Layer | Tests | Result |
|---|---|---|
| JavaScript unit (`tests/unit/`): scheduling (FSRS), queue order, daily limit, filters, stats, weakest cards, prioritize, translations (mocked) | 28 | ✅ all pass |
| Python (`tests/test_*.py`): conjugation rules vs the sheet's 17 full regular tables, spelling/diaeresis/pronominal rules, deck integrity, rebuild = committed `cards.json` | 15 | ✅ all pass |
| Browser end-to-end (`tests/e2e/`), headless Chrome at phone size: study (all 5 decks), ratings, learning steps, keyboard, time travel (+1/+40/+441 days), add + translate, duplicates, offline add → translated later, word search (4 languages) + filters, detail actions, conjugation tables, print (A4 PDF, mirrored backs), settings, backup export/import/merge, wrong backup file, persistence, audio + recording | 32 | ✅ all pass |
| PWA / offline: manifest, icons, all files cached, works offline, installable (no Chrome errors), update replaces old cache | 5 | ✅ all pass |
| **Same 37 browser tests against the live GitHub Pages site** | 37 | ✅ all pass |

## Audits
| Audit | Result |
|---|---|
| Accessibility (axe-core), 10 screens × light/dark | **0 violations** (was 22 before fixes) |
| Layout: 48 screenshots (360×740, 412×870, 870×412 landscape, 1280 desktop × light/dark × 6 screens) | no sideways scroll, nothing hidden under the tab bar, Arabic right-to-left everywhere |
| Lighthouse, **live site** (mobile) | Performance **100** · Accessibility **100** · Best practices **100** · SEO **100**. First paint 1.0 s, largest paint 1.5 s, 130 KB transferred (deck gzipped 343 → 109 KB) |
| Lighthouse, local server (no compression) | 88 / 100 / 100 / 100 |
| Speed of the logic | queue + stats on the full deck (≈2,900 cards): 7 ms; on a 3× deck: 13 ms |

## Bugs found and fixed
1. **Last answers could be lost.** Saving waited 0.3 s after an answer; closing the app straight away lost it. Now every answer is saved at once, and again when the app is hidden/closed (one open database connection, so the save starts immediately).
2. **"? → Català" cards practically never came.** New cards were sorted so all "Català → ?" cards came first: with 15 new/day, no reverse cards for ~2 weeks. Now a word's reverse card unlocks once its "Català → ?" card is learned, and comes first among new cards the next session.
3. **"Study first" re-showed cards just answered** (priority forced every not-learned card back into each session). Now "Study first" (and re-adding a known word) makes the word's cards due now **once**; after that, normal scheduling.
4. **Weakest-cards print missed cards failed today** (ranking ignored difficulty). Difficulty now counts: a card failed today prints first.
5. **Colour contrast** too low on some buttons (red buttons in dark mode, Hard, Good, active tab) and **2 missing labels** (search, status filter). Fixed → accessibility 100.

Test-side issues (not app bugs) were also fixed: wrong expectations, `package.json` quoting, a test copying the repo into itself, PDF page counting.

## Notes (by design, not bugs)
- Unlocked reverse cards count toward the 15 new cards/day, so the daily load stays even (like Anki).
- In landscape the rating buttons are below the fold (scroll); the app is set to portrait.
- "Again" then "Good" on a new card → review in 1 day (no extra step).

## Still to test on the phone (can't be automated from the Mac)
- [ ] Install: Chrome ⋮ → "Add to Home screen" / "Install app"; opens full-screen with the red/yellow icon.
- [ ] Catalan voice: install it (Settings → Text-to-speech → Google → Install voice data → Català); 🔊 Listen and More → Test voice.
- [ ] Microphone: 🎙 Record asks permission once; "▶ Me" and "🔁 Model + me" play back.
- [ ] Offline: airplane mode → open the app → study a few cards → back online.
- [ ] Add a word on the phone keyboard (Catalan accents, Arabic keyboard).
- [ ] Backup: More → Save backup file → it lands in Downloads.
- [ ] Print from a laptop: Print tab → double-sided, "flip on long edge" → fronts and backs line up.
