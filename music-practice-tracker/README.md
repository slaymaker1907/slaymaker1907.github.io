# Music Practice Tracker

A small browser app that randomizes and tracks progress through musical exercises. Pick an instrument, book, and chapter, choose an exercise-number range, and hit **Randomize** to get a shuffled checklist; tick off exercises and jot per-exercise notes as you practice. Everything is saved locally in your browser — nothing leaves the page.

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

All state persists in IndexedDB under a database named `music-practice-tracker-<guid>`, as one self-contained document per (instrument, book, chapter). Re-randomizing a chapter reshuffles the order but keeps your completions and comments. **Clear Form** just resets the form — it deletes nothing.

## Contributing

Before changing the code, read [`for_claude/music-practice-tracker.md`](../for_claude/music-practice-tracker.md) — it spells out the data-model and concurrency invariants you need to preserve. Design/reference notes are in [`wiki/music-practice-tracker.md`](../wiki/music-practice-tracker.md).
