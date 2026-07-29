# Music Practice Tracker

A small browser app that randomizes and tracks progress through musical exercises. Pick an instrument, book, and chapter, choose an exercise-number range, and hit **Randomize** to get a shuffled checklist; tick off exercises and jot per-exercise notes as you practice. Everything is saved locally in your browser — nothing leaves the page.

Two things the range does not have to dictate:

- **Numbering** — exercises can be numbered `1, 2, 3`, lettered `A, B, C` / `a, b, c`, or numbered in Roman numerals, chosen per chapter with the **Numbering** select. The letter systems double up after `z` (`aa`, `bb`, `cc`).
- **Hand-edited lists** — **Edit List** turns on edit mode, where you can delete individual exercises with the ×, add one with **New Exercise** (which reuses the lowest gap before extending past the end), and step back through those changes with **Undo**. A hand-edited chapter stops being governed by min/max; filling both boxes in and pressing Randomize is the way back to a contiguous range.

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
| `index.html` | UI shell: the header form, the exercise list, and the details `<dialog>`. Loads `app.js` as an ES module. |
| `style.css` | Styling (light/dark aware). |
| `db.js` | IndexedDB data layer — the store schema and the optimistic-concurrency write helper. |
| `app.js` | Controller — autoload, randomize, checkbox/comment persistence, and the details modal. |

## Data

All state persists in IndexedDB under a database named `music-practice-tracker-<guid>`, as one self-contained document per (instrument, book, chapter).

Re-randomizing a chapter always clears every completion checkbox — that is the point of it, and it asks for confirmation first. Your notes are kept, with one exception: changing the range drops the exercises that fall outside the new one, and their notes go with them. Re-randomizing a hand-edited list keeps every exercise and note as-is.

**Reset Form** just clears the form — it deletes nothing, and retyping the same instrument/book/chapter loads the saved chapter straight back. **Delete** is the destructive one: it removes the saved chapter for good.

## Contributing

Before changing the code, read [`for_claude/music-practice-tracker.md`](../for_claude/music-practice-tracker.md) — it spells out the data-model and concurrency invariants you need to preserve. Design/reference notes are in [`wiki/music-practice-tracker.md`](../wiki/music-practice-tracker.md).
