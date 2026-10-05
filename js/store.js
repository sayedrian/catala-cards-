// Everything I own lives in one object, saved to IndexedDB on this device:
// progress per card, words I added, my edits to sheet words, settings.

const DB = 'catala-cards';
const KEY = 'state';

export const DEFAULT_SETTINGS = {
  newPerDay: 15,          // new vocabulary cards per day
  conjPerDay: 5,          // new conjugation tables per day
  tenses: ['present', 'perfet', 'perifrastic'],
  rate: 0.9,
  mode: 'vocab',          // last chosen study mode: 'vocab' | 'conj'
  vocabDeck: 'all',
};

export function emptyState() {
  return {
    progress: {},   // cardId -> FSRS state
    added: {},      // id -> item I added in the app
    edits: {},      // id -> fields I changed on a sheet item
    hidden: [],     // sheet item ids I removed
    priority: {},   // item id -> timestamp (study first)
    settings: { ...DEFAULT_SETTINGS },
    daily: { date: '', newSeen: 0, conjSeen: 0 },
  };
}

// One connection, kept open: a save on app close must start its transaction without waiting.
let conn = null;
function open() {
  if (conn) return Promise.resolve(conn);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { conn = r.result; conn.onclose = () => { conn = null; }; res(conn); };
    r.onerror = () => rej(r.error);
  });
}

export async function load() {
  try {
    const db = await open();
    const v = await new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get(KEY);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const s = { ...emptyState(), ...(v || {}) };
    s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
    return s;
  } catch (e) {
    console.warn('IndexedDB unavailable, progress will not be saved', e);
    return emptyState();
  }
}

let timer = null, pending = null;
export function save(state) {
  clearTimeout(timer);
  pending = state;
  timer = setTimeout(flush, 300);
}

// Write a waiting save at once (app hidden, closed, or session ended).
export function flush() {
  clearTimeout(timer);
  const s = pending;
  pending = null;
  return s ? saveNow(s) : Promise.resolve();
}

export async function saveNow(state) {
  try {
    const db = conn || await open();
    await new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(JSON.parse(JSON.stringify(state)), KEY);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
