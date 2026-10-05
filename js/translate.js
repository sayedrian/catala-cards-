// Suggested translations from MyMemory (free, no key). Always "not checked":
// one-word machine translation is often ambiguous, so Claude reviews new words later.

const API = 'https://api.mymemory.translated.net/get';

async function one(text, lang) {
  const url = `${API}?q=${encodeURIComponent(text)}&langpair=ca|${lang}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  let t = (j.responseData && j.responseData.translatedText || '').trim();
  if (!t && Array.isArray(j.matches)) {
    const m = j.matches.find(m => m.translation && m.translation.trim());
    if (m) t = m.translation.trim();
  }
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error(t);
  // Match the case of the Catalan word ("The towel" -> "the towel" for "la tovallola").
  if (t && text[0] === text[0].toLowerCase()) t = t[0].toLowerCase() + t.slice(1);
  return t;
}

// Returns {es, en, ar}; missing ones are ''. Throws if offline or the service fails completely.
export async function suggest(text) {
  const langs = ['es', 'en', 'ar'];
  const res = await Promise.allSettled(langs.map(l => one(text, l)));
  if (res.every(r => r.status === 'rejected')) throw res[0].reason;
  const out = {};
  langs.forEach((l, i) => { out[l] = res[i].status === 'fulfilled' ? res[i].value : ''; });
  return out;
}
