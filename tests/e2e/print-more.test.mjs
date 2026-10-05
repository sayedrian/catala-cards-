import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  startServer, launch, newContext, openApp, text, statsOf, savedState, waitSaved, studyCards, tab, OUT, sleep,
} from './helpers.mjs';

let server, browser;
before(async () => { mkdirSync(OUT, { recursive: true }); server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); server.stop(); });

async function doPrint(p, { which = 'weak', tag = '', count = 20 } = {}) {
  await tab(p, 'print');
  await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await p.select('#pWhich', which);
  await p.select('#pTag', tag);
  await p.$eval('#pCount', (e, v) => { e.value = v; }, String(count));
  await p.click('#printBtn');
}

const pdfPages = buf => +((Buffer.from(buf).toString('latin1').match(/\/Count (\d+)/) || [])[1] || 0);

test('print weakest: sheets, mirrored back pages, PDF page count', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await doPrint(p, { count: 23 });
  assert.equal(await p.evaluate(() => window.__printed), 1);
  assert.equal(await text(p, '#printInfo'), '23 cards on 3 sheet(s), 6 pages.');
  assert.equal(await p.$$eval('#printArea .sheet', s => s.length), 6);
  // each back cell lines up with its front when flipped on the long edge
  const pairs = await p.evaluate(async () => {
    const deck = await (await fetch('data/cards.json')).json();
    const es = Object.fromEntries(deck.items.map(i => [i.ca, i.es || '']));
    const sheets = [...document.querySelectorAll('#printArea .sheet')];
    const out = [];
    for (let s = 0; s < sheets.length; s += 2) {
      const f = [...sheets[s].children], b = [...sheets[s + 1].children];
      for (let r = 0; r < 5; r++) for (const col of [0, 1]) {
        const front = f[r * 2 + col].querySelector('.ca');
        const back = b[r * 2 + (1 - col)].querySelector('.tr');
        if (front) out.push([es[front.textContent], back ? back.textContent : null]);
      }
    }
    return out;
  });
  assert.equal(pairs.length, 23);
  for (const [want, got] of pairs) assert.equal(got, want);
  await p.emulateMediaType('print');
  const pdf = await p.pdf({ format: 'A4', printBackground: true });
  writeFileSync(OUT + 'print-weakest.pdf', pdf);
  assert.equal(pdfPages(pdf), 6, 'A4: 2 pages per sheet of 10 cards');
  await p.emulateMediaType('screen');
  await ctx.close();
});

test('print weakest picks studied weak cards first; topic mode; empty topic', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await p.select('#fDeck', 'words');
  await p.click('#startBtn');
  const firstWord = await text(p, '#card .ca');
  await p.click('#showBtn'); await p.click('.rate.again');      // weak
  await studyCards(p, 30, 4);
  await doPrint(p, { count: 10 });
  const fronts = await p.$$eval('#printArea .sheet:first-child .ca', e => e.map(x => x.textContent));
  assert.equal(fronts[0], firstWord, 'the card I failed is printed first');
  await doPrint(p, { which: 'topic', tag: 'exam:Salut', count: 200 });
  const n = await p.evaluate(async () => (await (await fetch('data/cards.json')).json()).items
    .filter(i => (i.tags || []).includes('exam:Salut') && (i.es || i.en || i.ar)).length);
  assert.match(await text(p, '#printInfo'), new RegExp(`^${n} cards`));
  await doPrint(p, { which: 'topic', tag: 'src:app', count: 20 });
  assert.equal(await text(p, '#printInfo'), 'No cards match.');
  await ctx.close();
});

test('settings: tenses change the conjugation deck; new/day and voice speed are saved', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'more');
  const checked = await p.$$eval('#sTenses input:checked', e => e.map(x => x.value));
  assert.deepEqual(checked, ['present', 'perfet', 'perifrastic']);
  await p.click('#sTenses input[value=futur]');
  await p.click('#sTenses input[value=present]');
  await p.$eval('#sNew', e => { e.value = '5'; e.dispatchEvent(new Event('change')); });
  await p.$eval('#sRate', e => { e.value = '0.7'; e.dispatchEvent(new Event('change')); });
  const s = await waitSaved(p, st => st.settings.newPerDay === 5 && st.settings.rate === 0.7);
  assert.deepEqual(s.settings.tenses.sort(), ['futur', 'perfet', 'perifrastic']);
  await p.click('#testVoice');
  assert.equal((await p.evaluate(() => window.__spoken))[0].text, 'Bon dia, com estàs?');
  await tab(p, 'study');
  await p.select('#fDeck', 'conj');
  assert.match(await text(p, '#queueInfo'), /5 new today \(0\/5/);
  await p.click('#startBtn');
  const tenses = new Set();
  for (let i = 0; i < 5; i++) {
    tenses.add((await text(p, '#card .meta')).split(' · ')[0]);
    await p.click('#showBtn'); await p.click('.rate.easy');
  }
  assert.ok(!tenses.has('Present'), 'present switched off');
  assert.ok([...tenses].every(t => ['Futur', 'Perfet', 'Passat perifràstic'].includes(t)), [...tenses].join());
  await p.reload({ waitUntil: 'networkidle0' });
  await tab(p, 'more');
  assert.equal(await p.$eval('#sNew', e => e.value), '5');
  assert.equal(await p.$eval('#sRate', e => e.value), '0.7');
  assert.match(await text(p, '#about'), /1293 items/);
  await ctx.close();
});

async function exportBackup(p) {
  await tab(p, 'more');
  await p.evaluate(() => { HTMLAnchorElement.prototype.click = function () { window.__dl = { href: this.href, name: this.download }; }; });
  await p.click('#exportBtn');
  return p.evaluate(async () => ({ name: window.__dl.name, json: await (await fetch(window.__dl.href)).text() }));
}

async function importFile(p, path) {
  await tab(p, 'more');
  await p.$eval('#backupMsg', e => { e.textContent = ''; });
  const input = await p.$('#importFile');
  await input.uploadFile(path);
  await p.waitForFunction(() => /loaded|Could not/.test(document.querySelector('#backupMsg').textContent));
  return text(p, '#backupMsg');
}

test('backup: export file, import merges (newer wins, nothing lost)', async () => {
  // Phone A: study 3 cards, add a word
  const ctxA = await newContext(browser);
  const a = await openApp(ctxA, server.url);
  await a.click('#startBtn');
  await studyCards(a, 3, 4);
  await a.click('#endBtn');
  await tab(a, 'add');
  await a.type('#addForm [name=ca]', 'el paraigua');
  await a.type('#addForm [name=es]', 'paraguas');
  await a.click('#addForm button.primary');
  await waitSaved(a, st => Object.keys(st.added).length === 1);
  const { name, json } = await exportBackup(a);
  assert.match(name, /^catala-cards-backup-\d{4}-\d\d-\d\d\.json$/);
  const data = JSON.parse(json);
  assert.equal(data.app, 'catala-cards');
  assert.equal(Object.keys(data.state.progress).length, 3);
  assert.equal(Object.keys(data.state.added).length, 1);
  writeFileSync(OUT + 'backup-a.json', json);

  // Phone B: own progress on a different card, then load A's backup
  const ctxB = await newContext(browser);
  const b = await openApp(ctxB, server.url);
  await b.select('#fDeck', 'conj');
  await b.click('#startBtn');
  await studyCards(b, 1, 4);
  await b.click('#endBtn');
  const bBefore = await waitSaved(b, st => Object.keys(st.progress).length === 1);
  const msg = await importFile(b, OUT + 'backup-a.json');
  assert.match(msg, /Backup loaded: \d+ changes merged/);
  const s = await savedState(b);
  const union = new Set([...Object.keys(data.state.progress), ...Object.keys(bBefore.progress)]);
  assert.equal(Object.keys(s.progress).length, union.size, 'cards from A + my own, none lost');
  for (const [id, pb] of Object.entries(bBefore.progress)) {
    assert.ok(s.progress[id].last >= pb.last, 'my newer answer is kept');
  }
  assert.equal(Object.keys(s.added).length, 1);
  await tab(b, 'study');
  assert.equal((await statsOf(b)).learning, union.size);
  await tab(b, 'words');
  await b.type('#search', 'paraigua');
  assert.match(await text(b, '#wordList'), /el paraigua/, 'added word visible right after import');

  // Older copy of a card does not overwrite a newer one
  const old = JSON.parse(json);
  const id = Object.keys(old.state.progress)[0];
  old.state.progress[id] = { ...old.state.progress[id], last: 1, ivl: 99 };
  writeFileSync(OUT + 'backup-old.json', JSON.stringify(old));
  await importFile(b, OUT + 'backup-old.json');
  assert.notEqual((await savedState(b)).progress[id].ivl, 99);
  await ctxA.close(); await ctxB.close();
});

test('backup: a wrong file shows an error and changes nothing', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  writeFileSync(OUT + 'not-json.json', 'hello');
  writeFileSync(OUT + 'other-app.json', JSON.stringify({ app: 'anki', state: {} }));
  assert.match(await importFile(p, OUT + 'not-json.json'), /^Could not load/);
  assert.match(await importFile(p, OUT + 'other-app.json'), /not a Català Cards backup/);
  assert.equal(await savedState(p), null);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});
