# slaymaker1907.github.io

Personal website and a collection of standalone, client-side JavaScript apps, hosted
at **https://slaymaker1907.github.io**. It is a GitHub Pages site published
automatically from the `master` branch — push to deploy, no CI or build step. A
mostly dormant Jekyll blog lives alongside the apps; each app is a self-contained
directory served as-is.

## Apps

| Path | What it is |
| --- | --- |
| `d4cubeoptim/` | Most actively developed app; synced from a separate source repo (see the wiki / `for_claude/`). |
| `music-practice-tracker/` | Dependency-free SPA that randomizes and tracks musical-exercise practice; IndexedDB-backed. |
| `mother/` | Small Tone.js audio app. |
| `augus818/` (+ `ability_score.html`, `weapon818.html`) | D&D pages. |
| `dice-roller/`, `dice-counter/` | Dice utilities. |
| `password/`, `old-password/` | Password utilities. |
| `optimal-timer/` | Timer utility. |
| `camera-inverter/`, `tiddlywiki/` | Single-page utilities. |

## Run locally

From the repo root:

```
python3 -m http.server 8000
```

Serving over HTTP (not `file://`) matters for apps that spawn Web Workers or fetch
WASM. To render the Jekyll blog too: `bundle install && bundle exec jekyll serve`.

## Docs

See [`wiki/`](wiki/README.md) for per-app documentation and deeper reference material.
