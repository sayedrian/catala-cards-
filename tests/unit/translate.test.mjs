import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../../js/translate.js';

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
