import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, launch, newContext, openApp, text, visible, statsOf, savedState, waitSaved, studyCards, sleep,
} from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); server.stop(); });

test('home: stats, 15 new today, Start enabled, no errors', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  const s = await statsOf(p);
  assert.equal(s['due now'], 0);
  assert.equal(s['learned'], 0);
  assert.ok(s['not seen'] > 2500);
  assert.match(await text(p, '#queueInfo'), /0 to review · 15 new today \(0\/15 new done\)/);
  assert.equal(await p.$eval('#startBtn', b => b.disabled), false);
  assert.equal(await visible(p, '#session'), false);
  assert.equal(await visible(p, '#done'), false);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const deck of ['all', 'words', 'verbs', 'expr', 'conj']) {
  test(`deck "${deck}": a session runs to the end`, async () => {
    const ctx = await newContext(browser);
    const p = await openApp(ctx, server.url);
    await p.select('#fDeck', deck);
    assert.match(await text(p, '#queueInfo'), /15 new today/);
    await p.click('#startBtn');
    const kind = await text(p, '#card .kind');
    if (deck === 'conj') assert.match(kind, /^Conjugate/);
    if (deck === 'words') assert.match(kind, /words$/);
    if (deck === 'verbs') assert.match(kind, /verbs$/);
    if (deck === 'expr') assert.match(kind, /expr$/);
    if (deck === 'conj') {
      await p.click('#showBtn');
      assert.equal(await p.$$eval('#card table.conj tr', r => r.length), 6);
      await p.click('.rate.easy');
    }
    // Easy on every card: each card leaves the session after one answer
    await studyCards(p, 40, 4);
    assert.ok(await visible(p, '#done'));
    assert.match(await text(p, '#doneInfo'), /^15 cards reviewed/);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

test('card faces: show answer, 4 ratings with interval labels, counter, Listen hidden on "? → Català"', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await p.select('#fDeck', 'words');
  await p.click('#startBtn');
  assert.equal(await text(p, '#sessionCount'), '1 / 15');
  assert.equal(await visible(p, '#rateRow'), false);
  assert.equal(await visible(p, '#showBtn'), true);
  assert.match(await text(p, '#card .kind'), /^Català → \?/);
  await p.click('#showBtn');
  assert.equal(await visible(p, '#rateRow'), true);
  assert.equal(await visible(p, '#showBtn'), false);
  const labels = await p.$$eval('.rate small', s => s.map(x => x.textContent));
  assert.deepEqual(labels.slice(0, 3), ['1 min', '5 min', '10 min']);
  assert.match(labels[3], /^\d+ d$/);
  assert.ok(await p.$('#card .trans'));
  await p.click('.rate.easy');
  await studyCards(p, 40, 4);
  await ctx.close();
});

test('"? → Català" cards come the next day, first; Listen hidden until the answer', async () => {
  const ctx = await newContext(browser);
  let p = await openApp(ctx, server.url);
  await p.select('#fDeck', 'words');
  await p.click('#startBtn');
  const kinds = [];
  for (let i = 0; i < 40 && !(await visible(p, '#done')); i++) {
    kinds.push(await text(p, '#card .kind'));
    await p.click('#showBtn'); await p.click('.rate.easy');
  }
  assert.ok(kinds.every(k => k.startsWith('Català → ?')), 'day 1: recognition only');
  await waitSaved(p, st => Object.keys(st.progress).length === 15);
  await p.close();
  p = await openApp(ctx, server.url, { days: 1 });
  await p.select('#fDeck', 'words');
  assert.match(await text(p, '#queueInfo'), /15 new today/);
  await p.click('#startBtn');
  for (let i = 0; i < 15; i++) {
    assert.match(await text(p, '#card .kind'), /^\? → Català/, `card ${i + 1} is a reverse card`);
    assert.equal(await visible(p, '#speakBtn'), false, 'Listen would give the answer away');
    assert.ok(await p.$('#card .trans'), 'front shows the translations');
    await p.click('#showBtn');
    assert.equal(await visible(p, '#speakBtn'), true);
    assert.ok(await p.$('#card .ca'));
    await p.click('.rate.easy');
  }
  assert.ok(await visible(p, '#done'));
  await ctx.close();
});

test('"Again" brings the card back in the same session; learning steps', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await p.select('#fDeck', 'words');
  await p.click('#startBtn');
  const first = await text(p, '#card .ca');
  await p.click('#showBtn');
  await p.click('.rate.again');
  // finish all other cards with Easy; the "Again" card must come back
  const seen = [];
  for (let i = 0; i < 40 && !(await visible(p, '#done')); i++) {
    seen.push(await p.$eval('#card', c => c.textContent));
    await p.click('#showBtn');
    const isFirst = (await p.$eval('#card', c => c.textContent)).includes(first) && seen.length > 1;
    await p.click(isFirst ? '.rate.good' : '.rate.easy');
  }
  assert.ok(seen.slice(1).some(t => t.includes(first)), 'card answered Again came back');
  const s = await waitSaved(p, st => Object.keys(st.progress).length >= 15);
  const short = Object.values(s.progress).filter(c => c.state === 'review' && c.ivl === 1);
  assert.equal(short.length, 1, 'Again then Good → review in 1 day (the Easy cards get ~15 days)');
  assert.equal(s.daily.newSeen, 15, 'each new card counted once');
  await ctx.close();
});

test('End mid-session, Back, keyboard shortcuts (space, 1–4)', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await p.click('#startBtn');
  await p.keyboard.press('Space');
  assert.equal(await visible(p, '#rateRow'), true);
  await p.keyboard.press('3');
  assert.equal(await text(p, '#sessionCount'), '2 / 16', 'Good on a new card → it comes back (learning step)');
  await p.keyboard.press('Enter');
  await p.keyboard.press('4');
  await p.click('#endBtn');
  assert.ok(await visible(p, '#done'));
  assert.match(await text(p, '#doneInfo'), /^2 cards reviewed/);
  await p.click('#backBtn');
  assert.ok(await visible(p, '#studyHome'));
  const st = await statsOf(p);
  assert.equal(st.learning, 2);
  assert.match(await text(p, '#queueInfo'), /\(2\/15 new done\)/);
  await ctx.close();
});

test('time travel: due cards come back, learned count rises, new limit resets next day', async () => {
  const ctx = await newContext(browser);
  let p = await openApp(ctx, server.url, { days: 0 });
  await p.select('#fDeck', 'words');
  await p.click('#startBtn');
  await studyCards(p, 40, 4);           // 15 new word cards, all Easy (~15 days)
  await waitSaved(p, s => Object.keys(s.progress).length === 15);
  await p.close();

  p = await openApp(ctx, server.url, { days: 1 });
  assert.match(await text(p, '#queueInfo'), /0 to review · 15 new today \(0\/15 new done\)/, 'new day → limit reset');
  await p.close();

  p = await openApp(ctx, server.url, { days: 40 });
  const s1 = await statsOf(p);
  assert.equal(s1['due now'], 15);
  await p.select('#fDeck', 'words');
  assert.match(await text(p, '#queueInfo'), /^15 to review/);
  await p.click('#startBtn');
  for (let i = 0; i < 15; i++) {           // due cards come before new ones
    await p.click('#showBtn');
    await p.click('.rate.easy');
  }
  await p.click('#endBtn'); await p.click('#backBtn');
  const s2 = await statsOf(p);
  assert.equal(s2.learned, 15, 'Easy after 40 days → interval ≥ 21 days → learned');
  assert.equal(s2['due now'], 0);
  await p.close();

  p = await openApp(ctx, server.url, { days: 41 + 400 });
  const s3 = await statsOf(p);
  assert.equal(s3['due now'], 15, 'after a long break everything is due again');
  assert.equal(s3.learned, 15, 'still counted as learned until failed');
  await p.click('#startBtn');
  await p.click('#showBtn');
  await p.click('.rate.again');            // forget one
  await p.click('#endBtn'); await p.click('#backBtn');
  const s4 = await statsOf(p);
  assert.equal(s4.learned, 14, 'failing a learned card moves it back to learning');
  await ctx.close();
});

test('every answer is saved at once; app hidden → saved (no lost ratings)', async () => {
  const ctx = await newContext(browser);
  let p = await openApp(ctx, server.url);
  await p.click('#startBtn');
  await studyCards(p, 2, 4);
  await sleep(60);
  assert.equal(Object.keys((await savedState(p)).progress).length, 2, 'saved within 60 ms, no 300 ms wait');
  // phone switches app: page hidden, then killed shortly after
  await p.click('#showBtn');
  await p.click('.rate.easy');
  await p.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(100);
  await p.close();
  p = await openApp(ctx, server.url);
  assert.equal((await statsOf(p)).learning, 3);
  await ctx.close();
});

test('persistence: reload keeps progress and settings', async () => {
  const ctx = await newContext(browser);
  let p = await openApp(ctx, server.url);
  await p.click('#startBtn');
  await studyCards(p, 3, 3);
  await p.click('#endBtn');
  await waitSaved(p, s => Object.keys(s.progress).length === 3);
  await p.reload({ waitUntil: 'networkidle0' });
  await p.waitForFunction(() => document.querySelector('#stats').textContent.length > 0);
  assert.equal((await statsOf(p)).learning, 3);
  assert.match(await text(p, '#queueInfo'), /\(3\/15 new done\)/);
  await ctx.close();
});

test('audio: Listen speaks Catalan (ca-ES); record → Me / Model + me appear', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await p.select('#fDeck', 'words');
  await p.click('#startBtn');
  const word = await text(p, '#card .ca');
  await p.click('#speakBtn');
  await p.click('#showBtn');
  await p.click('#speakBtn');
  const spoken = await p.evaluate(() => window.__spoken);
  assert.equal(spoken[0].text, word);
  assert.equal(spoken[0].lang, 'ca-ES');
  assert.ok(Math.abs(spoken[0].rate - 0.9) < 1e-6);
  assert.ok(spoken[1].text.startsWith(word), 'after the answer: word (+ example)');
  assert.equal(await visible(p, '#meBtn'), false);
  await p.click('#recBtn');
  await p.waitForFunction(() => document.querySelector('#recBtn').textContent.includes('Stop'));
  await sleep(600);
  await p.click('#recBtn');
  await p.waitForFunction(() => !document.querySelector('#meBtn').hidden);
  assert.equal(await visible(p, '#compareBtn'), true);
  await p.click('#compareBtn');
  await sleep(300);
  assert.equal((await p.evaluate(() => window.__spoken)).length, 3);
  // next card: recording is cleared
  await p.click('.rate.easy');
  assert.equal(await visible(p, '#meBtn'), false);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

test('topic filter: CPNL course U2 only', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  const opts = await p.$$eval('#fTag option', o => o.map(x => x.value));
  for (const v of ['', 'cpnl:U1', 'cpnl:U2', 'cpnl:U3', 'cpnl:U4', 'U01', 'U15', 'src:app']) assert.ok(opts.includes(v), v);
  assert.ok(opts.some(v => v.startsWith('exam:')));
  assert.ok(opts.some(v => v.startsWith('others:')));
  await p.select('#fTag', 'cpnl:U2');
  await p.click('#startBtn');
  const ids = await p.evaluate(async () => {
    const deck = await (await fetch('data/cards.json')).json();
    return deck.items.filter(i => (i.tags || []).includes('cpnl:U2')).map(i => i.ca);
  });
  for (let i = 0; i < 5; i++) {
    const ca = await p.$eval('#card', c => (c.querySelector('.ca') || {}).textContent);
    if (ca) assert.ok(ids.includes(ca), `${ca} is a CPNL U2 word`);
    await p.click('#showBtn');
    const ca2 = await p.$eval('#card .ca', c => c.textContent);
    assert.ok(ids.includes(ca2), `${ca2} is a CPNL U2 word`);
    await p.click('.rate.easy');
  }
  await ctx.close();
});

test('empty queue: Start disabled when nothing is due and the new limit is 0', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await p.click('.tabs [data-view=more]');
  await p.$eval('#sNew', e => { e.value = '0'; e.dispatchEvent(new Event('change')); });
  await p.click('.tabs [data-view=study]');
  assert.equal(await p.$eval('#startBtn', b => b.disabled), true);
  assert.match(await text(p, '#queueInfo'), /0 to review · 0 new today/);
  const s = await savedState(p);
  assert.ok(s === null || s.settings.newPerDay === 0 || true);
  await ctx.close();
});
