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
| `last_range` | `{min, max}` \| null | Restores the range inputs on autoload; set on a range-driven Randomize, and `null` for a custom list. Holds 1-based **indexes**, not spelled names, so it survives a change of `numbering_system`. |
| `randomization` | string[] \| null | The single order of exercise names — shuffled by Randomize, rewritten by Sort; `null` = no active list. |
| `randomized_at` | number \| null | When `randomization` was last set. |
| `custom_list` | boolean | `true` once the user has hand-added or hand-deleted an exercise. Switches the chapter off the min/max range system (see *Custom lists* below). Absent on documents written before this field existed, so read it as `!!doc.custom_list` — absent means contiguous, which is why it needed no schema migration. |
| `numbering_system` | string | How new exercise names are spelled: `"numbers"`, `"letters-upper"`, `"letters-lower"`, or `"roman"`. Absent on documents written before this field existed (and any unrecognized value) reads as `"numbers"`, so it needed no schema migration. See *Numbering systems* below. |
| `exercises` | object (name → `{completed, completed_at, comment, focus?}`) | Per-exercise progress. The key doubles as the display name and supports non-numeric identifiers with no migration — which is exactly what the letter and Roman numbering systems use. `focus` is `"focused"` and is **omitted whenever it is not**, so it is absent from every pre-feature document and needed no schema migration. A retired third value, `"paused"`, may still sit in old records; it reads as un-focused. See *Practice focus* below. |
| `updated_at` | epoch ms | Last write. |

## Concurrency

All writes go through `mutateChapter(key, expectedVersion, mutator)`. Inside a single
readwrite transaction it re-reads the doc, checks `version === expectedVersion`, applies
the mutator, and writes back with `version` incremented.

On a mismatch (another tab wrote first) it throws `VersionConflictError` carrying the
fresh doc. The controller then reloads the fresh doc, re-applies the field currently
being edited, and retries **once** — i.e. per-field last-write-wins.

Three functions bypass the OCC check. `deleteChapter(key)` is a plain `store.delete()`,
since deleting means "remove regardless of version" rather than a conditional field
update. `restoreChapter(key, resolver)` backs **Undo**: a version conflict has nothing
useful to retry, because the snapshot Undo wants to write does not get any fresher. It is
safe only because it hands the resolver the live stored document and the resolver merges
against it — see *Undo* below. `replaceAllChapters(docs)` backs **Import**: a `clear()`
plus one `put()` per document, all in a single transaction so an import either lands whole
or not at all. It is the same exemption as `deleteChapter` — an imported file is the truth
regardless of what is stored — and it writes back the `version` values the file carries, so
another tab's next write conflicts and re-reads rather than clobbering the import.

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

- **Header form** — instrument / book / chapter smart inputs plus a min/max range and a
  **Numbering** select (see *Numbering systems* below).
  Filling in a matching saved combo **autoloads** that record with no button press.
  The three fields form a hierarchy: editing (or ×-clearing) instrument wipes book and
  chapter, and editing book wipes chapter, so a stale descendant value can never
  linger after its ancestor changes.
- **Randomize** — saves the combo, shuffles the exercise order and bumps
  `last_used_at`/`use_count`. **How many checkboxes it clears depends on the focused set** —
  see *Practice focus* below, which is where that rule lives. No confirmation dialog:
  **Undo** is the safety net for this and every other destructive action, and the app has
  no `window.confirm` calls left. It has two paths:
  - *Range-driven* (the default): `exercises` is rebuilt to contain only the new range's
    names, dropping anything outside it; `comment` and `focus` carry over for exercise
    names that were already present (i.e. overlap the old range). Sets `last_range`,
    clears `custom_list`.
  - *Custom list*: shuffles the exercises already there. min/max are ignored, nothing is
    added or removed, and every comment and focus state is left untouched.
- **Reset Form** (button id `clear-btn`) — a UI-only reset; it deletes nothing.
- **Undo** — reverses the last destructive action. See *Undo* below.
- **Reset Focus** (button id `reset-focus-btn`) — empties the practice rotation, putting
  every exercise back to un-focused in one write. Undoable and, like everything else here,
  unconfirmed.
- **Delete** — deletes the chapter document via `deleteChapter` and resets the form like
  Reset Form. Undoable, which is why it no longer confirms; but the undo history lives in
  memory, so a reload between the delete and the undo does make it permanent.
- **Exercise rows** — each row is a completion checkbox + the exercise name + a one-line
  comment box + an **expand** icon button + a **focus toggle**, and in Edit List mode also
  a delete ×. The name is bare (`12`, not `Exercise 12`), which is what leaves room for the
  focus toggle to sit on every row rather than hiding in Edit List mode.
  The comment box is directly editable when the comment is a single line (or empty) —
  typed edits go through the same 250ms throttle as the modal, and the box mirrors the
  modal's textarea live while that is open. It locks (`readonly`, greyed out) only once
  the comment has a *second line with real content on it*; a trailing newline does not
  count. While locked, clicking it (or the expand button, always) opens the `<dialog>`
  multi-line comment editor instead.
- **Edit List** — toggles edit mode for the list. The button names the action it will
  perform, so it reads "Edit List" when off and **"Exit Edit"** while editing, and fills
  in with the accent color while active. See *Custom lists* below.
- **Sort** — reorders the list for pruning. See *Sorting* below.
- **Data** — a `<details>` panel below the list, collapsed by default, holding **Export**,
  **Import** and **Undo Import**. See *Export and import* below.

## Practice focus

An exercise is either **focused** or not. The focused set is the **practice rotation**:
the handful of things you want back in front of you every session. It is stored per
exercise as `focus`, and absent means un-focused.

The toggle is a single bullseye button — lit green when focused, dim otherwise, one press
to flip. It sits on **every row at all times** (not tucked behind Edit List mode) and in
the expanded details modal, and a focused row is accented down its left edge. Unlike Sort
or Randomize the toggle is *not* pushed onto the undo stack — it is treated like the
completion checkbox, since pressing it again walks straight back out. **Reset Focus** in
the header, which empties the rotation in one write, is undoable.

Focus never hides or skips anything. What it changes is the order, and — more importantly
— **how much a Randomize resets**.

### What Randomize clears

Randomize asks one question: *is any focused exercise currently ticked?*

**No → full reset.** Every checkbox clears and the whole list reshuffles, focused first.
This is the from-scratch behavior, and it covers two cases: you have a rotation but haven't
finished any of it yet, and — the important one — **you have no focused exercises at all**,
in which case there is no focused box that could be ticked, so Randomize always behaves
exactly as it did before this feature existed.

**Yes → partial reset.** The focused exercises clear and reshuffle to the top, ready for
another pass. Everything un-focused is left **completely alone**: same ticks, and the same
relative order it was already in. Nothing about that section moves.

That split is the whole point. The focused set is a short rotation you repeat every
session; the un-focused set is a long tail you chip away at a couple of exercises at a
time, and a Randomize never wipes that accumulated progress out from under you. When you
widen the range mid-rotation, the new exercises simply join the end of the un-focused
block.

One sharp edge worth knowing: because the question is asked of the checkboxes *as they
stand*, pressing Randomize twice in a row does a full clear the second time — the first
press left no focused box ticked. **Undo** puts it back.

Beyond Randomize, **Sort** uses focus as its leading key (ahead of completion and number),
and **the progress counter** counts every exercise on screen and appends `· N focused` to
name the size of the rotation, e.g. `3 of 8 complete · 2 focused`.

### The retired "paused" state

Focus used to be three-way, with a **paused** state for work shelved but deliberately not
deleted. That is gone; there is only focused and not. Any exercise still carrying the old
value simply reads as un-focused, so nothing had to be migrated and no old data was
touched — the stale value disappears for real the next time that exercise is toggled or
Reset Focus runs.

## Sorting

The stored order is a practice shuffle, which makes finding one specific exercise — to
tick off, or to delete once it is finished — a linear scan. **Sort** rewrites it into the
order you actually prune in: focused before un-focused (the same ranking Randomize lays
out), then still-unfinished exercises before finished ones, each group climbing by
exercise number.

"By number" means by the 1-based **index** the chapter's numbering system parses out of
the name, never by the spelling. That is what puts `z` (26) before `a2` (27) and `IX` (9)
before `X` (10), where a plain string compare gets both backwards. A list may legitimately
hold names minted under an older system that the current one cannot read; those have no
index to sort by, so they settle at the end of their group in alphabetical order.

Sort changes **only** the order. Completion state, notes, focus states, `custom_list`,
`last_range`, and the recency counters are all left alone, and the new order is saved — it survives a
reload. It is undoable, and unlike Edit List's controls it is always available.

## Undo

**Undo** reverses the last destructive action: Sort, either Randomize path, adding or
deleting an exercise, a change of numbering system, Reset Focus, and chapter Delete. It
replaced every confirmation dialog in the app. The per-exercise focus toggle is
deliberately outside it, like the completion checkbox.

Each action snapshots the **whole chapter document** before it writes, rather than
describing its own inverse — Randomize has no inverse expressible as a delta, and every
new undoable action used to need another hand-written one. The history is multi-step and
capped at 20 entries. It lives in memory only and is **never persisted**, so a page reload
is the one thing that clears it.

The stack is global rather than per-chapter: each entry carries its own instrument / book /
chapter, so Undo reaches back into a chapter you have navigated away from and refills the
three inputs to take you there. That is what makes an undoable chapter Delete possible, and
it is why a chapter switch or a Reset Form no longer clears the history.

### Undo is a merge, not a rewind

With a second tab open on the same chapter, restoring a snapshot wholesale would silently
revert everything that tab had done since. So Undo performs a three-way merge instead,
using the document as it stood *immediately after* the action as its base. The rule is one
line: **the other tab wins on anything it touched since; everything else reverts to the
snapshot.** Presence counts as a value, so an exercise the other tab added survives the
undo and one it deleted stays deleted.

The consequence is worth stating plainly: Undo can land the chapter in a state that never
previously existed — your pre-sort order back, but the other tab's newer checkbox still
ticked. That is the intended outcome. It is the only behavior that both always lands and
never silently discards concurrent work.

## Export and import

IndexedDB is per-origin **and per-device**, so a phone, a tablet and a laptop each hold an
independent database with no connection between them. Export and Import are the manual
sync: one JSON file carrying the entire `chapters` store.

They live in a **Data** `<details>` panel below the exercise list, collapsed by default so
a mis-tap cannot reach Import.

**Export** writes every chapter to a file named
`music-practice-tracker-<timestamp>.json`. On a device that supports sharing files
(iOS/iPadOS Safari) it opens the system share sheet, so the file can go straight to another
device over AirDrop or Messages; everywhere else it downloads. The documents go in
verbatim, `version` field included.

| Envelope field | Purpose |
| --- | --- |
| `format` | Always `"music-practice-tracker-export"`. Identifies the file. |
| `format_version` | Version of the envelope itself, currently `1`. |
| `app_guid` | The permanent `APP_GUID`. Catches a file from a different app. |
| `db_version` | The `DB_VERSION` that wrote it. See the version rule below. |
| `exported_at` | Epoch ms, informational. |
| `chapters` | The store's documents, exactly as `listChapters()` returned them. |

**Import replaces the entire local database** — it is not a merge. Whichever device you
export from is the one that wins, which is what makes deletions propagate: a chapter you
removed on the laptop is genuinely gone after importing the laptop's file on the phone.

The file is fully validated *before* anything is written, so a wrong file produces an error
message and leaves the database untouched. The `db_version` check is deliberately one-sided:
a file from a **newer** build of the app is refused, because it may carry a shape this
device cannot read; a file from an **older** one is accepted, because every optional field
in this schema is defined so that absent means the default (see `custom_list`,
`numbering_system` and `focus` above) — which is exactly what an old export looks like.

**Undo Import** is the guard that lets Import skip a confirmation dialog like everything
else here: the current database is snapshotted in memory immediately before the overwrite,
and one press puts it back. It is one-shot, and — like the undo history — it lives in memory
only, so reloading the page is what makes an import permanent.

Importing also clears the ordinary **Undo** history. Those entries hold per-chapter
snapshots whose version numbers described the *previous* database, and replaying one into a
freshly imported store would overwrite it with stale data.

## Custom lists (non-contiguous exercises)

An exercise list does not have to be a contiguous run of numbers. Pressing **Edit List**
above the list turns on edit mode, which reveals two controls:

- an **×** on every row, which deletes that exercise and its note immediately (no confirm);
- **New Exercise**, which adds the lowest free name and prepends it to the top of the
  order (see *Gap filling* below).

Both are undoable — undoing a delete restores the exercise at its original position with
its note intact — but **Undo** itself is not an edit-mode control; it sits in the header
form's button row, because it reverses Randomize and chapter Delete too.

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

### Gap filling

**New Exercise** reuses holes before extending the list. It reads the indexes of the names
already present, and takes the lowest free one between the smallest and largest of them;
only when that span is full does it go one past the end. So deleting exercises 2 and 4 out
of 1–5 and then adding three times yields `2`, `4`, `6` — not `6`, `7`, `8`. An empty list
(or one whose names the current numbering system cannot read) starts at the first name.

The name is chosen *inside* the write's mutator rather than up front. Two tabs adding at
the same moment would otherwise pick the same hole; because the loser of the optimistic-
concurrency check re-runs the mutator against the freshly-stored document, it sees the
name the winner just took and moves to the next one.

## Numbering systems

The **Numbering** select chooses how exercise names are spelled. Because an exercise's
identity has always been an arbitrary string key, this is only a codec between that string
and a 1-based index — no schema change:

| System | Names |
| --- | --- |
| Numbers | `1`, `2`, `3`, … |
| Uppercase letters | `A` … `Z`, then `A2` … `Z2`, `A3` … `Z3`, … |
| Lowercase letters | `a` … `z`, then `a2` … `z2`, `a3` … `z3`, … |
| Roman numerals | `I`, `II`, `III`, `IV`, … |

After one alphabet is exhausted the letter schemes append a numeral rather than counting
like spreadsheet columns: index 27 is `a2`, 53 is `a3`. (An earlier version of the app
doubled the letter instead — `aa`, `aaa` — for that same range; see *Migrating old letter
names* below.) Since that wrap point is not guessable from the **Numbering** select alone,
picking either letter scheme shows a one-line hint below the range fields spelling it out
(e.g. "After z, numbering continues a2, b2, … then a3, …"); numbers and Roman numerals hide
it, since neither wraps into a shape that needs explaining.

The choice is stored per chapter in `numbering_system`, so a scales book and an etude book
can differ, and it is restored on autoload along with everything else. It governs both
**New Exercise** and the names a range-driven Randomize generates.

Under a letter system the **min/max boxes take letters** (type `a` and `f` to build `a`–`f`).
Numbers *and Roman numerals* both take ordinary digits — with Roman selected, `1` and `5`
build `I`–`V` — because typing `IV` into a range box is far more error-prone than typing
`4`. `last_range` always stores indexes, so a stored range is simply re-spelled if the
system changes.

Switching systems **renames the exercises already in the list**. Every name the outgoing
system can read is re-spelled by the incoming one at the same index — `1`↔`a`, `2`↔`b`,
`9`↔`IX` — carrying its completion state and note with it, and the list order is mapped
through unchanged. The change is undoable and, like every other write action, unconfirmed.

Two things survive the rename untouched. Names the **outgoing** system cannot read have no
index to carry across, so they keep their name; a mixed list remains a legitimate state,
and such names are skipped when picking the next one. And a rename that would **collide**
is dropped rather than guessed at: switching a list holding both `1` and `a` from letters
to numbers would map `a`→`1` on top of the `1` that is staying put, so `a` simply stays
`a`. Names that are themselves moving vacate their spelling first, so `1`→`a` can take `a`
when `a` is in the same breath becoming `b`.

### Migrating old letter names

A chapter's letter names past `z` used to double the letter (`aa`, `bb`, …, `aaa`) instead
of appending a numeral. Any exercise still holding that old spelling is silently re-spelled
the moment its chapter is loaded — on typing its triple, at page load if it was the most
recently used chapter, on Undo, and after Import/Undo Import. Nothing is lost: each name
maps to the same index it always did, so completion state, notes and focus marks all carry
across exactly as they do for a deliberate numbering-system change above. Unlike that
change, this migration is silent and **not** undoable — it corrects a spelling, not a
setting, so there is nothing meaningful to revert.
