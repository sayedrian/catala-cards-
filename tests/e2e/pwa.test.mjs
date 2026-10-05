import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, cpSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { startServer, launch, ROOT, sleep } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); server.stop(); });

const swSource = () => readFileSync(ROOT + 'sw.js', 'utf8');
const shellFiles = () => JSON.parse(swSource().match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));

test('app VERSION and service worker CACHE match (an update reaches the phone)', () => {
  const v = readFileSync(ROOT + 'js/app.js', 'utf8').match(/VERSION = '(v\d+)'/)[1];
  assert.match(swSource(), new RegExp(`const CACHE = 'catala-cards-${v}'`));
});

test('manifest: required fields and icons', async () => {
  const m = JSON.parse(readFileSync(ROOT + 'manifest.webmanifest', 'utf8'));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'theme_color', 'background_color']) assert.ok(m[k], k);
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './', 'relative, so it works under /catala-cards-/ on GitHub Pages');
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  for (const i of m.icons) {
    const png = readFileSync(ROOT + i.src);
    assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), i.sizes, `${i.src} real size`);
  }
});

test('service worker: every SHELL file exists; every app file is in SHELL', () => {
  const shell = shellFiles();
  for (const f of shell) if (f !== './') assert.ok(existsSync(ROOT + f), f);
  const html = readFileSync(ROOT + 'index.html', 'utf8');
  const app = readFileSync(ROOT + 'js/app.js', 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map(m => m[1])
    .concat([...app.matchAll(/from '\.\/([^']+)'/g)].map(m => 'js/' + m[1]));
  for (const r of refs) assert.ok(shell.includes(r), `${r} is used but not cached for offline`);
});

async function plainPage(url, { incognito = true } = {}) {
  const ctx = incognito ? await browser.createBrowserContext() : browser.defaultBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 412, height: 870, isMobile: true, hasTouch: true });
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('requestfailed', r => { if (!r.url().includes('mymemory')) p.errors.push('failed: ' + r.url()); });
  await p.goto(url, { waitUntil: 'networkidle0' });
  await p.evaluate(() => navigator.serviceWorker.ready);
  return { ctx, p };
}

test('service worker installs, caches the app, and the app works offline', async () => {
  const { ctx, p } = await plainPage(server.url);
  const cached = await p.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys[0]);
    return { keys, urls: (await c.keys()).map(r => new URL(r.url).pathname) };
  });
  assert.equal(cached.keys.length, 1);
  assert.equal(cached.urls.length, shellFiles().length);
  await p.reload({ waitUntil: 'networkidle0' });
  assert.ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'page controlled by the SW');
  await p.setOfflineMode(true);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#stats').textContent.length > 0, { timeout: 5000 });
  assert.equal(await p.$eval('#netState', e => e.hidden), false, '"offline" badge shown');
  await p.click('#startBtn');
  await p.click('#showBtn');
  await p.click('.rate.good');
  assert.ok(await p.$eval('#card .ca, #card .trans', e => e.textContent.length > 0), 'can study offline');
  await p.setOfflineMode(false);
  assert.deepEqual(p.errors.filter(e => !e.startsWith('failed:')), []);
  await ctx.close();
});

test('installable: Chrome reports no installability errors', async () => {
  const { p } = await plainPage(server.url, { incognito: false });   // install is never offered in incognito
  const cdp = await p.createCDPSession();
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, []);
  const { url, errors } = await cdp.send('Page.getAppManifest');
  assert.ok(url.endsWith('manifest.webmanifest'));
  assert.deepEqual(errors, []);
  await p.close();
});

test('update: a new CACHE version replaces the old cache', async () => {
  const site = mkdtempSync(tmpdir() + '/catala-site-') + '/';
  cpSync(ROOT, site, { recursive: true, filter: s => !/node_modules|\/tests|\.git/.test(s.slice(ROOT.length - 1)) });
  const port = 18000 + Math.floor(Math.random() * 1000);
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' });
  await sleep(700);
  try {
    const { ctx, p } = await plainPage(`http://127.0.0.1:${port}/`);
    const before = await p.evaluate(() => caches.keys());
    writeFileSync(site + 'sw.js', swSource().replace(/const CACHE = '[^']+'/, "const CACHE = 'catala-cards-test-next'"));
    await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await p.waitForFunction(async () => {
      const k = await caches.keys();
      return k.length === 1 && k[0] === 'catala-cards-test-next';
    }, { timeout: 10000, polling: 200 });
    assert.notDeepEqual(before, ['catala-cards-test-next']);
    await ctx.close();
  } finally {
    proc.kill();
    rmSync(site, { recursive: true, force: true });
  }
});
