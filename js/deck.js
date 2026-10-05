// Items (words, verbs, expressions) -> cards, and the daily study queue.
import { retrievability, isLearned } from './fsrs.js';

export const TENSE_LABELS = {
  present: 'Present', perfet: 'Perfet', imperfet: 'Imperfet', perifrastic: 'Passat perifràstic',
  futur: 'Futur', condicional: 'Condicional', subjuntiu: 'Present de subjuntiu', imperatiu: 'Imperatiu',
};
const TENSE_ORDER = Object.keys(TENSE_LABELS);
export const PERSONS = ['jo', 'tu', 'ell / ella / vostè', 'nosaltres', 'vosaltres', 'ells / elles / vostès'];
export const IMP_PERSONS = ['(tu)', '(vostè)', '(nosaltres)', '(vosaltres)', '(vostès)'];

export const hasMeaning = it => !!(it.es || it.en || it.ar);

// Merge the sheet deck with my additions, edits and removals.
export function buildItems(deck, state) {
  const hidden = new Set(state.hidden);
  const items = deck.items
    .filter(it => !hidden.has(it.id))
    .map(it => (state.edits[it.id] ? { ...it, ...state.edits[it.id] } : it));
  return items.concat(Object.values(state.added));
}

// Every item gives 2 meaning cards (Catalan -> translations, translations -> Catalan);
// verbs also give one conjugation-table card per chosen tense.
export function cardsFor(it, tenses) {
  const out = [];
  if (hasMeaning(it)) {
    out.push({ id: it.id + '|f', item: it, kind: 'f' });
    out.push({ id: it.id + '|r', item: it, kind: 'r' });
  }
  if (it.conj) {
    for (const t of tenses) if (it.conj[t]) out.push({ id: `${it.id}|c|${t}`, item: it, kind: 'c', tense: t });
  }
  return out;
}

export function deckOf(it) {
  return it.type === 'verb' ? 'verbs' : it.type === 'expr' ? 'expr' : 'words';
}

// Two study modes: vocabulary (deck 'all' / 'words' / 'verbs' / 'expr') and conjugation ('conj').
// They never mix: conjugation cards only appear in the 'conj' deck.
export function matchesFilter(card, f) {
  const it = card.item;
  if ((f.deck === 'conj') !== (card.kind === 'c')) return false;
  if (f.deck !== 'all' && f.deck !== 'conj' && deckOf(it) !== f.deck) return false;
  if (f.tag && !(it.tags || []).includes(f.tag) && it.unit !== f.tag) return false;
  return true;
}

function newRank(it, state) {
  // Lower = sooner. Priority words first (newest first), then CPNL course words,
  // then exam-focus words, then by sheet unit.
  const p = state.priority[it.id];
  if (p) return -p;
  const tags = it.tags || [];
  const cp = tags.find(t => t.startsWith('cpnl:'));
  if (cp) return 1e3 + Number(cp.slice(6));
  if (tags.some(t => t.startsWith('exam:'))) return 2e3;
  return 3e3 + (parseInt((it.unit || 'U99').slice(1), 10) || 99);
}

// Builds today's session: due cards (weakest first), then new cards up to the daily limit.
// Each item's "? → Català" card only comes after its "Català → ?" card has been learned once.
export function buildQueue(items, state, filter, now = Date.now()) {
  const due = [], fresh = [];
  for (const it of items) {
    for (const c of cardsFor(it, state.settings.tenses)) {
      if (!matchesFilter(c, filter)) continue;
      const p = state.progress[c.id];
      if (!p) {
        // "? → Català" unlocks once "Català → ?" has passed its learning steps (recognise first, then produce)
        if (c.kind === 'r' && (state.progress[it.id + '|f'] || {}).state !== 'review') continue;
        fresh.push(c);
      } else if (p.due <= now) due.push(c);
    }
  }
  due.sort((a, b) => {
    const pa = state.priority[a.item.id] || 0, pb = state.priority[b.item.id] || 0;
    if (pa !== pb) return pb - pa;
    return retrievability(state.progress[a.id], now) - retrievability(state.progress[b.id], now);
  });
  // New cards: priority words, then unlocked "? → Català" cards, then the next new words.
  // Conjugation: one tense across many verbs (present of anar, dir, estar…), never one verb 3 times in a row.
  const group = c => (state.priority[c.item.id] ? 0 : c.kind === 'r' ? 1 : 2);
  const tense = c => (c.kind === 'c' ? TENSE_ORDER.indexOf(c.tense) : 0);
  fresh.sort((a, b) => group(a) - group(b) || tense(a) - tense(b) || newRank(a.item, state) - newRank(b.item, state));

  const conj = filter.deck === 'conj';
  const limit = conj ? state.settings.conjPerDay : state.settings.newPerDay;
  const left = Math.max(0, limit - ((conj ? state.daily.conjSeen : state.daily.newSeen) || 0));
  // Priority words always come in, even past the daily limit.
  const pri = fresh.filter(c => state.priority[c.item.id]);
  const rest = fresh.filter(c => !state.priority[c.item.id]).slice(0, Math.max(0, left - pri.length));
  return { due, fresh: pri.concat(rest) };
}

// "Study first": mark the item priority and make its cards I've already seen due now.
export function prioritize(it, state, now = Date.now()) {
  state.priority[it.id] = now;
  for (const c of cardsFor(it, state.settings.tenses)) {
    const p = state.progress[c.id];
    if (p && p.due > now) state.progress[c.id] = { ...p, due: now };
  }
}

// "I know it": the item's cards (all meaning cards, or one conjugation card) become learned.
// Returns the previous progress so it can be undone.
export function markKnown(it, state, cards, now = Date.now()) {
  const before = {};
  for (const c of cards) {
    before[c.id] = state.progress[c.id];
    state.progress[c.id] = { state: 'review', s: 30, d: 5, ivl: 30, last: now, due: now + 30 * 864e5,
      reps: (before[c.id] || {}).reps || 0, lapses: (before[c.id] || {}).lapses || 0 };
  }
  return before;
}

export function meaningCards(it, state) {
  return cardsFor(it, state.settings.tenses).filter(c => c.kind !== 'c');
}

export function stats(items, state, now = Date.now(), filter = null) {
  let total = 0, learned = 0, learning = 0, due = 0;
  for (const it of items) {
    for (const c of cardsFor(it, state.settings.tenses)) {
      if (filter && !matchesFilter(c, filter)) continue;
      total++;
      const p = state.progress[c.id];
      if (!p) continue;
      if (isLearned(p)) learned++; else learning++;
      if (p.due <= now) due++;
    }
  }
  return { total, learned, learning, due, unseen: total - learned - learning };
}

// Item status for the word list: the weakest of its cards.
export function itemStatus(it, state) {
  const cs = cardsFor(it, state.settings.tenses).filter(c => c.kind !== 'c');
  if (!cs.length) return 'no translation';
  const ps = cs.map(c => state.progress[c.id]);
  if (ps.every(p => !p)) return 'new';
  if (ps.every(p => isLearned(p))) return 'learned';
  return 'learning';
}

// For printing: weakest studied cards first, then priority/new words.
export function weakest(items, state, n, filter, now = Date.now()) {
  const scored = [];
  for (const it of items) {
    if (!hasMeaning(it)) continue;
    const c = { id: it.id + '|f', item: it, kind: 'f' };
    if (filter && !matchesFilter(c, filter)) continue;
    const pf = state.progress[it.id + '|f'], pr = state.progress[it.id + '|r'];
    if (isLearned(pf) && isLearned(pr)) continue;
    const studied = [pf, pr].filter(Boolean);
    let score;
    if (studied.length) {
      // low recall chance, many lapses and high difficulty (e.g. failed today) = weak
      score = Math.min(...studied.map(p => retrievability(p, now)))
        - 0.1 * studied.reduce((a, p) => a + p.lapses, 0)
        - 0.03 * Math.max(...studied.map(p => p.d || 5));
    } else {
      score = state.priority[it.id] ? 0.5 : 2 + newRank(it, state) / 1e4;
    }
    scored.push([score, it]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
}
