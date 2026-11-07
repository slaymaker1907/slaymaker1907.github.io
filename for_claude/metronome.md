# metronome — guidance for Claude Code

Read this before working in `metronome/`, a dependency-free browser metronome whose tempo moves only along the traditional Maelzel markings. It is authored directly in this repo (no build step). Serve over HTTP (`python3 -m http.server 8000`, then open `/metronome/`) because it uses ES modules.

## Files

- `tempo.js` — **pure, DOM-free** model: `MARKINGS`, `termFor`, `stepRung`, ramp math (`defaultRampStart`, `RAMP_LEAD_STEPS`), recent-tempi helpers (`pushRecent`, `cleanRecent`), subdivision counts. Keep it free of DOM, Web Audio, and storage so it stays testable in Node.
- `audio.js` — `Metronome` class: Web Audio lookahead scheduler and oscillator click synthesis. Imports only `tempo.js`.
- `app.js` — controller: DOM wiring, repeat guard, keyboard shortcuts, persistence, wake lock.
- `index.html` / `style.css` — the UI shell and maroon theme (light and dark via `prefers-color-scheme`).

## Invariants you MUST preserve

1. **State is a rung index, never a free BPM.** `state.rung` indexes `MARKINGS`. Every tempo the app can play is a real marking. The only way to pick a tempo is the tempo picker (the `#tempo-select` options), the step buttons, a recent-tempo chip, or a ramp control, and each one yields a marking. Do not add free BPM entry, free BPM storage, or a tap-tempo control. Tap-tempo was explicitly ruled out.
2. **Subdivision defaults to `off`.** `off` means one click per beat. Keep the default and keep the setting persisted.
3. **Timing comes from `AudioContext.currentTime`, never from `setInterval` callbacks.** The `setInterval` only wakes the scheduler, which queues clicks within `LOOKAHEAD_S` (0.1 s). Do not schedule clicks inside the UI event path.
4. **Tempo changes apply to the next click the scheduler queues**, which can lag up to the lookahead window. Do not add a restart or gap on tempo change.
5. **`AudioContext` is created or resumed only inside a user gesture** (the Start button). iOS requires this. `Metronome.start()` also calls `requestPlaybackSession()` *before its first `await`*, so it still runs inside the tap. That puts iOS in the "playback" audio session so the clicks are audible with the ringer/silent switch on silent. Without it, iOS uses the "ambient" session, and the switch mutes the built-in speaker but not headphones. Safari 17+ does this through `navigator.audioSession.type = 'playback'`. Older iOS falls back to looping a generated silent WAV in an `<audio>` element (`keepAlive`), which `stop()` pauses. Do not move this call after an `await`, and do not remove it.
6. **The repeat guard is per control, timestamp-based.** `guarded()` in `app.js` ignores a second click on the same control within `state.guardMs` (default 400 ms; choices 0/250/400/700). Step, ramp (Start ramp, Next step, Back to start, End ramp), and Start/Stop buttons are guarded. Recent-tempo chips are rebuilt on change, so they are delegated from `#recent-tempi` and guarded per tempo (rung) instead of per button. Keyboard shortcuts route through `button.click()` so they share the guard.
7. **Activation is `click`, never `pointerdown`.** Browsers only fire `click` when the release lands on the same element, which is what protects a tremor-shaky press from firing by accident.
8. **No sliders, drags, swipes, long-presses, or small steppers.** Every control is at least 56px tall (`--min-target`). Volume and subdivision are segmented buttons. Start/stop is the largest control.
9. **Tempo picker: the big number opens a native select, and nothing else changes the tempo this way.** `#bpm` sits inside `.tempo-picker` with a chevron, and `#tempo-select` is absolutely positioned over the whole picker at `opacity: 0`, so a tap lands on the select and iOS shows its wheel. Its `font-size` must stay at 16px or iOS zooms. Options are `${bpm} BPM · ${term}` with the rung as the value. `change` calls `setRung()`, and `render()` keeps `select.value` in sync. The picker has a visible focus ring through `.tempo-picker:has(#tempo-select:focus-visible)`. Do not bring back press-and-hold typing.

9a. **The lock-while-playing mode is intentionally absent.** The user declined it. Do not reintroduce it.

9b. **Recent tempi: a tempo counts only after 30 s of continuous play at that tempo, and never in ramp mode.** One timer, `armRecentTimer()` in `app.js` (`RECENT_DWELL_MS = 30000`), implements it. It is re-armed when playback starts, when `setRung()` changes the tempo, and when End ramp runs. It is cancelled when playback stops or Start ramp runs. Its callback re-checks `metronome.playing` and `state.rampMode`. Each re-arm restarts the 30 s, so a tempo that was just changed does not count yet. The callback calls `pushRecent()`, which puts the tempo at the front, dedupes, and caps at 6. Taps on a chip call `setRung()` and do not add a second entry. `state.recent` is persisted and sanitized with `cleanRecent()`.

9c. **Ramp mode is explicit and persisted as `state.rampMode`.** While it is false, the ramp follows the tempo. `setRung()` calls `followTempoInRamp()`, which sets `rampTarget = rung` and `rampStart = defaultRampStart(rung)`, 4 markings below (`RAMP_LEAD_STEPS`). A Start picked outside ramp mode does not move the tempo, so it sticks until the tempo next changes. A Target picked outside ramp mode is the tempo, so it calls `setRung()`. While it is true, `setRung()` does not re-derive, so Start and Target stay frozen. Start ramp sets `rampMode = true` first, then `setRung(rampStart)`. It does not touch playback. End ramp sets `rampMode = false`, then `setRung(rung)`, which re-derives and re-arms the timer. On load, `sanitize()` forces `rampTarget = rung` when ramp mode is off.

9d. **Ramp mode is shown on `#tempo-panel`.** `render()` toggles `.ramp-active` on it, and `#rung-info` appends " · Ramp mode" (joined with non-breaking spaces so "Ramp mode" never splits across lines). `.ramp-active` shows the SVG flames (`.ramp-flames.left/.right`, built from one `<symbol id="flame-shape">` in the tempo panel), turns the panel border orange (`--ramp-border`), and widens the panel's side padding so the flames never sit under the number or the beat dots. The flames are decorative (`aria-hidden`). The text in `#rung-info` is what carries the meaning. The flicker animation runs only under `prefers-reduced-motion: no-preference`. Flame colors are the `--flame-outer/-mid/-core` tokens, set with `style="fill: var(...)"` on the symbol's paths, because CSS selectors do not reach into `<use>` shadow trees but custom properties do inherit into them.
10. **Persistence is one `localStorage` key, `metronome-v1:settings`.** `sanitize()` coerces anything read back into a valid settings object, so a corrupt or hand-edited value falls back to defaults. Storage access is wrapped in try/catch. Bump the `v1` suffix and add a migration if the shape changes incompatibly.
11. **No dependencies and no audio files.** Clicks are oscillator envelopes. The only `<audio>` source is the silent-session WAV, which `silentWavUrl()` builds in memory as a Blob URL. Do not add a library or sample assets.
12. **The ramp is a one-way step toward the target.** `nextRampRung` moves one marking toward `rampTarget` in whichever direction is needed, and stops at the target. The button disables there.
13. **Home is ramp-only.** The Home shortcut fires `#ramp-reset` only while `state.rampMode` is true.

## DOM contract (used by tests and docs)

- `#tempo-panel` (section; gets class `.ramp-active` while ramp mode is on), `.tempo-picker` (wrapper), `#bpm` (span showing the number), `#tempo-select` (native select over the picker, `aria-label="Tempo"`, option value = rung), `#term`, `#rung-info` (ends with " · Ramp mode" while ramp mode is on), `.ramp-flames.left`/`.ramp-flames.right` (decorative SVG flames, visible only under `.ramp-active`), `#beats` (dot container, `.beat-dot`, `.downbeat`, `.active`)
- `#toggle` (Start/Stop, `aria-pressed`), `#slower`, `#faster`
- `#recent-tempi` (container; rebuilt on change; `button[data-rung]` chips with `aria-pressed`; the empty-state `.recent-empty` paragraph when there are none)
- `#ramp-hint` (text swaps with ramp mode), `#ramp-begin` (Start ramp, shown only when ramp mode is off), `#ramp-running` (wrapper, shown only when ramp mode is on, holds the progress and buttons below)
- `#ramp-start`, `#ramp-target` (selects of rung indices), `#ramp-progress`, `#ramp-text`, `#ramp-next`, `#ramp-reset`, `#ramp-end` (End ramp)
- `#beats-per-bar`, `#accent`, radio groups `subdivision`, `sound`, `volume`, `#guard`
- `#announce` (visually hidden live region; only user-driven tempo changes are announced, never each beat)

## Testing

There is no repo test runner. Verify `tempo.js` by copying it to a `.mjs` file and running assertions in Node. Verify the UI with Playwright in a phone viewport (the pre-installed Chromium works with `--no-sandbox`). Check for console errors, rapid double-taps on Faster (only one marking should advance), Start/Stop, and that settings survive a reload.

## Homepage listing

The homepage gallery (`index.html`) is generated from `_data/apps.yml`, not from a directory scan. The metronome has an entry under the Music category. Any new app needs an entry there as well as its directory, or it stays reachable only by direct URL.
