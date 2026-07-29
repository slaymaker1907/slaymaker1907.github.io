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

2. **One denormalized document per chapter.** A single object store `chapters`, keyPath `["instrument","book","chapter"]`, index `by_last_used_at`. All of a chapter's state — the shuffled `randomization`, `last_range`, `custom_list`, recency counters, and per-exercise `{completed, completed_at, comment}` under `exercises` — lives in that one document. This denormalization is deliberate; don't add stores or split it out without a strong reason.

3. **All writes go through `mutateChapter(key, expectedVersion, mutator)`.** It reads the doc, compares the integer `version` inside the same transaction, and on a match applies the mutator, increments `version`, and stamps `updated_at`; on a mismatch it throws `VersionConflictError` carrying the fresh doc. `app.js` wraps this in an `occ()` helper that adopts the fresh doc and retries once (per-field last-write-wins across tabs). Never call `store.put()` directly — route every new write through `occ()`/`mutateChapter`, or you break cross-tab concurrency safety.

4. **Text edits are throttled to ≤1 write per 250ms** (leading write + guaranteed trailing flush), with an immediate flush on modal Save, on modal open, before either Randomize path, and on `visibilitychange → hidden`. Keep this; do not write on every keystroke. Two things make the throttle safe and must not be undone:
   - The throttle tracks **one** target exercise at a time, so `scheduleCommentPersist` flushes the previous target before retargeting. Without that, typing in row A then row B inside the same 250ms window silently discarded A's edit.
   - `occ()` carries **unpersisted comments across every `currentDoc` swap** via its `carry()` helper — on the write result *and* on the fresh doc adopted after a `VersionConflictError`. Docs coming back from IndexedDB only contain what is stored, so swapping one in verbatim wipes queued edits from memory, and the retry mutator (which reads `currentDoc`) then writes the blanks to disk. `pendingCommentNames` is the set `carry()` consults; names absent from the incoming doc are skipped so a deleted or dropped-from-range exercise never resurrects.

5. **Autoload has no button.** Typing a triple that matches a saved document loads it automatically. There is a race guard that ignores a stale `getChapter` result if the inputs changed during the `await` — preserve it when touching the input handlers.

6. **Recency timing.** `last_used_at` is bumped 60s after a *top-level* field change (instrument/book/chapter/min/max) or immediately on Randomize; comment and checkbox edits must never bump it. `use_count` bumps only on Randomize.

7. **A chapter is either range-driven or a custom list, and Randomize has one path for each.** Both paths confirm via `window.confirm` first, and both reset `completed`/`completed_at` to `false`/`null` chapter-wide. Exercise identity is the string `exercise_name` (the map key doubles as the display label and supports non-numeric names with no migration).
   - **Contiguous** (`custom_list` falsy): rebuilds `exercises` from scratch to contain only the new min/max range's names — anything outside the new range is dropped entirely, comment included. `comment` carries over only for names present in both the old and new range. Sets `last_range` and clears `custom_list`.
   - **Custom** (`custom_list === true`, `last_range === null`): `reshuffleCustomList()` shuffles the existing `randomization` in place. min/max are ignored; nothing is added or removed; **every comment is left untouched**. `custom_list` and `last_range` are unchanged.

8. **`custom_list` is sticky and only one action clears it.** Adding or deleting a single exercise in Edit List mode sets `custom_list = true` and `last_range = null`. It stays true even if the surviving names happen to be contiguous again, and **Undo does not clear it**. The one way back is deliberate: enter Edit List mode (which re-enables the range inputs), type both min and max, and press Randomize — that takes the contiguous path above. A half-filled range is refused with an alert rather than guessed at. The field is absent on documents written before it existed, so always read it as `!!doc.custom_list`; that absence correctly means "contiguous", which is why this needed no `DB_VERSION` bump.

9. **Notes die in exactly two places.** A `comment` is destroyed only when (a) a contiguous Randomize drops that name out of the new range, or (b) the user deletes the row with its × in Edit List mode. No other path may lose one — in particular `deleteExercise` calls `discardPendingCommentFor(name)` so a throttled write in flight cannot re-create the record after the delete lands, and Undo of a delete restores the note verbatim from an in-memory snapshot.

10. **Edit List mode is UI-only and never persisted.** `editMode` and `undoStack` are module-level variables in `app.js`, reset by `resetEditState()` on page load, chapter switch, Reset Form, Delete, and every Randomize. The undo stack is multi-step (`{type:"add"|"delete", …}`, newest last) and holds names/positions from one specific list, which is why leaving that list must clear it. Structural add/delete deliberately does **not** bump `last_used_at` (see invariant 6) — only `version`/`updated_at` advance. Deleting the final remaining row is blocked with an alert.

11. **Reset Form (button id `clear-btn`) is a UI-only reset** — it clears inputs and the visible list and deletes nothing; re-entering the triple autoloads the saved document back. **Delete** (`#delete-btn`) is the destructive counterpart — after a `window.confirm`, it permanently removes the chapter document via `deleteChapter(key)` in `db.js`, which intentionally bypasses `mutateChapter`'s OCC check (delete removes whatever is stored regardless of version), then resets the form the same way.

12. Triple values are **trimmed** before they key/persist a document, so `"Piano "` and `"Piano"` collapse to one record. Keep keying consistent with this.

13. **instrument → book → chapter is a hierarchy.** Editing an ancestor field (typing, a datalist pick, or its `#…-clear` × button) clears every descendant field immediately — instrument clears book+chapter, book clears chapter. An incomplete triple always clears `currentDoc`, the exercise list, and the progress counter (see `autoload()`'s early-return branch) so no stale chapter is left on screen.

## DOM contract (keep `index.html` and `app.js` in sync)

Inputs `#instrument #book #chapter` (+ datalists `#instrument-list #book-list #chapter-list`, + per-field reset buttons `#instrument-clear #book-clear #chapter-clear`), `#min #max`, buttons `#randomize-btn #clear-btn #delete-btn`, `#progress-counter`, the list toolbar `#list-actions` (`.hidden` when no list, `.edit-mode` when editing) holding `#edit-list-btn` (label always "Edit List"; `.editing` supplies the active color), `#new-exercise-btn`, and `#undo-btn`, then `#exercise-list` (also carries `.edit-mode`), and the modal `#details-modal` with `#modal-title #modal-check #modal-comment #modal-save #modal-cancel`. Rows are built in `app.js` as `.exercise-row` (+ `.completed`) containing `.ex-check`, `.ex-name`, `.ex-oneline`, `.ex-details` (labeled "Edit"), and `.ex-delete` (the ×; built on every row but shown only under `#exercise-list.edit-mode`, so toggling edit mode is a pure CSS change and never re-renders). `.ex-oneline` is directly editable (typed edits go through the same 250ms throttle as the modal) whenever the comment is single-line or empty; it becomes `[readonly]` once the comment has a second line, and clicking it while locked (or clicking `.ex-details` regardless of lock state) opens the modal. Change an id/class in one file and you must change it in both.

## Testing

No repo test runner. Serve locally and check the full flow by hand or with a headless-Chromium script: Randomize a range → tick some checkboxes → add a multi-line comment in the modal → reload and confirm everything persisted → open a second tab on the same chapter and confirm concurrent edits both survive (the OCC path). Also check: typing directly into a row's one-line box persists without opening the modal; a comment that gains a second line in the modal locks the row box on save; re-randomizing an overlapping range clears all checkboxes chapter-wide, drops exercises outside the new range, and keeps comments for exercise names still in range; Delete removes the IndexedDB record and clears the form. Inspect Application → IndexedDB in DevTools to confirm there is exactly one `chapters` store and that `version` advances on writes.

For the custom-list feature specifically, also check: Edit List reveals the ×, New Exercise, and Undo controls without re-rendering; New Exercise prepends `max numeric name + 1`; deleting a row sets `custom_list` and leaves min/max blank + greyed (and still greyed after reload); Undo steps back through several adds/deletes, restoring deleted rows at their original position with their notes; the last remaining row cannot be deleted; Randomize on a custom list reshuffles without changing the exercise set or any note; entering Edit List mode, typing a full range, and pressing Randomize returns the chapter to contiguous numbering. Two tabs adding an exercise concurrently must not produce duplicate names — that is why `addExercise()` computes the name *inside* the mutator, where an OCC retry re-derives it from the fresh doc.

## Deploy

Push to `master`; GitHub Pages publishes automatically. There is no worker/model version to bump (unlike d4cubeoptim) — the only versioned artifact is `DB_VERSION`, and only when the schema changes.
