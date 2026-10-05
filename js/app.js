import { review, preview, isLearned } from './fsrs.js';
import * as store from './store.js';
import {
  TENSE_LABELS, PERSONS, IMP_PERSONS, buildItems, cardsFor, buildQueue, stats,
  itemStatus, weakest, hasMeaning, deckOf, prioritize, markKnown, meaningCards,
} from './deck.js';
import { speak, hasCatalanVoice, canRecord, startRecording, stopRecording, isRecording, play } from './audio.js';
import { suggest } from './translate.js';

export const VERSION = 'v3';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/'/g, '’').replace(/\s+/g, ' ').trim();
const bare = s => norm(s).replace(/^(el|la|els|les|l’|un|una|uns|unes)\s*/, '');

let deck = { items: [], units: {} };
let state = store.emptyState();
let items = [];
let byId = new Map();

function refreshItems() {
  items = buildItems(deck, state);
  byId = new Map(items.map(it => [it.id, it]));
}

function newDay() {
  const t = store.today();
  if (state.daily.date !== t) state.daily = { date: t, newSeen: 0, conjSeen: 0 };
}

// ---------- topics (filters) ----------
function topicOptions() {
  const opts = [['', 'All topics']];
  const tags = new Set();
  items.forEach(it => (it.tags || []).forEach(t => tags.add(t)));
  [...tags].filter(t => t.startsWith('cpnl:')).sort().forEach(t => opts.push([t, 'CPNL course ' + t.slice(5)]));
  [...tags].filter(t => t.startsWith('exam:')).sort().forEach(t => opts.push([t, 'Exam: ' + t.slice(5)]));
  Object.entries(deck.units || {}).forEach(([u, name]) => opts.push([u, `${u} ${name}`]));
  [...tags].filter(t => t.startsWith('others:')).sort().forEach(t => opts.push([t, 'Others: ' + t.slice(7)]));
  opts.push(['src:app', 'Added by me']);
  return opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
}

// ---------- tabs ----------
function show(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'study' && !session) renderHome();
  if (view === 'words') renderList();
  if (view === 'more') renderMore();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => show(b.dataset.view));

// ---------- study home ----------
const mode = () => state.settings.mode === 'conj' ? 'conj' : 'vocab';
function filter() { return { deck: mode() === 'conj' ? 'conj' : $('#fDeck').value, tag: $('#fTag').value }; }

function renderTenses() {
  $('#sTenses').innerHTML = '<legend>Tenses</legend>' + Object.entries(TENSE_LABELS).map(([k, l]) =>
    `<label><input type="checkbox" value="${k}" ${state.settings.tenses.includes(k) ? 'checked' : ''}> ${l}</label>`).join('');
}

function renderHome() {
  newDay();
  const conj = mode() === 'conj';
  document.querySelector(`#modeSeg input[value=${mode()}]`).checked = true;
  $('#deckLabel').hidden = conj;
  $('#sTenses').hidden = !conj;
  if (conj) renderTenses();
  // stats for the chosen mode only
  const s = stats(items, state, Date.now(), { deck: conj ? 'conj' : 'all', tag: '' });
  $('#stats').innerHTML = [
    [s.due, 'due now'], [s.learning, 'learning'], [s.learned, 'learned'], [s.unseen, 'not seen'],
  ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  const q = buildQueue(items, state, filter());
  const seen = (conj ? state.daily.conjSeen : state.daily.newSeen) || 0;
  const limit = conj ? state.settings.conjPerDay : state.settings.newPerDay;
  $('#queueInfo').textContent = `${q.due.length} to review · ${q.fresh.length} new today (${seen}/${limit} new done)`;
  $('#startBtn').disabled = !q.due.length && !q.fresh.length;
  $('#voiceWarn').hidden = hasCatalanVoice();
}
$('#fTag').onchange = renderHome;
$('#fDeck').onchange = () => { state.settings.vocabDeck = $('#fDeck').value; store.save(state); renderHome(); };
$('#modeSeg').onchange = e => { state.settings.mode = e.target.value; store.save(state); renderHome(); };
$('#sTenses').onchange = () => {
  state.settings.tenses = [...document.querySelectorAll('#sTenses input:checked')].map(i => i.value);
  store.save(state);
  renderHome();
};

// ---------- session ----------
let session = null;   // { queue: [], pending: [], card, revealed, done, recUrl }

$('#startBtn').onclick = () => {
  newDay();
  const q = buildQueue(items, state, filter());
  startSession([...q.due, ...q.fresh]);
};

function startSession(cards) {
  session = { queue: cards, pending: [], done: 0, card: null };
  $('#studyHome').hidden = true; $('#done').hidden = true; $('#session').hidden = false;
  nextCard();
}

$('#endBtn').onclick = endSession;
$('#backBtn').onclick = () => { $('#done').hidden = true; $('#studyHome').hidden = false; renderHome(); };

function endSession() {
  const n = session ? session.done : 0;
  session = null;
  $('#session').hidden = true;
  $('#done').hidden = false;
  $('#doneInfo').textContent = `${n} cards reviewed. ` + (n ? 'Bona feina!' : '');
  store.save(state);
  store.flush();
}

function nextCard() {
  const now = Date.now();
  session.pending.sort((a, b) => state.progress[a.id].due - state.progress[b.id].due);
  let c;
  if (session.pending.length && state.progress[session.pending[0].id].due <= now) c = session.pending.shift();
  else if (session.queue.length) c = session.queue.shift();
  else if (session.pending.length) c = session.pending.shift();   // learn ahead: nothing else left
  if (!c) return endSession();
  session.card = c; session.revealed = false; session.recUrl = null;
  renderCard();
}

function transBlock(it) {
  const rows = [];
  if (it.es) rows.push(`<div><span class="l">ES</span>${esc(it.es)}</div>`);
  if (it.en) rows.push(`<div><span class="l">EN</span>${esc(it.en)}</div>`);
  if (it.ar) rows.push(`<div class="ar" lang="ar" dir="rtl">${esc(it.ar)}<span class="l">AR</span></div>`);
  if (!rows.length) rows.push('<div class="muted">(no translation yet)</div>');
  return `<div class="trans">${rows.join('')}</div>`;
}

function caBlock(it) {
  const meta = [it.gender && it.gender !== it.ca.split(' ')[0] ? it.gender : '', it.pron ? `/${it.pron}/` : '',
    it.type === 'verb' && it.part ? `part. ${it.part}` : ''].filter(Boolean).join(' · ');
  return `<div class="ca" lang="ca">${esc(it.ca)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}`;
}

function flags(it) {
  const f = [];
  if (it.needsTranslation) f.push('needs translation');
  else if (it.unchecked) f.push('not checked yet');
  if (it.conjAuto && session && session.card.kind === 'c') f.push('forms made by rule');
  return f.map(x => `<span class="flag">${x}</span>`).join(' ');
}

function conjTable(it, t) {
  const forms = it.conj[t];
  const ps = t === 'imperatiu' ? IMP_PERSONS : PERSONS;
  return `<table class="conj" lang="ca">${forms.map((f, i) => `<tr><td>${ps[i]}</td><td>${esc(f)}</td></tr>`).join('')}</table>`;
}

const KIND_LABEL = { f: 'Català → ?', r: '? → Català', c: 'Conjugate' };

function renderCard() {
  const { card: c, revealed } = session;
  const it = c.item;
  let front = '', back = '';
  if (c.kind === 'f') { front = caBlock(it); back = transBlock(it); }
  if (c.kind === 'r') { front = transBlock(it); back = caBlock(it); }
  if (c.kind === 'c') {
    front = `<div class="ca" lang="ca">${esc(it.ca)}</div><div class="meta">${TENSE_LABELS[c.tense]}` +
      `${it.es ? ' · ' + esc(it.es) : ''}</div>`;
    back = conjTable(it, c.tense);
  }
  const extra = revealed && c.kind !== 'c'
    ? (it.ex ? `<div class="ex" lang="ca">${esc(it.ex)}</div>` : '') + (it.notes ? `<div class="meta">${esc(it.notes)}</div>` : '')
    : '';
  $('#card').innerHTML = `<div class="kind">${KIND_LABEL[c.kind]} · ${deckOf(it)}</div>${front}` +
    (revealed ? `<hr>${back}${extra}` : '') + `<div>${flags(it)}</div>`;

  // Listening to the Catalan before answering would give it away on "? → Català" cards.
  $('#speakBtn').hidden = !revealed && c.kind === 'r';
  $('#recBtn').hidden = !canRecord();
  $('#recBtn').textContent = '🎙 Record';
  $('#meBtn').hidden = $('#compareBtn').hidden = !session.recUrl;
  $('#showBtn').hidden = revealed;
  $('#rateRow').hidden = !revealed;
  if (revealed) {
    const p = state.progress[c.id];
    document.querySelectorAll('.rate').forEach(b => { b.querySelector('small').textContent = preview(p, +b.dataset.g); });
  }
  const total = session.done + session.queue.length + session.pending.length + 1;
  $('#sessionCount').textContent = `${session.done + 1} / ${total}`;
}

function speakText() {
  const { card: c } = session;
  const it = c.item;
  if (c.kind === 'c') return it.conj[c.tense].join(', ');
  return session.revealed && it.ex ? `${it.ca}. ${it.ex}` : it.ca;
}

$('#speakBtn').onclick = () => speak(speakText(), state.settings.rate);
$('#showBtn').onclick = () => { session.revealed = true; renderCard(); };

$('#recBtn').onclick = async () => {
  if (isRecording()) {
    session.recUrl = await stopRecording();
    renderCard();
    play(session.recUrl);
  } else {
    try {
      await startRecording();
      $('#recBtn').textContent = '⏹ Stop';
    } catch (e) {
      alert('Microphone not available: ' + e.message);
    }
  }
};
$('#meBtn').onclick = () => session.recUrl && play(session.recUrl);
$('#compareBtn').onclick = async () => {
  await speak(session.card.kind === 'c' ? speakText() : session.card.item.ca, state.settings.rate);
  if (session.recUrl) await play(session.recUrl);
};

function rate(g) {
  const c = session.card;
  const before = state.progress[c.id];
  if (!before) {
    if (c.kind === 'c') state.daily.conjSeen = (state.daily.conjSeen || 0) + 1;
    else state.daily.newSeen++;
  }
  const p = review(before, g);
  state.progress[c.id] = p;
  // A priority word stops being priority once both directions have passed the learning steps.
  const id = c.item.id;
  if (state.priority[id] && ['|f', '|r'].every(k => !hasMeaning(c.item) || (state.progress[id + k] || {}).state === 'review')) {
    delete state.priority[id];
  }
  session.done++;
  if (p.state !== 'review') session.pending.push(c);
  store.save(state);
  store.flush();   // save every answer at once
  nextCard();
}
document.querySelectorAll('.rate').forEach(b => b.onclick = () => rate(+b.dataset.g));

// "I know it": the word (both directions) or this conjugation table goes straight to learned.
let undo = null, toastTimer = null;
$('#knowBtn').onclick = () => {
  const c = session.card;
  const it = c.item;
  const cards = c.kind === 'c' ? [c] : meaningCards(it, state);
  const ids = new Set(cards.map(x => x.id));
  const before = markKnown(it, state, cards);
  if (c.kind !== 'c') delete state.priority[it.id];
  const removed = session.queue.filter(x => ids.has(x.id)).concat(session.pending.filter(x => ids.has(x.id)));
  session.queue = session.queue.filter(x => !ids.has(x.id));
  session.pending = session.pending.filter(x => !ids.has(x.id));
  undo = { card: c, before, removed, priority: state.priority[it.id] };
  store.save(state); store.flush();
  showToast(`✓ "${it.ca}"${c.kind === 'c' ? ' · ' + TENSE_LABELS[c.tense] : ''} → learned`);
  session.done++;
  nextCard();
};

function showToast(msg) {
  $('#toastMsg').textContent = msg;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; undo = null; }, 8000);
}

$('#undoBtn').onclick = () => {
  if (!undo) return;
  for (const [id, p] of Object.entries(undo.before)) {
    if (p) state.progress[id] = p; else delete state.progress[id];
  }
  store.save(state); store.flush();
  const back = [undo.card, ...undo.removed.filter(x => x.id !== undo.card.id)];
  undo = null;
  $('#toast').hidden = true;
  if (session) {
    session.done = Math.max(0, session.done - 1);
    session.queue.unshift(...back);
    nextCard();
  } else {
    startSession(back);
  }
};

document.addEventListener('keydown', e => {
  if (!session || $('#session').hidden || e.target.matches('input, select')) return;
  if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); $('#showBtn').click(); }
  else if (session.revealed && '1234'.includes(e.key)) rate(+e.key);
});

// ---------- add ----------
$('#translateBtn').onclick = async () => {
  const f = $('#addForm');
  const ca = f.ca.value.trim();
  if (!ca) return f.ca.focus();
  $('#trState').textContent = 'translating…';
  try {
    const t = await suggest(ca);
    for (const k of ['es', 'en', 'ar']) if (!f[k].value.trim()) f[k].value = t[k];
    $('#trState').textContent = 'suggestion: check it';
  } catch (e) {
    $('#trState').textContent = navigator.onLine ? 'translation service failed, try again or type them' : 'offline: save now, translated later';
  }
};

$('#addForm').onsubmit = e => {
  e.preventDefault();
  const f = e.target;
  const ca = f.ca.value.trim();
  const type = f.type.value;
  const existing = items.find(it => bare(it.ca) === bare(ca) && (type === 'verb') === (it.type === 'verb'));
  if (existing) {
    prioritize(existing, state);
    store.save(state);
    $('#addMsg').textContent = `"${existing.ca}" is already in your cards: moved to the top of your study queue.`;
    f.reset();
    return;
  }
  const it = {
    id: 'u' + Date.now().toString(36), type, ca,
    es: f.es.value.trim(), en: f.en.value.trim(), ar: f.ar.value.trim(),
    ex: f.ex.value.trim(), notes: f.notes.value.trim(),
    tags: ['src:app'], added: Date.now(), updated: Date.now(), unchecked: true,
  };
  if (!hasMeaning(it)) it.needsTranslation = true;
  for (const k of Object.keys(it)) if (it[k] === '') delete it[k];
  state.added[it.id] = it;
  state.priority[it.id] = Date.now();
  store.save(state);
  refreshItems();
  $('#addMsg').textContent = `Saved "${ca}". It comes first in your next study session.` +
    (it.needsTranslation ? ' Translations will be added when you are online.' : '');
  f.reset();
  $('#trState').textContent = '';
  if (it.needsTranslation && navigator.onLine) fillMissing();
};

// Words saved without translations (offline): try again when online.
async function fillMissing() {
  const todo = Object.values(state.added).filter(it => it.needsTranslation);
  for (const it of todo) {
    try {
      const t = await suggest(it.ca);
      for (const k of ['es', 'en', 'ar']) if (!it[k] && t[k]) it[k] = t[k];
      if (hasMeaning(it)) { delete it.needsTranslation; it.updated = Date.now(); }
    } catch (e) { return; }
  }
  if (todo.length) { store.save(state); refreshItems(); }
}
window.addEventListener('online', () => { $('#netState').hidden = true; fillMissing(); });
window.addEventListener('offline', () => { $('#netState').hidden = false; });

// ---------- word list ----------
function renderList() {
  const q = norm($('#search').value);
  const sf = $('#statusFilter').value;
  const out = [];
  let n = 0;
  for (const it of items) {
    if (q && ![it.ca, it.es, it.en, it.ar].some(x => norm(x).includes(q))) continue;
    const st = itemStatus(it, state);
    if (sf === 'priority' && !state.priority[it.id]) continue;
    if (sf === 'added' && !state.added[it.id]) continue;
    if (sf === 'unchecked' && !it.unchecked && !it.needsTranslation) continue;
    if (['new', 'learning', 'learned', 'no translation'].includes(sf) && st !== sf) continue;
    n++;
    if (out.length < 300) {
      out.push(`<li data-id="${it.id}"><div class="left"><div class="w" lang="ca">${esc(it.ca)}</div>` +
        `<div class="t">${esc([it.es, it.en].filter(Boolean).join(' · '))}</div></div>` +
        `<span class="badge ${st}">${state.priority[it.id] ? '★ ' : ''}${st}</span></li>`);
    }
  }
  $('#wordList').innerHTML = out.join('');
  $('#listInfo').textContent = `${n} items` + (n > 300 ? ' (first 300 shown, search to narrow)' : '');
}
$('#search').oninput = $('#statusFilter').onchange = renderList;
$('#wordList').onclick = e => { const li = e.target.closest('li'); if (li) openDetail(li.dataset.id); };

function openDetail(id) {
  const it = byId.get(id);
  const d = $('#detail');
  const conj = it.conj ? Object.keys(TENSE_LABELS).filter(t => it.conj[t])
    .map(t => `<details><summary>${TENSE_LABELS[t]}</summary>${conjTable(it, t)}</details>`).join('') : '';
  d.innerHTML = `<div class="dlg">
    <div class="ca" lang="ca" style="font-size:1.6rem;font-weight:700">${esc(it.ca)}</div>
    <div class="muted">${esc([deckOf(it), it.unit, it.cat, it.pron && '/' + it.pron + '/'].filter(Boolean).join(' · '))}</div>
    ${transBlock(it)}
    ${it.ex ? `<div class="ex" lang="ca">${esc(it.ex)}</div>` : ''}
    ${it.notes ? `<div class="muted">${esc(it.notes)}</div>` : ''}
    <div>${it.needsTranslation ? '<span class="flag">needs translation</span> ' : it.unchecked ? '<span class="flag">not checked yet</span> ' : ''}${it.conjAuto ? '<span class="flag">conjugation made by rule</span>' : ''}</div>
    ${conj}
    <div class="row">
      <button data-a="speak" class="chip">🔊 Listen</button>
      <button data-a="priority" class="chip">★ Study first</button>
      <button data-a="known" class="chip">✓ I know it</button>
      <button data-a="edit" class="chip">✏️ Edit</button>
      <button data-a="remove" class="chip">🗑 Remove</button>
    </div>
    <p class="muted">${esc((it.tags || []).join(' · '))}</p>
    <button data-a="close" class="primary">Close</button>
  </div>`;
  d.onclick = e => {
    const a = e.target.dataset && e.target.dataset.a;
    if (e.target === d || a === 'close') return d.close();
    if (a === 'speak') speak(it.ex ? `${it.ca}. ${it.ex}` : it.ca, state.settings.rate);
    if (a === 'priority') { prioritize(it, state); done('Moved to the top of your study queue.'); }
    if (a === 'known') {
      markKnown(it, state, cardsFor(it, state.settings.tenses));
      delete state.priority[id];
      done('Marked as learned. It comes back in a month to check.');
    }
    if (a === 'remove' && confirm(`Remove "${it.ca}" from your cards?`)) {
      if (state.added[id]) delete state.added[id]; else state.hidden.push(id);
      delete state.priority[id];
      done('Removed.');
    }
    if (a === 'edit') openEdit(it);
  };
  function done(msg) {
    store.save(state); refreshItems(); d.close(); renderList();
    $('#listInfo').textContent = msg;
  }
  d.showModal();
}

function openEdit(it) {
  const d = $('#detail');
  const fields = [['ca', 'Català'], ['es', 'Español'], ['en', 'English'], ['ar', 'العربية'], ['ex', 'Example'], ['notes', 'Notes']];
  d.innerHTML = `<form class="dlg" method="dialog">
    <h2>Edit</h2>
    ${fields.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(it[k] || '')}" ${k === 'ar' ? 'dir="rtl"' : ''}></label>`).join('')}
    <label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" name="checked" ${it.unchecked ? '' : 'checked'}> Translations checked</label>
    <div class="row"><button class="primary" value="save">Save</button><button value="cancel">Cancel</button></div>
  </form>`;
  d.onclick = null;
  d.querySelector('form').onsubmit = e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    const f = e.target;
    const ch = {};
    fields.forEach(([k]) => { ch[k] = f[k].value.trim(); });
    ch.unchecked = !f.checked.checked;
    ch.updated = Date.now();
    if (hasMeaning(ch)) ch.needsTranslation = false;
    if (state.added[it.id]) Object.assign(state.added[it.id], ch);
    else state.edits[it.id] = { ...(state.edits[it.id] || {}), ...ch };
    store.save(state); refreshItems(); renderList();
  };
}

// ---------- print ----------
$('#printBtn').onclick = () => {
  const n = Math.max(1, Math.min(200, +$('#pCount').value || 20));
  const tag = $('#pTag').value;
  const f = { deck: 'all', tag };
  let list;
  if ($('#pWhich').value === 'weak') list = weakest(items, state, n, tag ? f : null);
  else list = items.filter(it => hasMeaning(it) && (!tag || (it.tags || []).includes(tag) || it.unit === tag)).slice(0, n);
  if (!list.length) { $('#printInfo').textContent = 'No cards match.'; return; }
  const pages = [];
  for (let i = 0; i < list.length; i += 10) {
    const chunk = list.slice(i, i + 10);
    const front = chunk.map(it => `<div class="pc"><div class="ca">${esc(it.ca)}</div>` +
      `<div class="meta">${{ verb: 'verb', expr: 'expression' }[it.type] || ''}</div></div>`);
    // Back page: columns swapped so each back lines up with its front when flipped on the long edge.
    const back = [];
    for (let r = 0; r < 5; r++) {
      for (const col of [1, 0]) {
        const it = chunk[r * 2 + col];
        back.push(it ? `<div class="pc"><div class="tr">${esc(it.es || '')}</div><div class="tr">${esc(it.en || '')}</div>` +
          `<div class="ar" lang="ar">${esc(it.ar || '')}</div>${it.ex ? `<div class="ex">${esc(it.ex)}</div>` : ''}</div>` : '<div class="pc"></div>');
      }
    }
    while (front.length < 10) front.push('<div class="pc"></div>');
    pages.push(`<div class="sheet">${front.join('')}</div><div class="sheet">${back.join('')}</div>`);
  }
  $('#printArea').innerHTML = pages.join('');
  $('#printInfo').textContent = `${list.length} cards on ${pages.length} sheet(s), ${pages.length * 2} pages.`;
  window.print();
};

// ---------- more: settings, backup ----------
function renderMore() {
  $('#sNew').value = state.settings.newPerDay;
  $('#sConjNew').value = state.settings.conjPerDay;
  $('#sRate').value = state.settings.rate;
  const s = stats(items, state);
  const verbs = items.filter(it => it.conj).length;
  $('#about').innerHTML = `${items.length} items (${items.filter(i => i.type === 'word').length} words, ` +
    `${items.filter(i => i.type === 'verb').length} verbs, ${items.filter(i => i.type === 'expr').length} expressions), ` +
    `${verbs} verbs with conjugations. ${s.total} cards, ${s.learned} learned.<br>` +
    `A card counts as <b>learned</b> when its next review is 21+ days away. Catalan voice: ${hasCatalanVoice() ? 'yes ✓' : 'not installed'}.` +
    `<br>App version ${VERSION}.`;
}
$('#sNew').onchange = e => { state.settings.newPerDay = Math.max(0, +e.target.value || 0); store.save(state); };
$('#sRate').onchange = e => { state.settings.rate = +e.target.value; store.save(state); };
$('#sConjNew').onchange = e => { state.settings.conjPerDay = Math.max(0, +e.target.value || 0); store.save(state); };
$('#testVoice').onclick = () => speak('Bon dia, com estàs?', state.settings.rate);

$('#exportBtn').onclick = () => {
  const data = { app: 'catala-cards', version: 1, exported: new Date().toISOString(), state };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `catala-cards-backup-${store.today()}.json`;
  a.click();
  $('#backupMsg').textContent = 'Backup saved to your Downloads.';
};

// Merge a backup into the current state: newer wins, nothing is deleted.
$('#importFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const inc = data.state;
    if (data.app !== 'catala-cards' || !inc) throw new Error('not a Català Cards backup');
    let n = 0;
    for (const [id, p] of Object.entries(inc.progress || {})) {
      if (!state.progress[id] || (p.last || 0) > (state.progress[id].last || 0)) { state.progress[id] = p; n++; }
    }
    for (const key of ['added', 'edits']) {
      for (const [id, it] of Object.entries(inc[key] || {})) {
        if (!state[key][id] || (it.updated || 0) >= (state[key][id].updated || 0)) { state[key][id] = it; n++; }
      }
    }
    state.hidden = [...new Set([...state.hidden, ...(inc.hidden || [])])];
    state.priority = { ...(inc.priority || {}), ...state.priority };
    await store.saveNow(state);
    refreshItems();
    $('#backupMsg').textContent = `Backup loaded: ${n} changes merged.`;
  } catch (err) {
    $('#backupMsg').textContent = 'Could not load: ' + err.message;
  }
  e.target.value = '';
};

// Save at once when the app goes to the background or closes (phones kill apps without warning).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
window.addEventListener('pagehide', () => store.flush());

// ---------- start ----------
async function init() {
  state = await store.load();
  try {
    deck = await (await fetch('data/cards.json')).json();
  } catch (e) {
    $('#queueInfo').textContent = 'Could not load the card deck.';
  }
  refreshItems();
  $('#fDeck').value = state.settings.vocabDeck || 'all';
  const opts = topicOptions();
  $('#fTag').innerHTML = opts;
  $('#pTag').innerHTML = opts;
  $('#netState').hidden = navigator.onLine;
  renderHome();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if (navigator.onLine) fillMissing();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
init();
