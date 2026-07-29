# music-practice-tracker

A dependency-free browser SPA that randomizes and tracks progress through musical
exercises. Published at https://slaymaker1907.github.io/music-practice-tracker/.

Unlike `d4cubeoptim/`, this app is **not** synced from an external source repo — it is
authored directly in this repository.

## Files

Four files, no framework and no build step, loaded as ES modules:

- `index.html` — markup and the `<script type="module">` entry point.
- `app.js` — UI controller / application logic.
- `db.js` — IndexedDB data-access layer.
- `style.css` — styles.

**Why plain ES modules** (not the UMD wrappers `d4cubeoptim/` uses): this app has no
Web Worker and no Node consumer, so `<script type="module">` + `import` is enough.

## Persistence

State lives in **IndexedDB**, database
`music-practice-tracker-339718e4-583f-4270-bd72-23f4d23a6c9e`.

The GUID suffix is hardcoded in `db.js` as `APP_GUID` and **must never be regenerated
at runtime**. IndexedDB is per-origin and shared across every app on
`slaymaker1907.github.io`; the GUID exists solely to keep this app's database from
colliding with the other apps on that same origin.

## Data model

One object store, `chapters`, deliberately **denormalized**: one self-contained
document per `(instrument, book, chapter)`. There are no other stores and no
cross-document relations — a chapter is the unit of read and write.

- **keyPath**: `["instrument", "book", "chapter"]` (composite).
- **Index**: `by_last_used_at` on `last_used_at`.

### Document fields

| Field | Type | Purpose |
| --- | --- | --- |
| `instrument`, `book`, `chapter` | string ×3 | Composite key. `chapter` is a string so `"12"` and `"IIb"` both work. |
| `version` | number | Optimistic-concurrency token. Every write re-reads the doc inside its transaction and compares this integer before mutating, then increments it. |
| `use_count` | number | Number of randomizations; tiebreaker for suggestion ordering. |
| `last_used_at` | epoch ms | Recency. Orders datalist suggestions and picks the doc to autoload on page open (this is the indexed field). Bumped 60s after a top-level field change, or immediately on Randomize. |
| `last_range` | `{min, max}` \| null | Restores the range inputs on autoload; set on a range-driven Randomize, and `null` for a custom list. |
| `randomization` | string[] \| null | The single shuffled order of exercise names, mutated in place by Randomize; `null` = no active list. |
| `randomized_at` | number \| null | When `randomization` was last set. |
| `custom_list` | boolean | `true` once the user has hand-added or hand-deleted an exercise. Switches the chapter off the min/max range system (see *Custom lists* below). Absent on documents written before this field existed, so read it as `!!doc.custom_list` — absent means contiguous, which is why it needed no schema migration. |
| `exercises` | object (name → `{completed, completed_at, comment}`) | Per-exercise progress. The key doubles as the display name and supports future non-numeric identifiers with no migration. |
| `updated_at` | epoch ms | Last write. |

## Concurrency

All writes go through `mutateChapter(key, expectedVersion, mutator)`. Inside a single
readwrite transaction it re-reads the doc, checks `version === expectedVersion`, applies
the mutator, and writes back with `version` incremented.

On a mismatch (another tab wrote first) it throws `VersionConflictError` carrying the
fresh doc. The controller then reloads the fresh doc, re-applies the field currently
being edited, and retries **once** — i.e. per-field last-write-wins.

`deleteChapter(key)` is the one exception: it's a plain `store.delete()`, bypassing the
OCC check entirely, since deleting is a user-confirmed "remove regardless of version"
action rather than a conditional field update.

## Write throttling

Comment / free-text edits persist at most **once per 250ms** (trailing flush), not on
every keystroke. This applies whether the edit comes from the modal's textarea or from
directly typing in a row's one-line comment box. A pending edit is also flushed
immediately when the modal opens or closes with Save, before either Randomize path, and
when the tab is hidden.

Because the throttle tracks one target exercise at a time, moving to a different row
mid-window flushes the previous row's queued edit first. And since a document read back
from IndexedDB only contains what is *stored*, `occ()` re-applies any still-unpersisted
comments whenever it swaps a new document into memory — both the write result and the
fresh document adopted after a version conflict. Without those two rules, typing quickly
across several rows would silently drop notes.

## UI flow

- **Header form** — instrument / book / chapter smart inputs plus a min/max range.
  Filling in a matching saved combo **autoloads** that record with no button press.
  The three fields form a hierarchy: editing (or ×-clearing) instrument wipes book and
  chapter, and editing book wipes chapter, so a stale descendant value can never
  linger after its ancestor changes.
- **Randomize** — confirms first (it resets progress), then saves the combo and
  shuffles the exercise order. It has two paths, and both reset `completed`/`completed_at`
  chapter-wide and bump `last_used_at`/`use_count` immediately.
  - *Range-driven* (the default): `exercises` is rebuilt to contain only the new range's
    names, dropping anything outside it; `comment` carries over for exercise names that
    were already present (i.e. overlap the old range). Sets `last_range`, clears
    `custom_list`.
  - *Custom list*: shuffles the exercises already there. min/max are ignored, nothing is
    added or removed, and every comment is left untouched.
- **Reset Form** (button id `clear-btn`) — a UI-only reset; it deletes nothing.
- **Delete** — confirms, then permanently deletes the chapter document via
  `deleteChapter` and resets the form like Reset Form.
- **Exercise rows** — each row is a completion checkbox + a one-line comment box + an
  **Edit** button. The comment box is directly editable when the comment is a single
  line (or empty) — typed edits go through the same 250ms throttle as the modal. Once
  a comment has a second line, the box locks (`readonly`, greyed out) and clicking it
  (or Edit) opens the `<dialog>` multi-line comment editor instead.
- **Edit List** — toggles edit mode for the list. The button keeps its label in both
  states and only changes color. See *Custom lists* below.

## Custom lists (non-contiguous exercises)

An exercise list does not have to be a contiguous run of numbers. Pressing **Edit List**
above the list turns on edit mode, which reveals three controls:

- an **×** on every row, which deletes that exercise and its note immediately (no confirm);
- **New Exercise**, which adds `max(numeric existing names) + 1` and prepends it to the
  top of the order;
- **Undo**, a multi-step, session-only history of those adds and deletes. Undoing a delete
  restores the exercise at its original position with its note intact. The stack lives in
  memory only and is cleared on reload, chapter switch, Reset Form, Delete, and Randomize.

The first add or delete sets `custom_list = true` and `last_range = null`. From then on the
chapter is no longer described by a range, so the **min/max inputs are blanked and greyed
out**, and Randomize reshuffles in place rather than renumbering. The flag is *sticky*: it
stays set even if the remaining numbers happen to be contiguous again, and Undo does not
clear it.

Edit mode re-enables the min/max inputs, which is the deliberate way back: type both
endpoints and press Randomize, and the chapter returns to range-driven numbering
(`custom_list` cleared, `exercises` rebuilt from the range, out-of-range notes dropped).
Filling in only one of the two is refused rather than guessed at.

Two rules bound the destruction of notes. A note is lost **only** when a range-driven
Randomize drops that exercise out of range, or when the row is explicitly deleted with its
×. Deleting the final remaining row is blocked so a list always has at least one exercise.

Edit mode itself is never persisted — every page load starts with it off.
