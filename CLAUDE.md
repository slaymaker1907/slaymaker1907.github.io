# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

Personal GitHub Pages site (https://slaymaker1907.github.io) published automatically from the `master` branch — there is no Actions workflow, CI, or site-wide test suite (`.github/` holds only Dependabot config). Two kinds of content coexist:

1. A mostly dormant Jekyll blog: `_config.yml`, `_posts/`, `_layouts/`, `_includes/`, `_sass/`, plus root `index.html`, `about.md`, `feed.xml`.
2. Standalone client-side apps, one per directory, served as-is (Jekyll copies non-underscore directories verbatim).

Nearly all recent development happens in `d4cubeoptim/`. **Before touching anything in that directory, read `for_claude/d4cubeoptim.md`** — it documents the architecture, the sync relationship with its separate source repository, and versioning conventions that must be followed when deploying changes there.

`music-practice-tracker/` is another recent, dependency-free browser SPA (plain ES modules, IndexedDB-backed) authored directly in this repo. **Before touching that directory, read `for_claude/music-practice-tracker.md`** — it captures the data-model and concurrency invariants that must be preserved.

Other directories, for orientation: `dice-roller/`, `password/`, `optimal-timer/` contain only prebuilt bundles (webpack/CRA output) whose sources live outside this repo — never hand-edit their `bundle.js`; `mother/` is a small Tone.js app; `augus818/` plus root `ability_score.html` and `weapon818.html` are D&D pages (the root pages use the shared vendored libraries in `assets/`: Bootstrap 3.3.6, jQuery 2.2.4, crypto-js); `camera-inverter/`, `dice-counter/`, `old-password/`, `tiddlywiki/` are single-page utilities.

## Wiki

Longer-form reference docs live in `wiki/`:

- `wiki/README.md` — index of the wiki.
- `wiki/music-practice-tracker.md` — data model, IndexedDB/GUID rules, concurrency, and UI flow for the music-practice-tracker app.

Agent-facing deep docs for the actively-developed apps live in `for_claude/` — `for_claude/d4cubeoptim.md` and `for_claude/music-practice-tracker.md`. Read the relevant one before touching that directory.

## Commands

- **Serve locally** (from repo root):
  ```
  python3 -m http.server 8000
  ```
  This is sufficient for app work; apps that spawn Web Workers or fetch WASM must be served over HTTP, not opened as `file://`. To render the Jekyll blog too: `bundle install && bundle exec jekyll serve` (uses the `github-pages` gem).
- **Deploy**: push to `master`; GitHub Pages publishes automatically.
- **`augus818/`**: `make` (pandoc renders `*.md` → `build/*.html`).
- **`mother/`**: `npm install && npm run build` (compiles `index.ts` with TypeScript 2.x).

There is no lint or test runner in this repo.
