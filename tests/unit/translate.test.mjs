import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, suggestInContext, pickBySentence } from '../../js/translate.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// handler(lang, q) -> response body object, or throws
function mock(handler) {
  const calls = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    const lang = u.searchParams.get('langpair').split('|')[1];
    calls.push({ lang, q: u.searchParams.get('q') });
    const body = handler(lang, u.searchParams.get('q'));
    if (body instanceof Error) throw body;
    if (body === 500) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => body };
  };
  return calls;
}
const ok = t => ({ responseData: { translatedText: t }, matches: [] });

test('asks ca→es, ca→en, ca→ar and URL-encodes the word', async () => {
  const calls = mock(() => ok('x'));
  await suggest("l'aigua i el sol");
  assert.deepEqual(calls.map(c => c.lang).sort(), ['ar', 'en', 'es']);
  assert.equal(calls[0].q, "l'aigua i el sol");
});

test('lowercases the first letter when the Catalan word is lowercase', async () => {
  mock(l => ok({ es: 'La toalla', en: 'The towel', ar: 'المنشفة' }[l]));
  assert.deepEqual(await suggest('la tovallola'), { es: 'la toalla', en: 'the towel', ar: 'المنشفة' });
  mock(() => ok('Hello'));
  assert.equal((await suggest('Bon dia')).en, 'Hello', 'capitalised input keeps capitals');
});

test('empty translatedText falls back to the first non-empty match', async () => {
  mock(() => ({ responseData: { translatedText: '' }, matches: [{ translation: ' ' }, { translation: 'oscuro' }] }));
  assert.equal((await suggest('fosc')).es, 'oscuro');
});

test('one language failing gives a partial result', async () => {
  mock(l => (l === 'ar' ? 500 : ok('dark')));
  assert.deepEqual(await suggest('fosc'), { es: 'dark', en: 'dark', ar: '' });
});

test('quota warning counts as a failure', async () => {
  mock(l => (l === 'en' ? ok('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY') : ok('x')));
  assert.equal((await suggest('fosc')).en, '');
});

test('all failing (offline) throws', async () => {
  mock(() => new TypeError('Failed to fetch'));
  await assert.rejects(suggest('fosc'), /Failed to fetch/);
});

// ---- v5: sentence context ----
const withAlt = (t, segment, alts) => ({ responseData: { translatedText: t }, matches: alts.map(translation => ({ segment, translation })) });

test('pickBySentence: the option found in the sentence, longest first, articles ignored', () => {
  assert.equal(pickBySentence(['dark', 'dark-haired', 'gloomy'], 'She has dark-haired kids.'), 'dark-haired');
  assert.equal(pickBySentence(['the queue', 'the tail'], 'The dog wags its tail.'), 'the tail');
  assert.equal(pickBySentence(['oscuro', 'moreno'], 'Tiene el pelo moreno.'), 'moreno');
  assert.equal(pickBySentence(['المنشفة'], 'أين منشفتي؟ المنشفة هنا'), 'المنشفة');
  assert.equal(pickBySentence(['tail'], 'Retail prices'), null, 'whole words only (not inside another word)');
  assert.equal(pickBySentence(['dark'], ''), null);
});

test('suggestInContext: no sentence = 3 requests, options deduped and same-segment only', async () => {
  const calls = mock((l, q) => ({ responseData: { translatedText: 'dark' },
    matches: [{ segment: 'fosc', translation: 'Dark' }, { segment: 'fosca', translation: 'darkness' }, { segment: 'Fosc.', translation: 'gloomy' }] }));
  const t = await suggestInContext('fosc');
  assert.deepEqual(t.options.en, ['dark', 'gloomy'], '"fosca" is another word, "Dark" a duplicate');
  assert.equal(t.en, 'dark');
  assert.equal(t.sentence, null);
  assert.equal(t.fits.en, null);
  assert.equal(calls.length, 3);
});

test('suggestInContext: with a sentence, picks the meaning that is in the sentence', async () => {
  const calls = mock((l, q) => (q === 'la cua'
    ? withAlt({ es: '¿Hmm?', en: 'Hmm?', ar: 'همم؟' }[l], q, { es: ['la cola'], en: ['the queue', 'the tail'], ar: ['الذيل'] }[l])
    : ok({ es: 'El perro mueve la cola.', en: 'The dog wags its tail.', ar: 'الكلب يهز ذيله.' }[l])));
  const t = await suggestInContext('la cua', ' El gos mou la cua. ');
  assert.equal(calls.length, 6);
  assert.equal(calls.filter(c => c.q === 'El gos mou la cua.').length, 3, 'sentence trimmed and sent once per language');
  assert.deepEqual(t.sentence, { es: 'El perro mueve la cola.', en: 'The dog wags its tail.', ar: 'الكلب يهز ذيله.' });
  assert.equal(t.es, 'la cola');
  assert.equal(t.en, 'the tail');
  assert.equal(t.fits.en, true);
  assert.deepEqual(t.options.en, ['hmm', 'the queue', 'the tail'], 'end punctuation dropped');
  assert.equal(t.ar, 'الذيل', 'Arabic: found without its article inside ذيله ("its tail")');
  assert.equal(t.fits.ar, true);
});

test('suggestInContext: no option in the sentence keeps the main one, fits = false', async () => {
  mock((l, q) => (q === 'fosc' ? withAlt('dark', q, ['gloomy']) : ok('It is night.')));
  const t = await suggestInContext('fosc', 'És de nit.');
  assert.equal(t.en, 'dark');
  assert.equal(t.fits.en, false);
});

test('suggestInContext: sentence failing still gives the word', async () => {
  mock((l, q) => (q === 'fosc' ? ok('dark') : 500));
  const t = await suggestInContext('fosc', 'Fa fosc.');
  assert.equal(t.en, 'dark');
  assert.equal(t.sentence.en, '');
  assert.equal(t.fits.en, null);
});
