# metronome — guidance for Claude Code

Read this before working in `metronome/`, a dependency-free browser metronome whose tempo moves only along the traditional Maelzel markings. It is authored directly in this repo (no build step). Serve over HTTP (`python3 -m http.server 8000`, then open `/metronome/`) because it uses ES modules.

## Files

- `tempo.js` — **pure, DOM-free** model: `MARKINGS`, `termFor`, `stepRung`, ramp math, subdivision counts. Keep it free of DOM, Web Audio, and storage so it stays testable in Node.
- `audio.js` — `Metronome` class: Web Audio lookahead scheduler and oscillator click synthesis. Imports only `tempo.js`.
- `app.js` — controller: DOM wiring, repeat guard, keyboard shortcuts, persistence, wake lock.
- `index.html` / `style.css` — the UI shell and maroon theme (light and dark via `prefers-color-scheme`).

## Invariants you MUST preserve

1. **State is a rung index, never a free BPM.** `state.rung` indexes `MARKINGS`. Every tempo the app can play is a real marking. Do not add a free-entry BPM field or a tap-tempo control. Both were explicitly ruled out.
2. **Subdivision defaults to `off`.** `off` means one click per beat. Keep the default and keep the setting persisted.
3. **Timing comes from `AudioContext.currentTime`, never from `setInterval` callbacks.** The `setInterval` only wakes the scheduler, which queues clicks within `LOOKAHEAD_S` (0.1 s). Do not schedule clicks inside the UI event path.
4. **Tempo changes apply to the next click the scheduler queues**, which can lag up to the lookahead window. Do not add a restart or gap on tempo change.
5. **`AudioContext` is created or resumed only inside a user gesture** (the Start button). iOS requires this.
6. **The repeat guard is per control, timestamp-based.** `guarded()` in `app.js` ignores a second click on the same control within `state.guardMs` (default 400 ms; choices 0/250/400/700). Step, ramp, and Start/Stop buttons are guarded. Keyboard shortcuts route through `button.click()` so they share the guard.
7. **Activation is `click`, never `pointerdown`.** Browsers only fire `click` when the release lands on the same element, which is what protects a tremor-shaky press from firing by accident.
8. **No sliders, drags, swipes, long-presses, or small steppers.** Every control is at least 56px tall (`--min-target`). Volume and subdivision are segmented buttons. Start/stop is the largest control.
9. **The lock-while-playing mode is intentionally absent.** The user declined it. Do not reintroduce it.
10. **Persistence is one `localStorage` key, `metronome-v1:settings`.** `sanitize()` coerces anything read back into a valid settings object, so a corrupt or hand-edited value falls back to defaults. Storage access is wrapped in try/catch. Bump the `v1` suffix and add a migration if the shape changes incompatibly.
11. **No dependencies and no audio files.** Clicks are oscillator envelopes. Do not add a library or sample assets.
12. **The ramp is a one-way step toward the target.** `nextRampRung` moves one marking toward `rampTarget` in whichever direction is needed, and stops at the target. The button disables there.

## DOM contract (used by tests and docs)

- `#bpm` (output), `#term`, `#rung-info`, `#beats` (dot container, `.beat-dot`, `.downbeat`, `.active`)
- `#toggle` (Start/Stop, `aria-pressed`), `#slower`, `#faster`
- `#ramp-start`, `#ramp-target` (selects of rung indices), `#ramp-progress`, `#ramp-text`, `#ramp-next`, `#ramp-reset`
- `#beats-per-bar`, `#accent`, radio groups `subdivision`, `sound`, `volume`, `#guard`
- `#announce` (visually hidden live region; only user-driven tempo changes are announced, never each beat)

## Testing

There is no repo test runner. Verify `tempo.js` by copying it to a `.mjs` file and running assertions in Node. Verify the UI with Playwright in a phone viewport (the pre-installed Chromium works with `--no-sandbox`). Check for console errors, rapid double-taps on Faster (only one marking should advance), Start/Stop, and that settings survive a reload.

## Homepage listing

The homepage gallery (`index.html`) is generated from `_data/apps.yml`, not from a directory scan. The metronome has an entry under the Music category. Any new app needs an entry there as well as its directory, or it stays reachable only by direct URL.
