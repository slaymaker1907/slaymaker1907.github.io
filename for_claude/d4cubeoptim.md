# d4cubeoptim — guidance for Claude Code

Read this before working in `d4cubeoptim/`, the Diablo IV Horadric Cube optimizer.

**This directory is a deployment target**: the source of truth is the separate `Diablo4-Horadric-Cube-Optimizer` repository, and commits here are typically syncs ("Deploy …" / "Sync from Diablo4-Horadric-Cube-Optimizer" in messages). If you edit these files directly, say so clearly in the commit message so the source repo can be reconciled. There is no test runner here; d4cubeoptim's tests live in the source repo.

When serving locally, the app must be loaded over HTTP (e.g. `python3 -m http.server 8000` from the repo root), not opened as `file://`, because it spawns a Web Worker and fetches WASM.

## How the pieces fit together

- `index.html` — the entire UI in one large file. An inline script defines `WORKER_VERSION` and spawns `new Worker("./d4cubeoptimv3-worker.js?v=" + WORKER_VERSION)`. Loads `gear-slot-legality.js`, `config.js`, and `weight-tracking.js` via `<script>` tags.
- `d4cubeoptimv3-worker.js` — self-contained solver running in the Web Worker. Historically three files inlined in order (v1 base helpers → v2 residual abstraction → v3 hybrid logic). Implements the lexicographic objective: maximize P(success), then minimize expected cube steps given success; phases cover feasibility checks, closed-form common cases, decomposition + ILP, and residual LAO*-style search, plus Monte Carlo policy evaluation (`runPolicyMCEvaluationV3`).
- `ilp.js` — dependency-free branch-and-cut ILP solver used by the worker.
- `d4cubeoptimv3-rules-solver.js` — secondary, purely rules-based solver evaluated against the LAO* optimizer via the shared MC engine. `RULES_V3` is an ordered array of `{name, when(ctx), pick(ctx)}` rules, first match wins; all helpers are dependency-injected (see `REQUIRED_HELPERS`) so the module imports nothing. Actions must come from `helpers.getValidActions(...)` output, which enforces GA protection and enchant legality.
- `config.js` — class/skill/affix catalogs and `MODEL_VERSION` / `LEARNED_WEIGHTS`.
- `gear-slot-legality.js` — which affixes are legal on which gear slot.
- `weight-tracking.js` — outcome tracking + Bayesian weight learning (Plackett–Luce, MM/Zermelo update); the single source of truth for the weight model, shared by browser and Node.
- `rust/pkg-web/`, `rust/pkg-no-modules/` — **prebuilt** wasm-bindgen artifacts of the Rust port (`d4optimizer`). The Rust source is not in this repo; the `.wasm` binaries are compiled in the source repo and committed here. The worker lazy-loads the no-modules build via `importScripts` + `wasm_bindgen(...)` and silently falls back to the JS path if loading fails (`D4_USE_RUST` gate). The Rust solver is kept output-identical to the JS solver.

## Module pattern

Every JS module uses a UMD-style wrapper so it loads three ways: `require()` in Node (source-repo tests/scripts), `importScripts()` in the worker, and `<script src>` in the page, exposing a `d4cubeoptim*` global. Preserve this pattern when adding modules. The worker also optionally `importScripts` modules not present in this repo (e.g. `random-forest.js`) inside try/catch — missing optional modules are normal here.

## Versioning conventions (important when deploying changes)

- Bump `WORKER_VERSION` in `index.html` whenever the worker, `ilp.js`, the rules solver, or the WASM changes. The worker reads its own `?v=` query param and appends it to the WASM URLs, so this one bump cache-busts the whole solver stack; without it browsers keep serving stale workers/WASM.
- Bump `MODEL_VERSION` in `config.js` whenever the affix-roll weight model changes — it invalidates users' persisted outcome-tracking data.
