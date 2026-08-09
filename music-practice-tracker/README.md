# Music Practice Tracker

A small browser app that randomizes and tracks progress through musical exercises. Pick an instrument, book, and chapter, choose an exercise-number range, and hit **Randomize** to get a shuffled checklist; tick off exercises and jot per-exercise notes as you practice. Everything is saved locally in your browser — nothing leaves the page.

Two things the range does not have to dictate:

- **Numbering** — exercises can be numbered `1, 2, 3`, lettered `A, B, C` / `a, b, c`, or numbered in Roman numerals, chosen per chapter with the **Numbering** select. The letter systems append a number after `z` (`a2, b2, c2, …`, then `a3`, …) — a note below the select spells this out once you pick a letter scheme, since it's not obvious from the dropdown alone. Switching systems renumbers the chapter you are on, carrying every checkbox and note across. (An older version of this app spelled that range by doubling the letter instead — `aa`, `bb` — any exercise still using that spelling is silently updated the next time its chapter loads.)
- **Hand-edited lists** — **Edit List** turns on edit mode, where you can delete individual exercises with the × and add one with **New Exercise** (which reuses the lowest gap before extending past the end). A hand-edited chapter stops being governed by min/max; filling both boxes in and pressing Randomize is the way back to a contiguous range.

Not every exercise deserves equal time, so each one carries a **practice focus** — press the bullseye on any row (or in the expanded view) to put it in or out of your **rotation**. Focused exercises get dealt to the top of the list, and the progress counter says how many there are.

The rotation is what decides how much **Randomize** clears, which is the difference between a list you restart and a list you work through:

- **If you've ticked off at least one focused exercise**, Randomize gives you a *partial* reset. Just the focused ones clear and reshuffle back to the top for another pass — everything else is left exactly as it was, ticks and order both. So the handful you're drilling comes round again every session while the rest of the book stays where you left it.
- **If none of the focused ones are ticked** — including when you haven't focused anything at all — Randomize clears the whole chapter and reshuffles it, the way it always has.

One thing to watch: since it goes by what's ticked right now, pressing Randomize twice in a row clears everything the second time. **Undo** puts it back.

**Reset Focus** empties the rotation in one press.

Three buttons make a day's practice easier to work through:

- **Sort** — the shuffled order is good for practicing and bad for finding one particular exercise. Sort rewrites it into the order you prune in: focused exercises first, then still-unfinished before finished, each group climbing by exercise number (so `z` before `a2`, and `IX` before `X`).
- **Reset Focus** — empties the rotation, clearing every focus mark in the chapter at once.
- **Undo** — steps back through the last 20 destructive actions: Sort, Randomize, adding or deleting an exercise, changing the numbering system, Reset Focus, and deleting a chapter. It is why none of those stop to ask "are you sure?". The history lives in memory, so reloading the page clears it.

## Moving between devices

Your practice history is stored by the browser, on the device you typed it into — a phone, a tablet and a laptop each keep their own separate copy. The **Data** panel below the exercise list is how you move it between them.

**Export** saves every chapter to a single JSON file. On an iPhone or iPad it opens the share sheet, so you can AirDrop or message the file straight to another device; elsewhere it downloads.

**Import** takes that file and **replaces everything stored on the device you import into**. It is a copy, not a combine: if a chapter is missing from the file because you deleted it on the other device, importing deletes it here too. So the rule of thumb is to pick whichever device is most up to date, export from it, and import everywhere else.

Nothing asks for confirmation here either. Import quietly keeps a copy of what it overwrote, and **Undo Import** puts it back — until you reload the page, at which point the import is permanent.

## Run locally

From the repository root:

```
python3 -m http.server 8000
```

then open <http://localhost:8000/music-practice-tracker/>. It must be served over HTTP (not opened as a `file://` path) because it uses IndexedDB and ES-module imports.

There is **no build step and no dependencies** — the files are served exactly as they are here.

## Files

| File | Role |
|------|------|
| `index.html` | UI shell: the header form, the exercise list, the Data panel, and the details `<dialog>`. Loads `app.js` as an ES module. |
| `style.css` | Styling (light/dark aware). |
| `db.js` | IndexedDB data layer — the store schema and the optimistic-concurrency write helper. |
| `app.js` | Controller — autoload, randomize, checkbox/comment persistence, export/import, and the details modal. |

## Data

All state persists in IndexedDB under a database named `music-practice-tracker-<guid>`, as one self-contained document per (instrument, book, chapter). That storage is per-device — see *Moving between devices* above.

How much re-randomizing clears depends on your rotation — see the focus section above. Your notes and focus marks are always kept, with one exception: changing the range drops the exercises that fall outside the new one, and their notes and marks go with them. Re-randomizing a hand-edited list keeps every exercise, note, and mark as-is. Nothing here asks for confirmation; **Undo** is the safety net instead.

**Reset Form** just clears the form — it deletes nothing, and retyping the same instrument/book/chapter loads the saved chapter straight back. **Delete** removes the saved chapter; Undo brings it back (and takes you to it), as long as you have not reloaded the page in between.

With the app open in two tabs on the same chapter, Undo merges rather than overwrites: it restores your snapshot but keeps anything the other tab changed in the meantime.

## Contributing

Before changing the code, read [`for_claude/music-practice-tracker.md`](../for_claude/music-practice-tracker.md) — it spells out the data-model and concurrency invariants you need to preserve. Design/reference notes are in [`wiki/music-practice-tracker.md`](../wiki/music-practice-tracker.md).
