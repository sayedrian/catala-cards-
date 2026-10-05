// Quality audits: accessibility (axe-core), layout at several screen sizes in light + dark,
// and Lighthouse. Writes tests/out/audit.json and screenshots to tests/out/screens/.
// Run: npm run audit
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startServer, launch, newContext, openApp, tab, OUT, sleep } from './e2e/helpers.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
mkdirSync(OUT + 'screens', { recursive: true });

const server = await startServer();
const browser = await launch();
const report = { axe: {}, layout: [], lighthouse: null };

// Tap like a user: scroll the button into the middle of the screen first.
const click = (p, sel) => p.$eval(sel, e => { e.scrollIntoView({ block: 'center' }); e.click(); });

const SCREENS = {
  'study-home': async p => {},
  'study-front': async p => { await click(p, '#startBtn'); },
  'study-back': async p => { await click(p, '#startBtn'); await click(p, '#showBtn'); },
  'study-reverse-ar': async (p, reopen) => {
    // day 1: learn 15 cards; day 2: their "? → Català" cards come first
    await click(p, '#startBtn');
    for (let i = 0; i < 15; i++) { await click(p, '#showBtn'); await click(p, '.rate.easy'); }
    await p.close();
    const q = await reopen({ days: 1 });
    await click(q, '#startBtn');
    return q;
  },
  'conjugation': async p => { await click(p, '#modeSeg input[value=conj]'); await click(p, '#startBtn'); await click(p, '#showBtn'); },
  'study-conj-home': async p => { await click(p, '#modeSeg input[value=conj]'); },
  'add': async p => { await tab(p, 'add'); },
  'words': async p => { await tab(p, 'words'); },
  'detail': async p => { await tab(p, 'words'); await p.type('#search', 'tovallola'); await click(p, '#wordList li'); },
  'print': async p => { await tab(p, 'print'); },
  'more': async p => { await tab(p, 'more'); },
};

// 1. Accessibility, every screen, light and dark
for (const dark of [false, true]) {
  for (const [name, go] of Object.entries(SCREENS)) {
    const ctx = await newContext(browser);
    let p = await openApp(ctx, server.url, { dark });
    p = (await go(p, o => openApp(ctx, server.url, { dark, ...o }))) || p;
    await p.addScriptTag({ content: AXE });
    const res = await p.evaluate(async () => {
      const r = await axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, where: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
    });
    report.axe[`${name}${dark ? ' (dark)' : ''}`] = res;
    await ctx.close();
  }
}

// 2. Layout at several sizes: screenshots, horizontal scroll, buttons hidden under the tab bar, Arabic RTL
const SIZES = [['phone-small', 360, 740], ['phone', 412, 870], ['landscape', 870, 412], ['desktop', 1280, 900]];
for (const [label, w, h] of SIZES) {
  for (const dark of [false, true]) {
    for (const name of ['study-home', 'study-back', 'study-reverse-ar', 'add', 'words', 'more']) {
      const ctx = await newContext(browser);
      let p = await openApp(ctx, server.url, { width: w, height: h, dark });
      p = (await SCREENS[name](p, o => openApp(ctx, server.url, { width: w, height: h, dark, ...o }))) || p;
      await sleep(100);
      const m = await p.evaluate(() => {
        const out = { hScroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
        window.scrollTo(0, document.body.scrollHeight);
        const tabs = document.querySelector('.tabs').getBoundingClientRect();
        const covered = [...document.querySelectorAll('main button, main input, main select')]
          .filter(e => e.offsetParent && !e.closest('[hidden]'))
          .filter(e => { const r = e.getBoundingClientRect(); return r.bottom > tabs.top + 1 && r.top < tabs.bottom; })
          .map(e => e.id || e.textContent.trim().slice(0, 20));
        out.coveredByTabs = covered;
        const ar = [...document.querySelectorAll('.ar, [lang=ar]')].filter(e => e.offsetParent);
        out.arabicRtl = ar.every(e => getComputedStyle(e).direction === 'rtl');
        out.bg = getComputedStyle(document.body).backgroundColor;
        return out;
      });
      const file = `${label}-${dark ? 'dark' : 'light'}-${name}.png`;
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.screenshot({ path: OUT + 'screens/' + file });
      report.layout.push({ size: label, dark, screen: name, file, ...m });
      await ctx.close();
    }
  }
}

// 3. Lighthouse (mobile)
try {
  execFileSync('npx', ['--yes', 'lighthouse@12', server.url, '--quiet', '--output=json', `--output-path=${OUT}lighthouse.json`,
    '--chrome-flags=--headless=new', '--only-categories=performance,accessibility,best-practices,seo'],
  { stdio: 'ignore', env: { ...process.env, CHROME_PATH: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }, timeout: 300000 });
  const lh = JSON.parse(readFileSync(OUT + 'lighthouse.json', 'utf8'));
  report.lighthouse = {
    scores: Object.fromEntries(Object.entries(lh.categories).map(([k, c]) => [k, Math.round(c.score * 100)])),
    failed: Object.values(lh.audits).filter(a => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'manual')
      .map(a => `${a.id}: ${a.title}${a.displayValue ? ' (' + a.displayValue + ')' : ''}`),
    metrics: ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'total-byte-weight']
      .map(k => `${lh.audits[k].title}: ${lh.audits[k].displayValue}`),
  };
} catch (e) {
  report.lighthouse = { error: String(e.message).slice(0, 300) };
}

await browser.close();
server.stop();
writeFileSync(OUT + 'audit.json', JSON.stringify(report, null, 1));

// Summary
const axeAll = Object.entries(report.axe).flatMap(([s, v]) => v.map(x => `${s}: [${x.impact}] ${x.id} ×${x.n}: ${x.help} → ${x.where.join(', ')}`));
console.log(`axe: ${axeAll.length} violations`); axeAll.forEach(l => console.log('  ' + l));
const bad = report.layout.filter(l => l.hScroll || l.coveredByTabs.length || !l.arabicRtl);
console.log(`layout: ${report.layout.length} screenshots, ${bad.length} problems`);
bad.forEach(l => console.log(`  ${l.size} ${l.dark ? 'dark' : 'light'} ${l.screen}: hScroll=${l.hScroll} covered=${l.coveredByTabs} rtl=${l.arabicRtl}`));
console.log('lighthouse:', JSON.stringify(report.lighthouse, null, 1));
