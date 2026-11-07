/* ============================================================
   Metronome — tempo model (pure, DOM-free, no side effects)

   Everything about *which* tempos exist and how the practice ramp
   moves lives here so it can be tested in Node. The audio layer
   (audio.js) and the UI (app.js) import from this file; nothing in
   here touches the DOM, Web Audio, or storage.

   Invariant: the app stores a RUNG INDEX into MARKINGS, never a free
   BPM, so every tempo the metronome can ever play is a real marking.
   ============================================================ */

/** The traditional Maelzel metronome scale, slowest to fastest. */
export const MARKINGS = Object.freeze([
  40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60,
  63, 66, 69, 72,
  76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120,
  126, 132, 138, 144,
  152, 160, 168, 176, 184, 192, 200, 208,
]);

export const LAST_RUNG = MARKINGS.length - 1;

/** Italian tempo terms, keyed by the lowest BPM they cover. */
const TERMS = Object.freeze([
  [40, 'Grave'],
  [46, 'Largo'],
  [60, 'Larghetto'],
  [66, 'Adagio'],
  [76, 'Andante'],
  [108, 'Moderato'],
  [120, 'Allegro'],
  [168, 'Presto'],
  [200, 'Prestissimo'],
]);

/** Subdivision choices. "off" is the default: one click per beat. */
export const SUBDIVISIONS = Object.freeze({
  off: 1,
  '8': 2,
  '3': 3,
  '16': 4,
});

/** Clamp any value to a valid rung index (rounds, NaN becomes 0). */
export function clampRung(index) {
  const n = Math.round(Number(index));
  if (!Number.isFinite(n)) return 0;
  return Math.min(LAST_RUNG, Math.max(0, n));
}

/** The BPM of a rung index. */
export function bpmOf(rung) {
  return MARKINGS[clampRung(rung)];
}

/** The rung index whose marking is nearest to a BPM value. */
export function rungNearest(bpm) {
  let best = 0;
  for (let i = 1; i < MARKINGS.length; i++) {
    if (Math.abs(MARKINGS[i] - bpm) < Math.abs(MARKINGS[best] - bpm)) best = i;
  }
  return best;
}

/** Move one marking up (delta > 0) or down (delta < 0), clamped to the ends. */
export function stepRung(rung, delta) {
  return clampRung(clampRung(rung) + Math.sign(delta));
}

/** The Italian term for a BPM. */
export function termFor(bpm) {
  let term = TERMS[0][1];
  for (const [floor, name] of TERMS) {
    if (bpm >= floor) term = name;
  }
  return term;
}

/**
 * One step of the practice ramp: move a single marking from `current`
 * toward `target`. Returns `current` unchanged once the target is reached.
 */
export function nextRampRung(current, target) {
  const c = clampRung(current);
  const t = clampRung(target);
  if (c === t) return c;
  return c + Math.sign(t - c);
}

/**
 * How far along the ramp we are, 0..1. `start` and `target` may be in
 * either order (a ramp can also slow down). When start equals target
 * the ramp is trivially complete.
 */
export function rampProgress(current, start, target) {
  const span = Math.abs(clampRung(target) - clampRung(start));
  if (span === 0) return 1;
  const done = Math.abs(clampRung(current) - clampRung(start));
  return Math.min(1, Math.max(0, done / span));
}

/** How many rungs remain between `current` and `target`. */
export function rampRemaining(current, target) {
  return Math.abs(clampRung(target) - clampRung(current));
}

/** Clicks per beat for a subdivision key ("off" | "8" | "3" | "16"). */
export function subdivisionCount(key) {
  return Object.prototype.hasOwnProperty.call(SUBDIVISIONS, key)
    ? SUBDIVISIONS[key]
    : 1;
}

/** Seconds between two consecutive clicks at a given BPM and subdivision. */
export function clickInterval(bpm, subdivisionKey) {
  return 60 / bpm / subdivisionCount(subdivisionKey);
}
