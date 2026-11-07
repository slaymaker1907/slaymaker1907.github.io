/* ============================================================
   Metronome — controller
   Wires the DOM to tempo.js (the model) and audio.js (the engine).
   The only tempo state is `state.rung`, a rung index into MARKINGS.
   ============================================================ */

import {
  MARKINGS, LAST_RUNG, SUBDIVISIONS, clampRung, bpmOf, termFor,
  stepRung, nextRampRung, rampProgress, rampRemaining,
} from './tempo.js';
import { Metronome } from './audio.js';

const STORAGE_KEY = 'metronome-v1:settings';

const DEFAULTS = Object.freeze({
  rung: 10,          // 60 BPM
  rampStart: 10,     // 60 BPM
  rampTarget: 26,    // 120 BPM
  beatsPerBar: 4,
  accent: true,
  subdivision: 'off',
  sound: 'wood',
  volume: 3,
  guardMs: 400,
});

const GUARD_CHOICES = [0, 250, 400, 700];
const SOUND_CHOICES = ['wood', 'beep', 'soft'];
const VOLUME_CHOICES = [1, 2, 3, 4];

/* ---- Persistence ----------------------------------------- */

/** Coerce anything read from storage into a valid settings object. */
function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const int = (v, lo, hi) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  out.rung = clampRung(int(raw.rung, 0, LAST_RUNG) ?? DEFAULTS.rung);
  out.rampStart = clampRung(int(raw.rampStart, 0, LAST_RUNG) ?? DEFAULTS.rampStart);
  out.rampTarget = clampRung(int(raw.rampTarget, 0, LAST_RUNG) ?? DEFAULTS.rampTarget);
  out.beatsPerBar = int(raw.beatsPerBar, 1, 12) ?? DEFAULTS.beatsPerBar;
  out.accent = typeof raw.accent === 'boolean' ? raw.accent : DEFAULTS.accent;
  out.subdivision = Object.prototype.hasOwnProperty.call(SUBDIVISIONS, raw.subdivision)
    ? raw.subdivision : DEFAULTS.subdivision;
  out.sound = SOUND_CHOICES.includes(raw.sound) ? raw.sound : DEFAULTS.sound;
  out.volume = VOLUME_CHOICES.includes(Number(raw.volume)) ? Number(raw.volume) : DEFAULTS.volume;
  out.guardMs = GUARD_CHOICES.includes(Number(raw.guardMs)) ? Number(raw.guardMs) : DEFAULTS.guardMs;
  return out;
}

function loadState() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULTS };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage can be blocked (private mode); the app still works without it. */
  }
}

/* ---- State and elements ---------------------------------- */

const state = loadState();
const $ = (id) => document.getElementById(id);

const el = {
  bpm: $('bpm'),
  term: $('term'),
  rungInfo: $('rung-info'),
  beats: $('beats'),
  toggle: $('toggle'),
  slower: $('slower'),
  faster: $('faster'),
  rampStart: $('ramp-start'),
  rampTarget: $('ramp-target'),
  rampProgress: $('ramp-progress'),
  rampText: $('ramp-text'),
  rampNext: $('ramp-next'),
  rampReset: $('ramp-reset'),
  beatsPerBar: $('beats-per-bar'),
  accent: $('accent'),
  guard: $('guard'),
  announce: $('announce'),
};

const metronome = new Metronome({
  getConfig: () => ({
    bpm: bpmOf(state.rung),
    beatsPerBar: state.beatsPerBar,
    accent: state.accent,
    subdivision: state.subdivision,
    sound: state.sound,
    volume: state.volume,
  }),
  onTick: highlightBeat,
});

/* ---- Rendering ------------------------------------------- */

function buildRungOptions(select) {
  select.replaceChildren(...MARKINGS.map((bpm, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${bpm} BPM`;
    return opt;
  }));
}

function buildBeatDots() {
  const dots = [];
  for (let i = 0; i < state.beatsPerBar; i++) {
    const dot = document.createElement('span');
    dot.className = 'beat-dot' + (i === 0 ? ' downbeat' : '');
    dot.dataset.beat = String(i);
    dots.push(dot);
  }
  el.beats.replaceChildren(...dots);
}

function highlightBeat(beatIndex) {
  for (const dot of el.beats.children) {
    dot.classList.toggle('active', Number(dot.dataset.beat) === beatIndex);
  }
}

function clearBeatHighlight() {
  for (const dot of el.beats.children) dot.classList.remove('active');
}

function render() {
  const bpm = bpmOf(state.rung);
  const term = termFor(bpm);

  el.bpm.textContent = String(bpm);
  el.term.textContent = term;
  el.rungInfo.textContent = `Marking ${state.rung + 1} of ${MARKINGS.length}`;

  el.toggle.textContent = metronome.playing ? 'Stop' : 'Start';
  el.toggle.setAttribute('aria-pressed', String(metronome.playing));

  el.slower.disabled = state.rung === 0;
  el.faster.disabled = state.rung === LAST_RUNG;

  const progress = Math.round(rampProgress(state.rung, state.rampStart, state.rampTarget) * 100);
  el.rampProgress.value = progress;
  el.rampProgress.textContent = `${progress}%`;

  const reached = state.rung === state.rampTarget;
  const remaining = rampRemaining(state.rung, state.rampTarget);
  el.rampText.classList.toggle('reached', reached);
  el.rampText.textContent = reached
    ? `Target reached: ${bpmOf(state.rampTarget)} BPM`
    : `${remaining} ${remaining === 1 ? 'marking' : 'markings'} to go to ${bpmOf(state.rampTarget)} BPM`;
  el.rampNext.disabled = reached;
  el.rampReset.disabled = state.rung === state.rampStart;
}

function announceTempo() {
  el.announce.textContent = `${bpmOf(state.rung)} BPM, ${termFor(bpmOf(state.rung))}`;
}

/* ---- Actions --------------------------------------------- */

/** Change the tempo to a rung. Saves and re-renders; optionally announces. */
function setRung(rung, { announce = true } = {}) {
  state.rung = clampRung(rung);
  saveState();
  render();
  if (announce) announceTempo();
}

async function togglePlayback() {
  if (metronome.playing) {
    metronome.stop();
    clearBeatHighlight();
    releaseWakeLock();
  } else {
    try {
      await metronome.start();
      holdWakeLock();
    } catch {
      el.announce.textContent = 'Audio is not available in this browser.';
    }
  }
  render();
}

/* ---- Screen wake lock (keeps the phone awake while playing) -- */

let wakeLock = null;

async function holdWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null; // Denied or unsupported; playback continues regardless.
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && metronome.playing) holdWakeLock();
});

/* ---- Repeat guard ---------------------------------------- */
/*
   A tremor can produce two clicks where one was meant. After an
   accepted press, the same control ignores further clicks for
   state.guardMs. Only step, ramp, and start/stop controls are guarded.
*/
const lastAccepted = new WeakMap();

function guarded(button, action) {
  button.addEventListener('click', () => {
    const now = performance.now();
    const last = lastAccepted.get(button);
    if (last !== undefined && now - last < state.guardMs) return;
    lastAccepted.set(button, now);
    action();
  });
}

/** Keyboard shortcuts reuse the same guarded actions. */
function fire(button) {
  if (!button.disabled) button.click();
}

/* ---- Wiring ---------------------------------------------- */

guarded(el.toggle, togglePlayback);
guarded(el.faster, () => setRung(stepRung(state.rung, +1)));
guarded(el.slower, () => setRung(stepRung(state.rung, -1)));
guarded(el.rampNext, () => setRung(nextRampRung(state.rung, state.rampTarget)));
guarded(el.rampReset, () => setRung(state.rampStart));

el.rampStart.addEventListener('change', () => {
  state.rampStart = clampRung(el.rampStart.value);
  setRung(state.rampStart);
});

el.rampTarget.addEventListener('change', () => {
  state.rampTarget = clampRung(el.rampTarget.value);
  saveState();
  render();
});

el.beatsPerBar.addEventListener('change', () => {
  state.beatsPerBar = Number(el.beatsPerBar.value);
  saveState();
  buildBeatDots();
});

el.accent.addEventListener('change', () => {
  state.accent = el.accent.checked;
  saveState();
});

el.guard.addEventListener('change', () => {
  state.guardMs = Number(el.guard.value);
  saveState();
});

for (const [name, key] of [['subdivision', 'subdivision'], ['sound', 'sound'], ['volume', 'volume']]) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.addEventListener('change', () => {
      state[key] = key === 'volume' ? Number(input.value) : input.value;
      saveState();
    });
  });
}

/* Keyboard: Space start/stop, arrows step, Home returns to the ramp start.
   Keys are ignored while a form control or button has focus, because
   those already respond natively (and arrows change selects). */
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      fire(el.toggle);
      break;
    case 'ArrowUp':
    case 'ArrowRight':
      e.preventDefault();
      fire(el.faster);
      break;
    case 'ArrowDown':
    case 'ArrowLeft':
      e.preventDefault();
      fire(el.slower);
      break;
    case 'Home':
      e.preventDefault();
      fire(el.rampReset);
      break;
    default:
      break;
  }
});

/* ---- Initial render -------------------------------------- */

function init() {
  buildRungOptions(el.rampStart);
  buildRungOptions(el.rampTarget);
  el.rampStart.value = String(state.rampStart);
  el.rampTarget.value = String(state.rampTarget);

  el.beatsPerBar.replaceChildren(...Array.from({ length: 12 }, (_, i) => {
    const opt = document.createElement('option');
    opt.value = String(i + 1);
    opt.textContent = String(i + 1);
    return opt;
  }));
  el.beatsPerBar.value = String(state.beatsPerBar);

  el.accent.checked = state.accent;
  el.guard.value = String(state.guardMs);

  const check = (name, value) => {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };
  check('subdivision', state.subdivision);
  check('sound', state.sound);
  check('volume', String(state.volume));

  buildBeatDots();
  render();
}

init();
