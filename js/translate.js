// Suggested translations from MyMemory (free, no key). Always "not checked":
// one-word machine translation is often ambiguous, so Claude reviews new words later.
// With a sentence, the sentence is translated too and the meaning that appears in it is picked.

const API = 'https://api.mymemory.translated.net/get';
export const LANGS = ['es', 'en', 'ar'];
const MAX_OPTIONS = 4;

// Match the case of the Catalan word ("The towel" -> "the towel" for "la tovallola").
const caseLike = (t, text) => (t && text[0] === text[0].toLowerCase() ? t[0].toLowerCase() + t.slice(1) : t);
const bad = t => /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t);

// Main translation + other meanings from the translation memory (same Catalan text only).
async function fetchOne(text, lang) {
  const url = `${API}?q=${encodeURIComponent(text)}&langpair=ca|${lang}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const matches = Array.isArray(j.matches) ? j.matches : [];
  let main = (j.responseData && j.responseData.translatedText || '').trim();
  if (!main) {
    const m = matches.find(m => m.translation && m.translation.trim());
    if (m) main = m.translation.trim();
  }
  if (bad(main)) throw new Error(main);
  const same = s => String(s || '').toLowerCase().replace(/[.?!¿¡]/g, '').trim() === text.toLowerCase().trim();
  const options = [];
  for (const t of [main, ...matches.filter(m => same(m.segment)).map(m => (m.translation || '').trim())]) {
    const c = caseLike(t.replace(/^[¿¡]+|[.?!]+$/g, '').trim(), text);
    if (c && !bad(c) && !options.some(o => o.toLowerCase() === c.toLowerCase())) options.push(c);
  }
  return { main: caseLike(main, text), options: options.slice(0, MAX_OPTIONS) };
}

// Returns {es, en, ar}; missing ones are ''. Throws if offline or the service fails completely.
export async function suggest(text) {
  const res = await Promise.allSettled(LANGS.map(l => fetchOne(text, l)));
  if (res.every(r => r.status === 'rejected')) throw res[0].reason;
  const out = {};
  LANGS.forEach((l, i) => { out[l] = res[i].status === 'fulfilled' ? res[i].value.main : ''; });
  return out;
}

// Core of a translation for matching inside a sentence: lower case, no article, no punctuation.
const ARTICLES = /^(the|a|an|to|el|la|los|las|lo|un|una|unos|unas)\s+/;
function core(s) {
  return String(s || '').toLowerCase().replace(/[.,;:!?¿¡"“”()]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(ARTICLES, '').replace(/^ال/, '');
}
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The option that appears in the sentence translation, or null.
export function pickBySentence(options, sentence) {
  const s = ' ' + core(sentence) + ' ';
  if (!s.trim()) return null;
  const hits = options.filter(o => {
    const c = core(o);
    if (!c) return false;
    // Arabic words take prefixes (و، ب، ال…): a plain substring is enough there.
    if (/[؀-ۿ]/.test(c)) return s.includes(c);
    return new RegExp(`(^|[^\\p{L}])${reEsc(c)}`, 'u').test(s);
  });
  // The longest hit is the most specific ("dark-haired" over "dark").
  return hits.sort((a, b) => core(b).length - core(a).length)[0] || null;
}

// Word + optional sentence. Returns
// { es, en, ar, options: {es: [...], …}, fits: {es: true|false|null, …}, sentence: {es, en, ar} | null }.
// fits[l]: true = the chosen meaning appears in the sentence translation, false = no option does,
// null = nothing to compare (no sentence or no options).
export async function suggestInContext(word, sentence = '') {
  sentence = sentence.trim();
  const jobs = LANGS.map(l => fetchOne(word, l));
  if (sentence) jobs.push(...LANGS.map(l => fetchOne(sentence, l)));
  const res = await Promise.allSettled(jobs);
  if (res.every(r => r.status === 'rejected')) throw res[0].reason;
  const val = i => (res[i].status === 'fulfilled' ? res[i].value : { main: '', options: [] });
  const out = { options: {}, fits: {}, sentence: null };
  if (sentence) {
    out.sentence = {};
    LANGS.forEach((l, i) => { out.sentence[l] = val(LANGS.length + i).main; });
  }
  LANGS.forEach((l, i) => {
    const { main, options } = val(i);
    out.options[l] = options;
    const comparable = !!(out.sentence && out.sentence[l] && options.length);
    const fit = comparable ? pickBySentence(options, out.sentence[l]) : null;
    out[l] = fit || main;
    out.fits[l] = comparable ? !!fit : null;
  });
  return out;
}
