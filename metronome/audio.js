/* ============================================================
   Metronome — audio engine
   Web Audio lookahead scheduler. Clicks are synthesized with
   oscillators (no sample files). Timing is taken from
   AudioContext.currentTime, not from setInterval, so UI jank
   cannot change the tempo; setInterval only wakes the scheduler.
   ============================================================ */

import { clickInterval, subdivisionCount } from './tempo.js';

const SCHEDULE_TICK_MS = 25;   // how often the scheduler wakes
const LOOKAHEAD_S = 0.1;       // how far ahead clicks are queued
const START_DELAY_S = 0.05;    // small pad so the first click is not late

/** Volume buttons map to these linear gains. */
export const VOLUME_GAINS = Object.freeze({ 1: 0.2, 2: 0.45, 3: 0.7, 4: 1.0 });

/**
 * Click voices. `freq` and `dur` are for ordinary beats; an accented
 * downbeat is raised by ACCENT_RATIO and played at full level, and a
 * subdivision click is played at SUBDIVISION_GAIN of the beat level.
 */
export const SOUNDS = Object.freeze({
  wood:  { type: 'sine', freq: 1000, dur: 0.035, peak: 0.9 },
  beep:  { type: 'sine', freq: 880,  dur: 0.080, peak: 0.6 },
  soft:  { type: 'triangle', freq: 600, dur: 0.045, peak: 0.7 },
});

const ACCENT_RATIO = 1.5;
const SUBDIVISION_GAIN = 0.35;

export class Metronome {
  /**
   * @param {object} opts
   * @param {() => {bpm:number, beatsPerBar:number, accent:boolean,
   *               subdivision:string, sound:string, volume:number}} opts.getConfig
   *        Read fresh on every scheduling pass so changes apply on the next click.
   * @param {(beatIndex:number) => void} opts.onTick
   *        Called close to the moment each click sounds (for the visual beat dots).
   */
  constructor({ getConfig, onTick }) {
    this.getConfig = getConfig;
    this.onTick = onTick;
    this.ctx = null;
    this.timer = null;
    this.nextTime = 0;
    this.beatIndex = 0;
    this.subIndex = 0;
    this.visualTimers = new Set();
  }

  get playing() {
    return this.timer !== null;
  }

  /** Must be called from a user gesture (iOS requires it to unlock audio). */
  async start() {
    if (this.playing) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.beatIndex = 0;
    this.subIndex = 0;
    this.nextTime = this.ctx.currentTime + START_DELAY_S;
    this.timer = setInterval(() => this.schedule(), SCHEDULE_TICK_MS);
    this.schedule();
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.visualTimers) clearTimeout(t);
    this.visualTimers.clear();
  }

  /** Queue every click that falls inside the lookahead window. */
  schedule() {
    if (!this.ctx) return;
    const cfg = this.getConfig();
    const subs = subdivisionCount(cfg.subdivision);
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;

    while (this.nextTime < horizon) {
      // Keep the beat counter sane if the subdivision changed mid-bar.
      if (this.subIndex >= subs) {
        this.subIndex = 0;
        this.beatIndex = (this.beatIndex + 1) % cfg.beatsPerBar;
      }
      if (this.beatIndex >= cfg.beatsPerBar) this.beatIndex = 0;

      const isBeat = this.subIndex === 0;
      const isDownbeat = isBeat && this.beatIndex === 0;
      this.playClick(this.nextTime, cfg, isBeat, isDownbeat);
      if (isBeat) this.queueVisual(this.nextTime, this.beatIndex);

      this.nextTime += clickInterval(cfg.bpm, cfg.subdivision);
      this.subIndex += 1;
      if (this.subIndex >= subs) {
        this.subIndex = 0;
        this.beatIndex = (this.beatIndex + 1) % cfg.beatsPerBar;
      }
    }
  }

  playClick(when, cfg, isBeat, isDownbeat) {
    const voice = SOUNDS[cfg.sound] || SOUNDS.wood;
    const level = VOLUME_GAINS[cfg.volume] ?? VOLUME_GAINS[3];
    let freq = voice.freq;
    let gain = voice.peak * level;

    if (!isBeat) {
      gain *= SUBDIVISION_GAIN;
    } else if (isDownbeat && cfg.accent) {
      freq *= ACCENT_RATIO;
      gain = Math.min(1, voice.peak * 1.1) * level;
    }

    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(freq, when);

    // Short attack and exponential decay avoids clicks from the envelope itself.
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), when + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + voice.dur);

    osc.connect(amp).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + voice.dur + 0.02);
  }

  queueVisual(when, beatIndex) {
    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    const t = setTimeout(() => {
      this.visualTimers.delete(t);
      if (this.playing) this.onTick(beatIndex);
    }, delayMs);
    this.visualTimers.add(t);
  }
}
