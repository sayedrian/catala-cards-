# Tests

One-time setup: `npm install` (needs Node 20+, Python 3, and Google Chrome; set `CHROME=/path/to/chrome` if it's not in the default Mac location).

| Command | What it runs |
|---|---|
| `npm test` | everything below except the audit |
| `npm run test:unit` | JavaScript unit tests (`tests/unit/`): scheduling, queue, filters, translations (mocked) |
| `npm run test:py` | Python tests: conjugation rules vs the sheet, `data/cards.json` integrity, rebuild = committed file |
| `npm run test:e2e` | Browser tests (`tests/e2e/`) in headless Chrome at phone size: study, add, words, print, settings, backup, offline/PWA |
| `npm run audit` | Accessibility (axe), layout screenshots (4 sizes × light/dark), Lighthouse → `tests/out/` |

Run the browser tests against the live site: `BASE_URL=https://sayedrian.github.io/catala-cards-/ npm run test:e2e`.

The browser tests start a local server, use a fresh browser profile per test, fake the clock for "days later", mock the translation service, and stub the voice (headless Chrome has none).
Results, screenshots and PDFs go to `tests/out/` (not committed). Latest results: `tests/REPORT.md`.

After changing app files, bump `CACHE` in `sw.js` so installed apps update.
