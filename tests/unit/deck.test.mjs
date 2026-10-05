import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildItems, cardsFor, matchesFilter, buildQueue, stats, itemStatus, weakest, deckOf, prioritize,
} from '../../js/deck.js';
import { review } from '../../js/fsrs.js';
import { emptyState } from '../../js/store.js';

const DAY = 864e5;
const T0 = Date.parse('2026-10-05T09:00:00');
const realDeck = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url)));

const W = (id, ca, extra = {}) => ({ id, type: 'word', ca, es: 'es-' + ca, en: 'en-' + ca, ar: 'ar', ...extra });
const mini = () => ({
  units: {},
  items: [
    W('w1', 'la casa', { unit: 'U03', tags: ['src:vocab'] }),
    W('w2', 'el gos', { unit: 'U01', tags: ['cpnl:U2'] }),
    W('w3', 'la pluja', { unit: 'U09', tags: ['exam:Viatges i clima'] }),
    W('w4', 'la taula', { unit: 'U01', tags: ['cpnl:U1'] }),
    { id: 'v1', type: 'verb', ca: 'parlar', es: 'hablar', conj: { present: ['parlo', 'parles', 'parla', 'parlem', 'parleu', 'parlen'], futur: ['a', 'b', 'c', 'd', 'e', 'f'], imperatiu: ['parla', 'parli', 'parlem', 'parleu', 'parlin'] } },
    { id: 'v2', type: 'verb', ca: 'cosir', conj: { present: ['cuso', 'cuses', 'cus', 'cosim', 'cosiu', 'cusen'] } },
    { id: 'e1', type: 'expr', ca: 'fa sol', en: "it's sunny", tags: ['others:expressions i altres'] },
  ],
});
const st = () => { const s = emptyState(); s.daily = { date: '2026-10-05', newSeen: 0 }; return s; };

test('buildItems: edits, hidden and added items', () => {
  const s = st();
  s.edits.w1 = { es: 'casa!' };
  s.hidden.push('w2');
  s.added.u1 = W('u1', 'el paraigua', { tags: ['src:app'] });
  const items = buildItems(mini(), s);
  const ids = items.map(i => i.id);
  assert.ok(!ids.includes('w2'));
  assert.ok(ids.includes('u1'));
  assert.equal(items.find(i => i.id === 'w1').es, 'casa!');
  assert.equal(mini().items[0].es, 'es-la casa', 'source deck not mutated');
});

test('cardsFor: meaning cards need a translation; conjugation cards follow chosen tenses', () => {
  const [, , , , v1, v2, e1] = mini().items;
  assert.deepEqual(cardsFor(v1, ['present', 'perfet']).map(c => c.id), ['v1|f', 'v1|r', 'v1|c|present']);
  assert.deepEqual(cardsFor(v1, ['present', 'futur', 'imperatiu']).map(c => c.kind), ['f', 'r', 'c', 'c', 'c']);
  assert.deepEqual(cardsFor(v2, ['present']).map(c => c.id), ['v2|c|present'], 'no translation → only conjugation');
  assert.deepEqual(cardsFor(e1, []).map(c => c.kind), ['f', 'r']);
  assert.deepEqual(cardsFor({ id: 'x', type: 'word', ca: 'x' }, []), []);
});

test('deckOf + matchesFilter for every deck and tag kind', () => {
  const items = mini().items;
  const c = (id, kind = 'f') => ({ id, kind, item: items.find(i => i.id === id) });
  assert.equal(deckOf(items[0]), 'words');
  assert.equal(deckOf(items[4]), 'verbs');
  assert.equal(deckOf(items[6]), 'expr');
  const f = (deck, tag = '') => ({ deck, tag });
  assert.ok(matchesFilter(c('w1'), f('all')));
  assert.ok(matchesFilter(c('v1', 'c'), f('all')));
  assert.ok(matchesFilter(c('w1'), f('words')));
  assert.ok(!matchesFilter(c('v1'), f('words')));
  assert.ok(matchesFilter(c('v1'), f('verbs')));
  assert.ok(!matchesFilter(c('v1', 'c'), f('verbs')), 'conjugation cards only in the conj deck');
  assert.ok(matchesFilter(c('v1', 'c'), f('conj')));
  assert.ok(!matchesFilter(c('v1'), f('conj')));
  assert.ok(matchesFilter(c('e1'), f('expr')));
  assert.ok(matchesFilter(c('w2'), f('all', 'cpnl:U2')));
  assert.ok(!matchesFilter(c('w1'), f('all', 'cpnl:U2')));
  assert.ok(matchesFilter(c('w3'), f('all', 'exam:Viatges i clima')));
  assert.ok(matchesFilter(c('w1'), f('all', 'U03')), 'sheet unit');
  assert.ok(matchesFilter(c('e1'), f('all', 'others:expressions i altres')));
});

test('buildQueue: new-card order = priority, CPNL (U1 before U2), exam, unit', () => {
  const s = st();
  s.added.u1 = W('u1', 'el paraigua', { tags: ['src:app'] });
  s.priority.u1 = T0;
  const q = buildQueue(buildItems(mini(), s), s, { deck: 'words', tag: '' }, T0);
  assert.deepEqual(q.fresh.map(c => c.id), ['u1|f', 'w4|f', 'w2|f', 'w3|f', 'w1|f'], 'no "? → Català" cards yet');
});

test('buildQueue: "? → Català" unlocks after "Català → ?" is learned once, and comes before new words', () => {
  const s = st();
  const items = buildItems(mini(), s);
  s.progress['w1|f'] = review(undefined, 3, T0);                      // still in learning
  assert.ok(!buildQueue(items, s, { deck: 'words', tag: '' }, T0).fresh.some(c => c.id === 'w1|r'));
  s.progress['w1|f'] = review(s.progress['w1|f'], 3, T0 + 6e5);       // passed → review
  const q = buildQueue(items, s, { deck: 'words', tag: '' }, T0 + DAY);
  assert.equal(q.fresh[0].id, 'w1|r');
  assert.deepEqual(q.fresh.slice(1).map(c => c.id), ['w4|f', 'w2|f', 'w3|f']);
});

test('buildQueue: daily new limit, newSeen, priority goes past the limit', () => {
  const s = st();
  s.settings.newPerDay = 3;
  const items = buildItems(mini(), s);
  assert.equal(buildQueue(items, s, { deck: 'all', tag: '' }, T0).fresh.length, 3);
  s.daily.newSeen = 3;
  assert.equal(buildQueue(items, s, { deck: 'all', tag: '' }, T0).fresh.length, 0);
  s.priority.w1 = T0;
  const q = buildQueue(items, s, { deck: 'all', tag: '' }, T0);
  assert.deepEqual(q.fresh.map(c => c.id), ['w1|f']);
});

test('buildQueue: due cards weakest first; future cards not due', () => {
  const s = st();
  const items = buildItems(mini(), s);
  // w1 seen long ago (weak), w2 seen recently, w3 not due yet
  let a = review(review(undefined, 3, T0 - 40 * DAY), 3, T0 - 40 * DAY);
  let b = review(review(undefined, 3, T0 - 5 * DAY), 3, T0 - 5 * DAY);
  s.progress['w1|f'] = a; s.progress['w2|f'] = b;
  s.progress['w3|f'] = { ...b, due: T0 + 5 * DAY };
  const q = buildQueue(items, s, { deck: 'words', tag: '' }, T0);
  assert.deepEqual(q.due.map(c => c.id), ['w1|f', 'w2|f']);
});

test('prioritize: seen cards become due now, once; unseen ones jump the new queue', () => {
  const s = st();
  const items = buildItems(mini(), s);
  const w1 = items.find(i => i.id === 'w1');
  s.progress['w1|f'] = { state: 'review', ivl: 30, s: 30, d: 5, last: T0, due: T0 + 30 * DAY, reps: 3, lapses: 0 };
  assert.equal(buildQueue(items, s, { deck: 'words', tag: '' }, T0 + DAY).due.length, 0);
  prioritize(w1, s, T0 + DAY);
  const q = buildQueue(items, s, { deck: 'words', tag: '' }, T0 + DAY);
  assert.deepEqual(q.due.map(c => c.id), ['w1|f']);
  assert.equal(q.fresh[0].id, 'w1|r', 'its reverse card (unlocked, priority) is the first new card');
  s.progress['w1|f'] = review(s.progress['w1|f'], 3, T0 + DAY);
  assert.equal(buildQueue(items, s, { deck: 'words', tag: '' }, T0 + 2 * DAY).due.length, 0, 'answered → normal schedule again');
});

test('stats and itemStatus', () => {
  const s = st();
  const items = buildItems(mini(), s);
  const total = items.reduce((n, it) => n + cardsFor(it, s.settings.tenses).length, 0);
  assert.deepEqual(stats(items, s, T0), { total, learned: 0, learning: 0, due: 0, unseen: total });
  const w1 = items.find(i => i.id === 'w1');
  assert.equal(itemStatus(w1, s), 'new');
  s.progress['w1|f'] = review(undefined, 3, T0);
  assert.equal(itemStatus(w1, s), 'learning');
  const learned = { state: 'review', ivl: 30, s: 30, d: 5, last: T0, due: T0 + 30 * DAY, reps: 3, lapses: 0 };
  s.progress['w1|f'] = learned; s.progress['w1|r'] = learned;
  assert.equal(itemStatus(w1, s), 'learned');
  assert.equal(itemStatus(items.find(i => i.id === 'v2'), s), 'no translation');
  const st2 = stats(items, s, T0 + DAY);
  assert.equal(st2.learned, 2);
  assert.equal(st2.unseen, total - 2);
});

test('weakest: learned excluded, lapses and low recall come first, then priority, then new', () => {
  const s = st();
  const items = buildItems(mini(), s);
  const learned = { state: 'review', ivl: 30, s: 30, d: 5, last: T0, due: T0 + 30 * DAY, reps: 3, lapses: 0 };
  s.progress['w1|f'] = learned; s.progress['w1|r'] = learned;
  s.progress['w2|f'] = { state: 'review', ivl: 3, s: 3, d: 7, last: T0 - 20 * DAY, due: T0 - 17 * DAY, reps: 5, lapses: 3 };
  s.progress['w3|f'] = { state: 'review', ivl: 10, s: 10, d: 5, last: T0 - DAY, due: T0 + 9 * DAY, reps: 2, lapses: 0 };
  s.priority.w4 = T0;
  const w = weakest(items, s, 10, null, T0).map(i => i.id);
  assert.ok(!w.includes('w1'), 'learned excluded');
  assert.ok(!w.includes('v2'), 'no translation excluded');
  assert.deepEqual(w.slice(0, 3), ['w2', 'w4', 'w3'], 'lapsed card, then unstudied priority word, then a card recalled yesterday');
  assert.equal(weakest(items, s, 2, null, T0).length, 2);
  assert.deepEqual(weakest(items, s, 10, { deck: 'all', tag: 'cpnl:U2' }, T0).map(i => i.id), ['w2']);
});

test('real deck: queue and stats run fast on ~2,900 cards and on a 3× deck', () => {
  const s = st();
  const items = buildItems(realDeck, s);
  let t = performance.now();
  const q = buildQueue(items, s, { deck: 'all', tag: '' }, T0);
  const st1 = stats(items, s, T0);
  const ms1 = performance.now() - t;
  assert.equal(q.fresh.length, 15);
  assert.ok(st1.total > 2500, String(st1.total));
  const big = { ...realDeck, items: [0, 1, 2].flatMap(k => realDeck.items.map(i => ({ ...i, id: i.id + k }))) };
  const bigItems = buildItems(big, s);
  t = performance.now();
  buildQueue(bigItems, s, { deck: 'all', tag: '' }, T0);
  stats(bigItems, s, T0);
  const ms3 = performance.now() - t;
  console.log(`  perf: real deck ${ms1.toFixed(1)} ms, 3× deck ${ms3.toFixed(1)} ms`);
  assert.ok(ms3 < 500, `3× deck took ${ms3} ms`);
});
