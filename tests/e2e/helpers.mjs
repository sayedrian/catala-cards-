// Shared setup for the browser tests: local server, Chrome, fresh storage per test,
// fake clock, mocked translation service, stubbed speech.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = ROOT + 'tests/out/';
export const DAY = 864e5;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const freePort = () => new Promise(res => {
  const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});

export async function startServer() {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL, stop() {} };
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return { url, stop: () => proc.kill() };
}

export function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
}

export const TRANSLATIONS = {
  'la tovallola': { es: 'La toalla', en: 'The towel', ar: 'المنشفة' },
  'el paraigua': { es: 'El paraguas', en: 'The umbrella', ar: 'المظلة' },
  default: { es: 'traducción', en: 'translation', ar: 'ترجمة' },
};

// A page in its own fresh browser context (own IndexedDB, own service worker).
export async function newContext(browser) {
  const ctx = await browser.createBrowserContext();
  return ctx;
}

export async function openApp(ctx, url, { days = 0, width = 412, height = 870, translate = 'ok', dark = false } = {}) {
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  page.errors = [];
  page.translateCalls = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.hostname === 'api.mymemory.translated.net') {
      const q = u.searchParams.get('q');
      const lang = u.searchParams.get('langpair').split('|')[1];
      page.translateCalls.push({ q, lang });
      if (page.translateMode === 'fail' || translate === 'fail') return req.abort('internetdisconnected');
      const t = (TRANSLATIONS[q] || TRANSLATIONS.default)[lang];
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ responseData: { translatedText: t }, matches: [] }) });
    }
    req.continue();
  });
  await page.evaluateOnNewDocument(offset => {
    const RD = Date;
    class D extends RD {
      constructor(...a) { if (a.length) super(...a); else super(RD.now() + offset); }
      static now() { return RD.now() + offset; }
    }
    globalThis.Date = D;
    // Speech: record what would be spoken, finish immediately (headless has no voices).
    window.__spoken = [];
    if (window.speechSynthesis) {
      speechSynthesis.speak = u => { window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); setTimeout(() => u.onend && u.onend(), 0); };
      speechSynthesis.cancel = () => {};
    }
  }, days * DAY);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#stats').textContent.length > 0);
  return page;
}

export const text = (page, sel) => page.$eval(sel, e => e.textContent.trim());
export const visible = (page, sel) => page.$eval(sel, e => !e.hidden && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function statsOf(page) {
  return page.$$eval('#stats .stat', els => Object.fromEntries(els.map(e => [e.querySelector('span').textContent, +e.querySelector('b').textContent])));
}

export async function tab(page, view) {
  await page.click(`.tabs [data-view=${view}]`);
}

// The saved state, read straight from IndexedDB.
export function savedState(page) {
  return page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('catala-cards', 1);
    r.onsuccess = () => {
      const g = r.result.transaction('kv').objectStore('kv').get('state');
      g.onsuccess = () => res(g.result || null);
      g.onerror = () => rej(g.error);
    };
    r.onerror = () => rej(r.error);
  }));
}

export async function waitSaved(page, pred, timeout = 3000) {
  const end = Date.now() + timeout;
  let s;
  while (Date.now() < end) {
    s = await savedState(page);
    if (s && pred(s)) return s;
    await sleep(100);
  }
  throw new Error('state not saved as expected: ' + JSON.stringify(s && Object.keys(s.progress || {}).length));
}

// Study n cards with the given rating(s).
export async function studyCards(page, n, rating = 3) {
  for (let i = 0; i < n; i++) {
    if (await visible(page, '#done')) return i;
    await page.click('#showBtn');
    await page.click(`.rate[data-g="${typeof rating === 'function' ? rating(i) : rating}"]`);
  }
  return n;
}

// Study screen: choose Vocabulary or Conjugation.
export async function chooseMode(page, mode) {
  await page.click(`#modeSeg input[value=${mode}]`);
}
