/* ============================================================
   Metronome — controller
   Wires the DOM to tempo.js (the model) and audio.js (the engine).
   The only tempo state is `state.rung`, a rung index into MARKINGS.

   Ramp: while `state.rampMode` is false the ramp follows the tempo
   (target = current tempo, start = RAMP_LEAD_STEPS below it) and is
   re-derived in setRung(). While it is true, start and target are
   frozen until End ramp.

   Recent tempi: a tempo is recorded only after playback has run
   continuously at that tempo for RECENT_DWELL_MS, and never in ramp
   mode. One timer, armRecentTimer(), enforces that.
   ============================================================ */

import {
  MARKINGS, LAST_RUNG, SUBDIVISIONS, RAMP_LEAD_STEPS,
  clampRung, bpmOf, termFor, stepRung, nextRampRung, rampProgress,
  rampRemaining, defaultRampStart, cleanRecent, pushRecent,
} from './tempo.js';
import { Metronome } from './audio.js';

const STORAGE_KEY = 'metronome-v1:settings';
const RECENT_DWELL_MS = 30000;

const RAMP_HINT_OFF =
  `Target follows the current tempo; Start is ${RAMP_LEAD_STEPS} markings below. Press Start ramp to begin.`;
const RAMP_HINT_ON = 'Start low, then move up one marking at a time to your target.';

const DEFAULTS = Object.freeze({
  rung: 10,          // 60 BPM
  rampMode: false,
  rampStart: 6,      // 52 BPM: RAMP_LEAD_STEPS below 60
  rampTarget: 10,    // 60 BPM: follows the tempo while rampMode is false
  recent: [],
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
  const out = { ...DEFAULTS, recent: [] };
  if (!raw || typeof raw !== 'object') return out;
  const int = (v, lo, hi) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  out.rung = clampRung(int(raw.rung, 0, LAST_RUNG) ?? DEFAULTS.rung);
  out.rampMode = typeof raw.rampMode === 'boolean' ? raw.rampMode : DEFAULTS.rampMode;
  out.rampStart = clampRung(int(raw.rampStart, 0, LAST_RUNG) ?? defaultRampStart(out.rung));
  // Outside ramp mode the target is always the current tempo.
  out.rampTarget = out.rampMode
    ? clampRung(int(raw.rampTarget, 0, LAST_RUNG) ?? out.rung)
    : out.rung;
  out.recent = cleanRecent(raw.recent);
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
    return sanitize(null);
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
  tempoPanel: $('tempo-panel'),
  bpm: $('bpm'),
  tempoSelect: $('tempo-select'),
  term: $('term'),
  rungInfo: $('rung-info'),
  beats: $('beats'),
  toggle: $('toggle'),
  slower: $('slower'),
  faster: $('faster'),
  recentTempi: $('recent-tempi'),
  rampHint: $('ramp-hint'),
  rampBegin: $('ramp-begin'),
  rampRunning: $('ramp-running'),
  rampStart: $('ramp-start'),
  rampTarget: $('ramp-target'),
  rampProgress: $('ramp-progress'),
  rampText: $('ramp-text'),
  rampNext: $('ramp-next'),
  rampReset: $('ramp-reset'),
  rampEnd: $('ramp-end'),
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

/** One option per marking: value is the rung, text is "BPM · term". */
function buildTempoOptions() {
  el.tempoSelect.replaceChildren(...MARKINGS.map((bpm, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${bpm} BPM · ${termFor(bpm)}`;
    return opt;
  }));
}

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

/**
 * Rebuild the recent buttons only when the list changes, so a button that
 * was just tapped keeps keyboard focus. Otherwise just move aria-pressed.
 */
function renderRecent() {
  const key = state.recent.join(',');
  if (el.recentTempi.dataset.key !== key) {
    el.recentTempi.dataset.key = key;
    if (state.recent.length === 0) {
      const note = document.createElement('p');
      note.className = 'hint recent-empty';
      note.textContent = 'Tempos you play for 30 seconds show up here.';
      el.recentTempi.replaceChildren(note);
    } else {
      el.recentTempi.replaceChildren(...state.recent.map((rung) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recent-btn';
        btn.dataset.rung = String(rung);
        btn.textContent = String(bpmOf(rung));
        return btn;
      }));
    }
  }
  for (const btn of el.recentTempi.querySelectorAll('button[data-rung]')) {
    const rung = Number(btn.dataset.rung);
    btn.setAttribute('aria-pressed', String(rung === state.rung));
    btn.setAttribute('aria-label', `${bpmOf(rung)} BPM, ${termFor(bpmOf(rung))}`);
  }
}

function render() {
  const bpm = bpmOf(state.rung);
  const term = termFor(bpm);

  el.bpm.textContent = String(bpm);
  el.tempoSelect.value = String(state.rung);
  el.term.textContent = term;
  el.rungInfo.textContent = `Marking ${state.rung + 1} of ${MARKINGS.length}`
    + (state.rampMode ? '\u00a0· Ramp\u00a0mode' : '');
  el.tempoPanel.classList.toggle('ramp-active', state.rampMode);

  el.toggle.textContent = metronome.playing ? 'Stop' : 'Start';
  el.toggle.setAttribute('aria-pressed', String(metronome.playing));

  el.slower.disabled = state.rung === 0;
  el.faster.disabled = state.rung === LAST_RUNG;

  renderRecent();

  el.rampStart.value = String(state.rampStart);
  el.rampTarget.value = String(state.rampTarget);
  el.rampHint.textContent = state.rampMode ? RAMP_HINT_ON : RAMP_HINT_OFF;
  el.rampBegin.hidden = state.rampMode;
  el.rampRunning.hidden = !state.rampMode;

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

/** Outside ramp mode the ramp follows the tempo. Called on every tempo change. */
function followTempoInRamp() {
  state.rampTarget = state.rung;
  state.rampStart = defaultRampStart(state.rung);
}

/**
 * Change the tempo to a rung. This is the only place the ramp is re-derived
 * (outside ramp mode), and the only place the recent timer is re-armed on
 * a tempo change. Saves and re-renders; optionally announces.
 */
function setRung(rung, { announce = true } = {}) {
  state.rung = clampRung(rung);
  if (!state.rampMode) followTempoInRamp();
  saveState();
  render();
  armRecentTimer();
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
  armRecentTimer();
  render();
}

/* ---- Recent tempi ---------------------------------------- */
/*
   One timer. It is armed when playback starts, when the tempo changes,
   and when ramp mode ends. It is cancelled when playback stops or ramp
   mode starts. When it fires, the current tempo goes to the front of the
   recent list. Each change restarts the 30 seconds, so a tempo only counts
   after the metronome has played continuously at it.
*/
let recentTimer = null;

function armRecentTimer() {
  if (recentTimer !== null) clearTimeout(recentTimer);
  recentTimer = null;
  if (!metronome.playing || state.rampMode) return;
  recentTimer = setTimeout(() => {
    recentTimer = null;
    if (!metronome.playing || state.rampMode) return;
    state.recent = pushRecent(state.recent, state.rung);
    saveState();
    render();
  }, RECENT_DWELL_MS);
}

/* Recent buttons are rebuilt on change, so the repeat guard is keyed by
   tempo (rung) rather than by button, and clicks are delegated. */
const recentLast = new Map();

el.recentTempi.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-rung]');
  if (!btn) return;
  const rung = Number(btn.dataset.rung);
  const now = performance.now();
  const last = recentLast.get(rung);
  if (last !== undefined && now - last < state.guardMs) return;
  recentLast.set(rung, now);
  setRung(rung);
});

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
   state.guardMs. Step, ramp, start/stop, and recent-tempo controls
   are guarded.
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

/* Tempo picker: the select is laid over the big number. */
el.tempoSelect.addEventListener('change', () => {
  setRung(Number(el.tempoSelect.value));
});

/* Practice ramp. Begin freezes the current start and target; the tempo
   jumps to the start, and playback is left alone. */
guarded(el.rampBegin, () => {
  state.rampMode = true;
  setRung(state.rampStart);
});

guarded(el.rampEnd, () => {
  state.rampMode = false;
  setRung(state.rung, { announce: false }); // re-derives start and target
});

guarded(el.rampNext, () => setRung(nextRampRung(state.rung, state.rampTarget)));
guarded(el.rampReset, () => setRung(state.rampStart));

el.rampStart.addEventListener('change', () => {
  state.rampStart = clampRung(el.rampStart.value);
  if (state.rampMode) {
    setRung(state.rampStart);
  } else {
    // Outside ramp mode a chosen Start sticks until the tempo changes.
    saveState();
    render();
  }
});

el.rampTarget.addEventListener('change', () => {
  const target = clampRung(el.rampTarget.value);
  if (state.rampMode) {
    state.rampTarget = target;
    saveState();
    render();
  } else {
    // Outside ramp mode the target is the tempo itself.
    setRung(target);
  }
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

/* Keyboard: Space start/stop, arrows step, Home returns to the ramp start
   (ramp mode only). Keys are ignored while a form control or button has
   focus, because those already respond natively (and arrows change selects). */
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
      if (!state.rampMode) break;
      e.preventDefault();
      fire(el.rampReset);
      break;
    default:
      break;
  }
});

/* ---- Initial render -------------------------------------- */

function init() {
  buildTempoOptions();
  buildRungOptions(el.rampStart);
  buildRungOptions(el.rampTarget);

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
