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
| `last_range` | `{min, max}` \| null | Restores the range inputs on autoload; set on Randomize. |
| `randomization` | string[] \| null | The single shuffled order of exercise names, mutated in place by Randomize; `null` = no active list. |
| `randomized_at` | number \| null | When `randomization` was last set. |
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
directly typing in a row's one-line comment box.

## UI flow

- **Header form** — instrument / book / chapter smart inputs plus a min/max range.
  Filling in a matching saved combo **autoloads** that record with no button press.
  The three fields form a hierarchy: editing (or ×-clearing) instrument wipes book and
  chapter, and editing book wipes chapter, so a stale descendant value can never
  linger after its ancestor changes.
- **Randomize** — confirms first (it resets progress), then saves the combo and
  shuffles the exercise order. A chapter has exactly one active range: `exercises` is
  rebuilt to contain only the new range's names, dropping anything outside it;
  `completed`/`completed_at` are always reset, but `comment` carries over for exercise
  names that were already present (i.e. overlap the old range). Also sets `last_range`
  and bumps `last_used_at`/`use_count` immediately.
- **Reset Form** (button id `clear-btn`) — a UI-only reset; it deletes nothing.
- **Delete** — confirms, then permanently deletes the chapter document via
  `deleteChapter` and resets the form like Reset Form.
- **Exercise rows** — each row is a completion checkbox + a one-line comment box + an
  **Edit** button. The comment box is directly editable when the comment is a single
  line (or empty) — typed edits go through the same 250ms throttle as the modal. Once
  a comment has a second line, the box locks (`readonly`, greyed out) and clicking it
  (or Edit) opens the `<dialog>` multi-line comment editor instead.
