// Spaced repetition: FSRS-4.5 with default weights, plus short learning steps (minutes)
// for new and forgotten cards. Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy.

const W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
  0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const MAX_DAYS = 365;
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export const LEARNED_DAYS = 21;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const initD = g => clamp(W[4] - (g - 3) * W[5], 1, 10);
const initS = g => W[g - 1];

export function retrievability(c, now = Date.now()) {
  if (!c || !c.s || !c.last) return 0;
  const t = Math.max(0, (now - c.last) / DAY);
  return Math.pow(1 + FACTOR * t / c.s, DECAY);
}

function nextD(d, g) {
  const d2 = d - W[6] * (g - 3);
  return clamp(W[7] * initD(4) + (1 - W[7]) * d2, 1, 10);
}

function recallS(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
}

function forgetS(d, s, r) {
  return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
}

const daysFor = s => clamp(Math.round(s / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1)), 1, MAX_DAYS);

// Returns the new card state after rating g. c may be undefined (new card).
export function review(c, g, now = Date.now()) {
  c = c ? { ...c } : { state: 'new', reps: 0, lapses: 0 };
  const steps = { 1: 1 * MIN, 2: 5 * MIN, 3: 10 * MIN };

  if (c.state === 'new') {
    c.d = initD(g);
    c.s = initS(g);
    c.state = g === 4 ? 'review' : 'learning';
  } else if (c.state === 'learning' || c.state === 'relearning') {
    if (g >= 3) c.state = 'review';
    if (g === 4) c.s = Math.max(c.s, initS(4));
  } else {
    const r = retrievability(c, now);
    c.d = nextD(c.d, g);
    if (g === 1) {
      c.s = forgetS(c.d, c.s, r);
      c.state = 'relearning';
      c.lapses += 1;
    } else {
      c.s = recallS(c.d, c.s, r, g);
    }
  }

  c.reps += 1;
  c.last = now;
  if (c.state === 'review') {
    c.ivl = daysFor(c.s);
    c.due = now + c.ivl * DAY;
  } else {
    c.ivl = 0;
    c.due = now + (c.state === 'relearning' && g >= 2 ? 10 * MIN : steps[Math.min(g, 3)]);
  }
  return c;
}

export function isLearned(c) {
  return !!c && c.state === 'review' && c.ivl >= LEARNED_DAYS;
}

// Short label for the button: "1 min", "10 min", "3 d", "2 mo"
export function preview(c, g, now = Date.now()) {
  const n = review(c, g, now);
  const ms = n.due - now;
  if (ms < DAY) return Math.round(ms / MIN) + ' min';
  const d = Math.round(ms / DAY);
  return d < 31 ? d + ' d' : (d / 30).toFixed(d < 300 ? 1 : 0).replace('.0', '') + ' mo';
}
