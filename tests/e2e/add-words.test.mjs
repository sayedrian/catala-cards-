import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, launch, newContext, openApp, text, visible, statsOf, savedState, waitSaved, tab, sleep,
} from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); server.stop(); });

const val = (p, name) => p.$eval(`#addForm [name=${name}]`, e => e.value);
async function typeCa(p, word) {
  await p.$eval('#addForm [name=ca]', e => { e.value = ''; });
  await p.type('#addForm [name=ca]', word);
}

test('Translate fills the 3 languages (lowercased), keeps what I typed', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'add');
  await typeCa(p, 'el paraigua');
  await p.type('#addForm [name=en]', 'brolly');
  await p.click('#translateBtn');
  await p.waitForFunction(() => document.querySelector('#trState').textContent.includes('suggestion'));
  assert.equal(await val(p, 'es'), 'el paraguas');
  assert.equal(await val(p, 'en'), 'brolly', 'typed value not overwritten');
  assert.equal(await val(p, 'ar'), 'المظلة');
  assert.deepEqual(p.translateCalls.map(c => c.lang).sort(), ['ar', 'en', 'es']);
  await ctx.close();
});

test('Translate with empty Catalan does nothing; service failure shows a message', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url, { translate: 'fail' });
  await tab(p, 'add');
  await p.click('#translateBtn');
  assert.equal(p.translateCalls.length, 0);
  await typeCa(p, 'la xocolata');
  await p.click('#translateBtn');
  await p.waitForFunction(() => /failed|offline/.test(document.querySelector('#trState').textContent));
  assert.equal(await val(p, 'es'), '');
  await ctx.close();
});

test('save a new word: flagged "not checked", priority, first in the next session', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'add');
  await p.click('#addForm input[value=expr]');
  await typeCa(p, 'la tovallola');
  // "la tovallola" is in the sheet: use a new word instead
  await typeCa(p, 'fer-se un tip de riure');
  await p.click('#translateBtn');
  await p.waitForFunction(() => document.querySelector('#trState').textContent.includes('suggestion'));
  await p.type('#addForm [name=ex]', 'Ens vam fer un tip de riure.');
  await p.click('#addForm button.primary');
  assert.match(await text(p, '#addMsg'), /Saved "fer-se un tip de riure"/);
  assert.equal(await val(p, 'ca'), '', 'form cleared');
  const s = await waitSaved(p, st => Object.keys(st.added).length === 1);
  const it = Object.values(s.added)[0];
  assert.equal(it.type, 'expr');
  assert.equal(it.unchecked, true);
  assert.equal(it.needsTranslation, undefined);
  assert.equal(it.ex, 'Ens vam fer un tip de riure.');
  assert.deepEqual(it.tags, ['src:app']);
  assert.ok(s.priority[it.id]);
  await tab(p, 'study');
  await p.click('#startBtn');
  assert.equal(await text(p, '#card .ca'), 'fer-se un tip de riure');
  assert.match(await text(p, '#card'), /not checked yet/);
  await p.click('#showBtn');
  assert.match(await text(p, '#card'), /Ens vam fer un tip de riure/);
  await p.click('.rate.easy');
  assert.notEqual(await p.$eval('#card', c => c.textContent.includes('fer-se un tip de riure')), true);
  await waitSaved(p, st => Object.keys(st.progress).length === 1);
  await p.close();
  const p2 = await openApp(ctx, server.url, { days: 1 });
  await p2.click('#startBtn');
  assert.match(await text(p2, '#card .kind'), /^\? → Català/, 'next day: the reverse card of my new word comes first');
  await p2.click('#showBtn');
  assert.equal(await text(p2, '#card .ca'), 'fer-se un tip de riure');
  await ctx.close();
});

test('priority words come even when the daily new limit is used up', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'more');
  await p.$eval('#sNew', e => { e.value = '0'; e.dispatchEvent(new Event('change')); });
  await tab(p, 'add');
  await typeCa(p, 'el xiulet');
  await p.click('#translateBtn');
  await p.waitForFunction(() => document.querySelector('#trState').textContent.includes('suggestion'));
  await p.click('#addForm button.primary');
  await tab(p, 'study');
  assert.match(await text(p, '#queueInfo'), /1 new today/);
  await ctx.close();
});

test('duplicate: adding a word that exists marks it priority instead', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'add');
  await typeCa(p, "La Tovallola");    // case and article-insensitive
  await p.click('#addForm button.primary');
  assert.match(await text(p, '#addMsg'), /"la tovallola" is already in your cards/);
  const s = await waitSaved(p, st => Object.keys(st.priority).length === 1);
  assert.equal(Object.keys(s.added).length, 0);
  await tab(p, 'study');
  await p.click('#startBtn');
  assert.equal(await text(p, '#card .ca'), 'la tovallola');
  await ctx.close();
});

test('a verb with the same spelling as a word is not a duplicate', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'add');
  await p.click('#addForm input[value=verb]');
  await typeCa(p, 'la tovallola');
  await p.click('#addForm button.primary');
  assert.match(await text(p, '#addMsg'), /^Saved/);
  await ctx.close();
});

test('offline: saved with "needs translation", translated when back online', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'add');
  await p.setOfflineMode(true);
  p.translateMode = 'fail';
  await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert.equal(await visible(p, '#netState'), true, 'offline badge');
  await typeCa(p, 'el paraigua');
  await p.click('#addForm button.primary');
  assert.match(await text(p, '#addMsg'), /translated when you are online|Translations will be added/);
  let s = await waitSaved(p, st => Object.keys(st.added).length === 1);
  assert.equal(Object.values(s.added)[0].needsTranslation, true);
  await tab(p, 'words');
  await p.select('#statusFilter', 'no translation');
  assert.match(await text(p, '#wordList'), /el paraigua/);
  await p.setOfflineMode(false);
  p.translateMode = 'ok';
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  s = await waitSaved(p, st => !Object.values(st.added)[0].needsTranslation, 5000);
  const it = Object.values(s.added)[0];
  assert.equal(it.es, 'el paraguas');
  assert.equal(it.ar, 'المظلة');
  assert.equal(it.unchecked, true, 'still to be checked by Claude');
  assert.equal(await visible(p, '#netState'), false);
  await ctx.close();
});

test('words: search in Catalan, Spanish, English and Arabic; status filters', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'words');
  assert.match(await text(p, '#listInfo'), /^\d{4} items \(first 300 shown/);
  for (const q of ['tovallola', 'toalla', 'towel', 'منشفة']) {
    await p.$eval('#search', e => { e.value = ''; });
    await p.type('#search', q);
    assert.match(await text(p, '#wordList'), /tovallola/, `search "${q}"`);
  }
  await p.$eval('#search', e => { e.value = ''; e.dispatchEvent(new Event('input')); });
  for (const f of ['new', 'learning', 'learned', 'priority', 'added', 'unchecked', 'no translation']) {
    await p.select('#statusFilter', f);
    const n = +(await text(p, '#listInfo')).split(' ')[0];
    if (f === 'new') assert.ok(n > 1000, f);
    else if (f === 'no translation') assert.ok(n > 100, `${f}: ${n} (the 151 untranslated verbs)`);
    else assert.equal(n, 0, f);
  }
  await ctx.close();
});

test('detail: Listen, Study first, I know it, Edit, Remove', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'words');
  const find = async q => {
    await p.$eval('#search', e => { e.value = ''; });
    await p.type('#search', q);
    await p.click('#wordList li');
    await p.waitForSelector('#detail[open]');
  };
  // Listen + Study first
  await find('tovallola');
  assert.match(await text(p, '#detail'), /toalla/);
  await p.click('#detail [data-a=speak]');
  assert.equal((await p.evaluate(() => window.__spoken))[0].lang, 'ca-ES');
  await p.click('#detail [data-a=priority]');
  assert.equal(await p.$('#detail[open]'), null, 'dialog closed');
  assert.match(await text(p, '#listInfo'), /top of your study queue/);
  assert.match(await text(p, '#wordList'), /★/);
  // I know it → learned
  await find('tovallola');
  await p.click('#detail [data-a=known]');
  assert.match(await text(p, '#wordList'), /learned/);
  let s = await waitSaved(p, st => Object.values(st.progress).length >= 2);
  assert.ok(Object.values(s.progress).every(c => c.ivl === 30 && c.state === 'review'));
  assert.equal(Object.keys(s.priority).length, 0, 'priority cleared');
  await tab(p, 'study');
  assert.equal((await statsOf(p)).learned, 2);
  await tab(p, 'words');
  // Edit a sheet word → stored as an edit
  await find('tovallola');
  await p.click('#detail [data-a=edit]');
  await p.$eval('#detail [name=es]', e => { e.value = 'toalla de baño'; });
  await p.click('#detail button[value=save]');
  s = await waitSaved(p, st => Object.keys(st.edits).length === 1);
  const ed = Object.values(s.edits)[0];
  assert.equal(ed.es, 'toalla de baño');
  assert.equal(ed.unchecked, false, 'box "Translations checked" was ticked');
  assert.match(await text(p, '#wordList'), /toalla de baño/);
  // Edit → Cancel changes nothing
  await find('tovallola');
  await p.click('#detail [data-a=edit]');
  await p.$eval('#detail [name=es]', e => { e.value = 'XXX'; });
  await p.click('#detail button[value=cancel]');
  await sleep(200);
  assert.doesNotMatch(await text(p, '#wordList'), /XXX/);
  // Remove (confirm dialog accepted)
  p.once('dialog', d => d.accept());
  await find('tovallola');
  await p.click('#detail [data-a=remove]');
  assert.match(await text(p, '#listInfo'), /Removed/);
  s = await waitSaved(p, st => st.hidden.length === 1);
  await p.$eval('#search', e => { e.value = 'tovallola'; e.dispatchEvent(new Event('input')); });
  assert.match(await text(p, '#listInfo'), /^0 items/);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

test('detail: edit and remove a word I added', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'add');
  await typeCa(p, 'el paraigua');
  await p.click('#translateBtn');
  await p.waitForFunction(() => document.querySelector('#trState').textContent.includes('suggestion'));
  await p.click('#addForm button.primary');
  await tab(p, 'words');
  await p.select('#statusFilter', 'unchecked');
  assert.match(await text(p, '#wordList'), /el paraigua/);
  await p.click('#wordList li');
  assert.match(await text(p, '#detail'), /not checked yet/);
  await p.click('#detail [data-a=edit]');
  await p.$eval('#detail [name=en]', e => { e.value = 'umbrella'; });
  await p.click('#detail button[value=save]');
  const s = await waitSaved(p, st => Object.values(st.added)[0].en === 'umbrella');
  assert.equal(Object.keys(s.edits).length, 0, 'added words are edited in place');
  p.once('dialog', d => d.accept());
  await p.select('#statusFilter', '');
  await p.$eval('#search', e => { e.value = 'paraigua'; e.dispatchEvent(new Event('input')); });
  await p.click('#wordList li');
  await p.click('#detail [data-a=remove]');
  await waitSaved(p, st => Object.keys(st.added).length === 0);
  await ctx.close();
});

test('conjugation tables in the detail view; rule-made verbs are flagged', async () => {
  const ctx = await newContext(browser);
  const p = await openApp(ctx, server.url);
  await tab(p, 'words');
  await p.type('#search', 'aixecar-se');
  await p.click('#wordList li');
  const d = await text(p, '#detail');
  assert.match(d, /conjugation made by rule/);
  assert.equal(await p.$$eval('#detail details', x => x.length), 8);
  await p.click('#detail details:last-of-type summary');
  assert.match(await text(p, '#detail details:last-of-type'), /aixeca’t/);
  await ctx.close();
});
