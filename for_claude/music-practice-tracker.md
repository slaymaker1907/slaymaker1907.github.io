# music-practice-tracker — guidance for Claude Code

Read this before working in `music-practice-tracker/`, a dependency-free browser SPA that randomizes and tracks progress through musical exercises (instrument → book → chapter → exercise range).

Unlike `d4cubeoptim/`, this app has **no external source repository** — it is authored directly in this repo, so edit the files here in place. There is no build step and no repo test runner; verify changes in a browser (see Testing below). Because it uses IndexedDB and ES-module `import`, it must be served over HTTP, not opened as `file://`: `python3 -m http.server 8000` from the repo root, then open `/music-practice-tracker/`.

## Architecture

Four files, plain ES modules, no framework:

- `index.html` — the whole UI shell + the details `<dialog>`. Loads exactly one script, `<script type="module" src="./app.js">`; `app.js` imports `db.js` itself (do not add a second script tag).
- `style.css` — styling only (light/dark via `prefers-color-scheme`).
- `db.js` — the IndexedDB data layer: constants, the document factory, and the optimistic-concurrency write helper. See its header comment.
- `app.js` — the controller: wires the DOM to `db.js` (autoload, randomize, checkbox, modal, throttled comment writes, the recency timer).

## Invariants you MUST preserve

1. **The database GUID is hardcoded and permanent.** `APP_GUID` in `db.js` is a fixed string; `DB_NAME = \`music-practice-tracker-${APP_GUID}\``. Never regenerate it at runtime. IndexedDB is per-origin and every app on `slaymaker1907.github.io` shares that namespace — the GUID exists solely to avoid colliding with *other* apps' databases. If you change the store shape, bump `DB_VERSION` and add an `onupgradeneeded` migration; do not rename the DB.

2. **One denormalized document per chapter.** A single object store `chapters`, keyPath `["instrument","book","chapter"]`, index `by_last_used_at`. All of a chapter's state — the shuffled `randomization`, `last_range`, recency counters, and per-exercise `{completed, completed_at, comment}` under `exercises` — lives in that one document. This denormalization is deliberate; don't add stores or split it out without a strong reason.

3. **All writes go through `mutateChapter(key, expectedVersion, mutator)`.** It reads the doc, compares the integer `version` inside the same transaction, and on a match applies the mutator, increments `version`, and stamps `updated_at`; on a mismatch it throws `VersionConflictError` carrying the fresh doc. `app.js` wraps this in an `occ()` helper that adopts the fresh doc and retries once (per-field last-write-wins across tabs). Never call `store.put()` directly — route every new write through `occ()`/`mutateChapter`, or you break cross-tab concurrency safety.

4. **Text edits are throttled to ≤1 write per 250ms** (leading write + guaranteed trailing flush), with an immediate flush on modal Save and on `visibilitychange → hidden`. Keep this; do not write on every keystroke.

5. **Autoload has no button.** Typing a triple that matches a saved document loads it automatically. There is a race guard that ignores a stale `getChapter` result if the inputs changed during the `await` — preserve it when touching the input handlers.

6. **Recency timing.** `last_used_at` is bumped 60s after a *top-level* field change (instrument/book/chapter/min/max) or immediately on Randomize; comment and checkbox edits must never bump it. `use_count` bumps only on Randomize.

7. **A chapter has exactly one active range.** Randomize confirms (via `window.confirm`) before mutating, then rebuilds `exercises` from scratch to contain only the new min/max range's names — anything outside the new range is dropped entirely, comment included. `completed`/`completed_at` are always reset to `false`/`null` on every Randomize, chapter-wide; `comment` carries over only for exercise names present in both the old and new range. Exercise identity is the string `exercise_name` (the map key doubles as the display label and supports future non-numeric names with no migration).

8. **Reset Form (button id `clear-btn`) is a UI-only reset** — it clears inputs and the visible list and deletes nothing; re-entering the triple autoloads the saved document back. **Delete** (`#delete-btn`) is the destructive counterpart — after a `window.confirm`, it permanently removes the chapter document via `deleteChapter(key)` in `db.js`, which intentionally bypasses `mutateChapter`'s OCC check (delete removes whatever is stored regardless of version), then resets the form the same way.

9. Triple values are **trimmed** before they key/persist a document, so `"Piano "` and `"Piano"` collapse to one record. Keep keying consistent with this.

## DOM contract (keep `index.html` and `app.js` in sync)

Inputs `#instrument #book #chapter` (+ datalists `#instrument-list #book-list #chapter-list`), `#min #max`, buttons `#randomize-btn #clear-btn #delete-btn`, `#progress-counter`, `#exercise-list`, and the modal `#details-modal` with `#modal-title #modal-check #modal-comment #modal-save #modal-cancel`. Rows are built in `app.js` as `.exercise-row` (+ `.completed`) containing `.ex-check`, `.ex-name`, `.ex-oneline`, and `.ex-details` (labeled "Edit"). `.ex-oneline` is directly editable (typed edits go through the same 250ms throttle as the modal) whenever the comment is single-line or empty; it becomes `[readonly]` once the comment has a second line, and clicking it while locked (or clicking `.ex-details` regardless of lock state) opens the modal. Change an id/class in one file and you must change it in both.

## Testing

No repo test runner. Serve locally and check the full flow by hand or with a headless-Chromium script: Randomize a range → tick some checkboxes → add a multi-line comment in the modal → reload and confirm everything persisted → open a second tab on the same chapter and confirm concurrent edits both survive (the OCC path). Also check: typing directly into a row's one-line box persists without opening the modal; a comment that gains a second line in the modal locks the row box on save; re-randomizing an overlapping range clears all checkboxes chapter-wide, drops exercises outside the new range, and keeps comments for exercise names still in range; Delete removes the IndexedDB record and clears the form. Inspect Application → IndexedDB in DevTools to confirm there is exactly one `chapters` store and that `version` advances on writes.

## Deploy

Push to `master`; GitHub Pages publishes automatically. There is no worker/model version to bump (unlike d4cubeoptim) — the only versioned artifact is `DB_VERSION`, and only when the schema changes.
