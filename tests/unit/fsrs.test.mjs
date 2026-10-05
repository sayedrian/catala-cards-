import { test } from 'node:test';
import assert from 'node:assert/strict';
import { review, preview, isLearned, retrievability, LEARNED_DAYS } from '../../js/fsrs.js';

const MIN = 60e3, DAY = 864e5;
const T0 = Date.parse('2026-10-05T09:00:00');

test('new card: Again / Hard / Good stay in learning with 1 / 5 / 10 min steps', () => {
  for (const [g, m] of [[1, 1], [2, 5], [3, 10]]) {
    const c = review(undefined, g, T0);
    assert.equal(c.state, 'learning');
    assert.equal(c.due - T0, m * MIN);
    assert.equal(c.reps, 1);
    assert.equal(c.ivl, 0);
  }
});

test('new card: Easy goes straight to review with days', () => {
  const c = review(undefined, 4, T0);
  assert.equal(c.state, 'review');
  assert.ok(c.ivl >= 1);
  assert.equal(c.due, T0 + c.ivl * DAY);
});

test('learning card graduates on Good, stays on Again', () => {
  const c1 = review(undefined, 3, T0);
  assert.equal(review(c1, 1, T0 + 10 * MIN).state, 'learning');
  const c2 = review(c1, 3, T0 + 10 * MIN);
  assert.equal(c2.state, 'review');
  assert.ok(c2.ivl >= 1);
});

test('review does not mutate the input card', () => {
  const c1 = review(undefined, 3, T0);
  const copy = JSON.stringify(c1);
  review(c1, 3, T0 + MIN);
  assert.equal(JSON.stringify(c1), copy);
});

test('repeated Good: intervals grow and the card becomes learned', () => {
  let c, now = T0;
  const ivls = [];
  for (let i = 0; i < 7; i++) { c = review(c, 3, now); ivls.push(c.ivl); now = c.due; }
  for (let i = 2; i < ivls.length; i++) assert.ok(ivls[i] > ivls[i - 1], `growing: ${ivls}`);
  assert.ok(isLearned(c));
});

test('isLearned threshold is exactly 21 days', () => {
  assert.equal(LEARNED_DAYS, 21);
  assert.equal(isLearned({ state: 'review', ivl: 20 }), false);
  assert.equal(isLearned({ state: 'review', ivl: 21 }), true);
  assert.equal(isLearned({ state: 'relearning', ivl: 40 }), false);
  assert.equal(isLearned(undefined), false);
});

test('a lapse: relearning, lapses+1, lower stability, no longer learned', () => {
  let c, now = T0;
  for (let i = 0; i < 6; i++) { c = review(c, 3, now); now = c.due; }
  assert.ok(isLearned(c));
  const l = review(c, 1, now);
  assert.equal(l.state, 'relearning');
  assert.equal(l.lapses, c.lapses + 1);
  assert.ok(l.s < c.s);
  assert.equal(isLearned(l), false);
  assert.equal(l.due - now, 1 * MIN);
  const back = review(l, 3, now + MIN);
  assert.equal(back.state, 'review');
});

test('Hard < Good < Easy for a review card', () => {
  let c = review(undefined, 3, T0);
  c = review(c, 3, T0 + 10 * MIN);
  const at = c.due;
  const [h, g, e] = [2, 3, 4].map(x => review(c, x, at).ivl);
  assert.ok(h <= g && g < e, `${h} ${g} ${e}`);
});

test('intervals are capped at 365 days', () => {
  let c, now = T0;
  for (let i = 0; i < 20; i++) { c = review(c, 4, now); now = c.due; }
  assert.equal(c.ivl, 365);
});

test('preview labels', () => {
  assert.equal(preview(undefined, 1, T0), '1 min');
  assert.equal(preview(undefined, 3, T0), '10 min');
  assert.match(preview(undefined, 4, T0), /^\d+ d$/);
  let c, now = T0;
  for (let i = 0; i < 7; i++) { c = review(c, 3, now); now = c.due; }
  assert.match(preview(c, 4, now), /mo$/);
});

test('retrievability: 0 for unseen, ~0.9 at the interval, falls with time', () => {
  assert.equal(retrievability(undefined, T0), 0);
  let c = review(undefined, 3, T0);
  c = review(c, 3, T0 + 10 * MIN);
  const r0 = retrievability(c, c.last);
  const rDue = retrievability(c, c.due);
  const rLate = retrievability(c, c.due + 30 * DAY);
  assert.ok(Math.abs(r0 - 1) < 1e-9);
  assert.ok(rDue > 0.85 && rDue < 0.95, String(rDue));
  assert.ok(rLate < rDue);
});
