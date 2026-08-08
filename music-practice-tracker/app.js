// app.js — controller for the "music-practice-tracker" SPA.
//
// Wires the frozen DOM (header form + exercise list + details modal) to the
// IndexedDB persistence layer in db.js. Every (instrument, book, chapter)
// triple maps to ONE document; writes go through mutateChapter with optimistic
// concurrency control (OCC) so multiple tabs converge to per-field
// last-write-wins with no user-facing errors.

import {
  APP_GUID,
  DB_VERSION,
  chapterKey,
  newChapterDoc,
  openDb,
  getChapter,
  getMostRecentChapter,
  listChapters,
  VersionConflictError,
  mutateChapter,
  deleteChapter,
  restoreChapter,
  replaceAllChapters,
} from "./db.js";

/* ------------------------------------------------------------------ *
 * DOM references (all ids/classes come from the frozen contract).
 * ------------------------------------------------------------------ */
const instrumentInput = document.getElementById("instrument");
const bookInput = document.getElementById("book");
const chapterInput = document.getElementById("chapter");
const instrumentClearBtn = document.getElementById("instrument-clear");
const bookClearBtn = document.getElementById("book-clear");
const chapterClearBtn = document.getElementById("chapter-clear");
const instrumentList = document.getElementById("instrument-list");
const bookList = document.getElementById("book-list");
const chapterList = document.getElementById("chapter-list");
const minInput = document.getElementById("min");
const maxInput = document.getElementById("max");
const numberingSelect = document.getElementById("numbering");
const numberingHint = document.getElementById("numbering-hint");
const randomizeBtn = document.getElementById("randomize-btn");
const clearBtn = document.getElementById("clear-btn");
const deleteBtn = document.getElementById("delete-btn");
const resetFocusBtn = document.getElementById("reset-focus-btn");
// Undo lives in the form's action bar, not the list toolbar: it now reverses
// Randomize and chapter Delete too, so it is not an Edit-List-mode control.
const undoBtn = document.getElementById("undo-btn");
const progressCounter = document.getElementById("progress-counter");
const listActions = document.getElementById("list-actions");
const editListBtn = document.getElementById("edit-list-btn");
const sortBtn = document.getElementById("sort-btn");
const newExerciseBtn = document.getElementById("new-exercise-btn");
const newExerciseNameInput = document.getElementById("new-exercise-name");
const exerciseList = document.getElementById("exercise-list");

// Data panel (export / import). #import-file is visually hidden and clicked by
// #import-btn, so the visible control is a .btn like everything else.
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file");
const undoImportBtn = document.getElementById("undo-import-btn");
const dataStatus = document.getElementById("data-status");

const detailsModal = document.getElementById("details-modal");
const modalTitle = document.getElementById("modal-title");
const modalCheck = document.getElementById("modal-check");
const modalFocusSlot = document.getElementById("modal-focus-slot");
const modalFocusLabel = document.getElementById("modal-focus-label");
const modalComment = document.getElementById("modal-comment");
const modalSave = document.getElementById("modal-save");
const modalCancel = document.getElementById("modal-cancel");

/* ------------------------------------------------------------------ *
 * In-memory state.
 * ------------------------------------------------------------------ */
// The document for the currently-shown triple, or null when that triple has
// no saved doc. Its `version` is the OCC expected-version baseline.
let currentDoc = null;
// Which exercise the modal is currently editing, plus the on-open snapshot
// used to implement a true Cancel (undo, even of throttle-saved edits).
let modalName = null;
let modalSnapshot = null;
// The modal's copy of the three-state focus toggle. Built once by wireEvents()
// rather than declared here, because buildFocusToggle() reads the ICONS table,
// which is initialized further down this module.
let modalFocusBtn = null;

// Cached chapter list, used to build the datalists synchronously on every
// keystroke without hitting the DB each time. Refreshed after mutations.
let chaptersCache = [];

// Edit List mode: purely a UI state, deliberately NOT persisted. Every page
// load and every chapter switch starts with it off.
let editMode = false;
// Undo history, newest last. Every undoable action snapshots the WHOLE chapter
// document rather than describing its own inverse, so one mechanism covers
// Sort, both Randomize paths, add/delete exercise, a numbering-system rename,
// and chapter Delete. Entry shape:
//
//   { key, triple, before: <clone|null>, after: <clone|null> }
//
// `before` is the restore target (null = the chapter did not exist yet, so
// undoing removes it); `after` is the merge base, filled in once the action's
// write lands (null = the action deleted the chapter). See mergeRestore().
//
// The stack is GLOBAL, not per-chapter: each entry carries its own triple, so
// Undo can reach back into a chapter you have navigated away from — which is
// what makes an undoable chapter Delete possible. It is therefore NOT cleared
// by a chapter switch, Reset Form, Randomize, or leaving Edit List mode; only
// a page load empties it. In-memory and never persisted, capped so a long
// session cannot grow it without bound.
const UNDO_LIMIT = 20;
let undoStack = [];

// The whole-database snapshot Import takes before it overwrites, and the only
// thing #undo-import-btn can restore. null means "no import this session".
//
// This is deliberately NOT an entry on undoStack. That stack is per-chapter —
// its entries carry a key, a triple, and two document clones merged by
// mergeRestore — and a whole-store replace has no representation there. It is
// also in-memory only, exactly like undoStack, so a reload makes an import
// permanent.
let importBackup = null;

/* ------------------------------------------------------------------ *
 * Small pure helpers.
 * ------------------------------------------------------------------ */
const firstLine = (s) => (s || "").split("\n")[0];

// Does this comment genuinely need the modal's textarea? A newline is only
// "multi-line" if something non-whitespace follows it, so pressing Enter once at
// the end of a line — or leaving a trailing blank line behind — does not lock the
// row's one-line box. Without that tolerance, using the expanded modal at all
// tended to lock the small bar the user actually wanted to keep typing in.
const isMultiline = (s) => /\n/.test((s || "").replace(/\s+$/, ""));

// Fisher–Yates shuffle on a COPY (never mutates the input array).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Strict integer parse: accepts only optional sign + digits, no decimals/exp.
function parseIntStrict(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * Numbering systems.
 *
 * An exercise's identity has always been an arbitrary string (the key in
 * doc.exercises), so a numbering system is purely a codec between that string
 * and a 1-based index: label(n) spells index n, parse(s) reads a name back.
 * parse() returns null for anything the scheme does not own, which is what lets
 * a list that still holds names from a previous scheme keep working — those
 * names are simply skipped when picking the next one, exactly as non-numeric
 * names always were.
 *
 * `textInput` says whether #min/#max accept scheme labels instead of digits.
 * Only the letter schemes do; Roman numerals are entered as ordinary numbers
 * (type 1 and 5, get I through V) because typing "IV" into a range box is far
 * more error-prone than typing "4".
 * ------------------------------------------------------------------ */
const LOWER = "abcdefghijklmnopqrstuvwxyz";

// A numeric suffix after one alphabet is exhausted: the letter cycles every 26
// and the suffix counts which pass it is, so index 27 is "a2" and 53 is "a3".
// (This replaced an earlier "aa"/"aaa" doubling spelling — see
// legacyLetterParse() and backfillLetterNumbering() below, which migrate any
// exercise names still minted under it the first time their chapter loads.)
function letterLabel(n, alphabet) {
  const i = n - 1;
  const letter = alphabet[i % 26];
  const cycle = Math.floor(i / 26); // 0-based: 0 = first pass through a-z
  return cycle === 0 ? letter : `${letter}${cycle + 1}`;
}

function letterParse(s, alphabet) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || !alphabet.includes(t[0])) return null;
  const rest = t.slice(1);
  if (rest === "") return alphabet.indexOf(t[0]) + 1;
  // The suffix must be a bare integer >= 2 — "a1" is not a valid spelling of
  // index 1 ("a" already is that), and anything else (including a second
  // letter, as in the old "aa" spelling) belongs to no index in this scheme.
  if (!/^[1-9][0-9]*$/.test(rest)) return null;
  const cycle = Number(rest) - 1;
  if (cycle < 1) return null;
  return alphabet.indexOf(t[0]) + 26 * cycle + 1;
}

// The OLD doubling spelling this replaced: one letter repeated N times, so "a"
// is index 1, "aa" is 27, "aaa" is 53. Kept only so backfillLetterNumbering()
// can recognize and migrate names minted under it — new documents never write
// this shape, and it is never used by letterLabel()/letterParse() above.
function legacyLetterParse(s, alphabet) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || !alphabet.includes(t[0])) return null;
  for (const ch of t) if (ch !== t[0]) return null;
  return alphabet.indexOf(t[0]) + 26 * (t.length - 1) + 1;
}

const ROMAN = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function romanLabel(n) {
  let rest = n;
  let out = "";
  for (const [value, sym] of ROMAN) {
    while (rest >= value) {
      out += sym;
      rest -= value;
    }
  }
  return out;
}

// Decode by summing symbols, then require that re-encoding reproduces the input.
// That round-trip is the whole validation: it accepts "IV" and "MMMM" (4000 has
// no shorter standard spelling) while rejecting "IIII" and "IC".
function romanParse(s) {
  if (typeof s !== "string") return null;
  const t = s.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(t)) return null;
  let n = 0;
  let i = 0;
  while (i < t.length) {
    const two = ROMAN.find(([, sym]) => sym === t.slice(i, i + 2));
    const one = ROMAN.find(([, sym]) => sym === t[i]);
    const hit = two || one;
    if (!hit) return null;
    n += hit[0];
    i += hit[1].length;
  }
  return romanLabel(n) === t ? n : null;
}

// A short, self-generating explanation of the letter wrap for #numbering-hint.
// Built from letterLabel() itself (indexes 27/28/53) rather than hardcoded
// strings, so it can never drift out of sync with its actual spelling. Only
// the letter schemes get one — numbers and Roman numerals never wrap into a
// shape the select doesn't already make obvious.
function letterWrapHint(alphabet) {
  const last = alphabet[25];
  return (
    `After ${last}, numbering continues ${letterLabel(27, alphabet)}, ` +
    `${letterLabel(28, alphabet)}, … then ${letterLabel(53, alphabet)}, …`
  );
}

const NUMBERING = {
  numbers: {
    textInput: false,
    label: (n) => String(n),
    parse: parseIntStrict,
  },
  "letters-upper": {
    textInput: true,
    label: (n) => letterLabel(n, LOWER.toUpperCase()),
    parse: (s) => letterParse(s, LOWER.toUpperCase()),
    wrapHint: () => letterWrapHint(LOWER.toUpperCase()),
  },
  "letters-lower": {
    textInput: true,
    label: (n) => letterLabel(n, LOWER),
    parse: (s) => letterParse(s, LOWER),
    wrapHint: () => letterWrapHint(LOWER),
  },
  roman: {
    textInput: false,
    label: romanLabel,
    parse: romanParse,
  },
};

const DEFAULT_NUMBERING = "numbers";

// The UI selection. Mirrors the loaded chapter's numbering_system, and is what
// the write mutators stamp onto the document — the select is the user's intent,
// so it wins over whatever the doc last said.
let numberingSystem = DEFAULT_NUMBERING;

// Documents saved before numbering_system existed lack the field; absent = numbers.
function schemeOf(doc) {
  return NUMBERING[(doc && doc.numbering_system) || ""] || NUMBERING[DEFAULT_NUMBERING];
}

function activeScheme() {
  return NUMBERING[numberingSystem] || NUMBERING[DEFAULT_NUMBERING];
}

// Only the two letter schemes ever used the old doubling spelling.
const LEGACY_LETTER_ALPHABETS = {
  "letters-upper": LOWER.toUpperCase(),
  "letters-lower": LOWER,
};

// A document minted under the old "aa"/"bb" doubling spelling for a letters
// system is silently re-spelled to the current "a2"/"b2" suffix spelling the
// first time it loads (see loadIntoForm-adjacent call sites below). Every name
// maps 1:1 to the same 1-based index via buildRenameMap (defined further down,
// but a hoisted function declaration like this one), carrying its completion
// state, comment and focus with it exactly like a user-initiated numbering
// change — so nothing is lost, which is also why this is never pushed onto the
// undo stack: it is a transparent migration, not an edit. Pure: returns a NEW
// document, or null if nothing needs to change.
function backfillLetterNumbering(doc) {
  if (!doc || !doc.exercises) return null;
  const alphabet = LEGACY_LETTER_ALPHABETS[doc.numbering_system];
  if (!alphabet) return null;

  const scheme = NUMBERING[doc.numbering_system];
  const names = Object.keys(doc.exercises);
  const legacyScheme = { parse: (s) => legacyLetterParse(s, alphabet) };
  const renames = buildRenameMap(names, legacyScheme, scheme);
  if (renames.size === 0) return null;

  const exercises = {};
  for (const name of names) exercises[renames.get(name) || name] = doc.exercises[name];
  const next = { ...doc, exercises };
  if (doc.randomization) {
    next.randomization = doc.randomization.map((n) => renames.get(n) || n);
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Focus states.
 *
 * Every exercise sits in one of three practice categories: "focused" (drill
 * this), "normal", or "paused" (shelved, but not deleted). The category is a
 * per-exercise field, `focus`, and it is ABSENT on every document written
 * before this feature — read it only through focusOf(), which treats absent as
 * "normal". That absence is why this needed no DB_VERSION bump or migration,
 * the same trick custom_list and numbering_system already use.
 *
 * The category never partitions the exercise SET, only its ORDER: randomization
 * shuffles within each category and concatenates focused -> normal -> paused,
 * and Sort uses the same rank as its leading key. Stating that order once, here,
 * is what stops the two Randomize paths and Sort from drifting apart.
 * ------------------------------------------------------------------ */
const DEFAULT_FOCUS = "normal";
// The cycle a press walks: normal -> focused -> paused -> normal.
const FOCUS_CYCLE = ["normal", "focused", "paused"];
// Display/sort order, which is deliberately NOT the cycle order.
const FOCUS_RANK = { focused: 0, normal: 1, paused: 2 };

function focusOf(doc, name) {
  const ex = doc && doc.exercises && doc.exercises[name];
  const value = ex && ex.focus;
  return FOCUS_RANK[value] !== undefined ? value : DEFAULT_FOCUS;
}

function nextFocus(state) {
  const at = FOCUS_CYCLE.indexOf(state);
  return FOCUS_CYCLE[(at + 1) % FOCUS_CYCLE.length];
}

function focusRank(doc, name) {
  return FOCUS_RANK[focusOf(doc, name)];
}

// Split `names` into the three category buckets, each keeping its input order.
// Pure: never mutates either argument.
function partitionByFocus(doc, names) {
  const buckets = { focused: [], normal: [], paused: [] };
  for (const name of names) buckets[focusOf(doc, name)].push(name);
  return buckets;
}

// The shared randomization order: shuffled inside each category, categories
// concatenated best-first. Both Randomize paths go through this.
function shuffleByFocus(doc, names) {
  const buckets = partitionByFocus(doc, names);
  return [
    ...shuffle(buckets.focused),
    ...shuffle(buckets.normal),
    ...shuffle(buckets.paused),
  ];
}

/* ------------------------------------------------------------------ *
 * Sort order.
 *
 * The stored order is a practice shuffle, which makes finding one specific
 * exercise (to tick off, or to delete once it is finished) a linear scan. Sort
 * rewrites it into the order you actually prune in: focus category first
 * (focused, then normal, then paused — the same ranking randomization uses), then
 * still-unfinished exercises before finished ones, each group climbing by
 * exercise number.
 *
 * "By number" means by the 1-based INDEX the chapter's numbering system parses
 * out of the name, never by the spelling — that is what puts `z` (26) before
 * `a2` (27) and `IX` (9) before `X` (10), where a string compare would get both
 * backwards. A list may legitimately hold names minted under an older scheme
 * that the current one cannot read (invariant 14); those have no index to sort
 * by, so they settle at the end of their group in plain alphabetical order.
 * ------------------------------------------------------------------ */
function sortKey(doc, name) {
  const ex = doc && doc.exercises && doc.exercises[name];
  const index = schemeOf(doc).parse(name);
  return {
    rank: focusRank(doc, name),
    done: !!(ex && ex.completed),
    index: index !== null && index >= 1 ? index : null,
    name,
  };
}

function compareSortKeys(a, b) {
  // Focus category outranks everything: focused block, then normal, then paused.
  if (a.rank !== b.rank) return a.rank - b.rank;
  // Unfinished work first; everything already done sinks to the bottom.
  if (a.done !== b.done) return a.done ? 1 : -1;
  // Within a group, unparseable names trail the numbered ones.
  if ((a.index === null) !== (b.index === null)) return a.index === null ? 1 : -1;
  if (a.index !== null && a.index !== b.index) return a.index - b.index;
  return a.name.localeCompare(b.name);
}

// The sorted order for `names`, read against `doc` for completion state and
// numbering. Pure: never mutates either argument.
function sortedOrder(doc, names) {
  return names
    .map((name) => sortKey(doc, name))
    .sort(compareSortKeys)
    .map((k) => k.name);
}

// #min/#max always hold an INDEX. Under a letter scheme the box shows and reads
// that index as a label; otherwise it is plain digits.
function parseRangeValue(value) {
  const scheme = activeScheme();
  const n = scheme.textInput ? scheme.parse(value) : parseIntStrict(value);
  return n !== null && n >= 1 ? n : null;
}

function formatRangeValue(n) {
  const scheme = activeScheme();
  return scheme.textInput ? scheme.label(n) : String(n);
}

// Returns {instrument, book, chapter} (trimmed) only when all three are set.
function readTriple() {
  const instrument = instrumentInput.value.trim();
  const book = bookInput.value.trim();
  const chapter = chapterInput.value.trim();
  if (!instrument || !book || !chapter) return null;
  return { instrument, book, chapter };
}

function tripleEq(a, b) {
  return (
    !!a &&
    !!b &&
    a.instrument === b.instrument &&
    a.book === b.book &&
    a.chapter === b.chapter
  );
}

function ensureExercise(doc, name) {
  if (!doc.exercises) doc.exercises = {};
  if (!doc.exercises[name]) {
    doc.exercises[name] = { completed: false, completed_at: null, comment: "" };
  }
}

function ensureExerciseCurrent(name) {
  if (!currentDoc) return;
  ensureExercise(currentDoc, name);
}

function findRow(name) {
  return (
    Array.from(exerciseList.children).find(
      (el) => el.dataset && el.dataset.name === name
    ) || null
  );
}

/* ------------------------------------------------------------------ *
 * Custom (non-contiguous) list helpers.
 *
 * A chapter becomes a "custom list" the moment the user adds or deletes a
 * single exercise. The flag is sticky: it stays set even if the surviving
 * names happen to be contiguous again, and Undo does not clear it. Only a
 * deliberate Randomize with both range boxes filled in flips it back off.
 * ------------------------------------------------------------------ */
// Documents saved before custom_list existed lack the field; absent = contiguous.
function isCustomList() {
  return !!(currentDoc && currentDoc.custom_list);
}

// The name for a brand-new exercise, in the document's own numbering system:
// the lowest free index between the smallest and largest ones already present,
// so deleting exercise 3 out of 1-5 and adding one gets 3 back instead of 6.
// Only when min..max is saturated does it extend past the end. Names the scheme
// cannot parse are ignored (a list of only those starts back at index 1), and
// the final loop guarantees the result is actually free.
function nextExerciseName(doc) {
  const scheme = schemeOf(doc);
  const keys = Object.keys((doc && doc.exercises) || {});
  const taken = new Set();
  for (const key of keys) {
    const n = scheme.parse(key);
    if (n !== null && n >= 1) taken.add(n);
  }

  let index = 1;
  if (taken.size > 0) {
    const min = Math.min(...taken);
    const max = Math.max(...taken);
    index = max + 1;
    for (let i = min; i <= max; i++) {
      if (!taken.has(i)) {
        index = i;
        break;
      }
    }
  }

  let name = scheme.label(index);
  while (doc && doc.exercises && doc.exercises[name]) {
    index++;
    name = scheme.label(index);
  }
  return name;
}

// The authoritative comment value for a write: while the modal is open for the
// exercise being written, the textarea wins (so throttle retries pick up the
// latest keystrokes); otherwise fall back to the in-memory record.
function currentCommentValue(name) {
  if (modalName === name && detailsModal.open) return modalComment.value;
  if (currentDoc && currentDoc.exercises && currentDoc.exercises[name]) {
    return currentDoc.exercises[name].comment || "";
  }
  return "";
}

// The frozen DOM contract has no dedicated error node, so surface validation
// problems with a simple alert.
function showError(msg) {
  window.alert(msg);
}

/* ------------------------------------------------------------------ *
 * DB warm-up. db.js functions manage their own connection, but openDb()
 * triggers the version upgrade and persistence request; reuse one promise.
 * ------------------------------------------------------------------ */
let dbReady = null;
function ensureDb() {
  if (!dbReady) dbReady = openDb();
  return dbReady;
}

/* ------------------------------------------------------------------ *
 * OCC-retry wrapper around mutateChapter.
 *
 * Uses currentDoc.version (or null for a first create) as the expected
 * version. On a conflict, adopts the newest persisted doc (or a fresh one if
 * it was deleted) and retries ONCE — re-running the mutator on top of that
 * latest doc so the user's intended field change re-applies. Net effect:
 * per-field last-write-wins across tabs with no error shown to the user.
 * ------------------------------------------------------------------ */
async function occ(key, mutator) {
  await ensureDb();
  // Every doc coming back from the DB — a write result or the fresh doc from a
  // conflict — reflects only what is STORED, so it lacks comments the user has
  // typed but that are still queued behind the throttle. Swapping it into
  // currentDoc verbatim would silently wipe them (and the retry mutator, which
  // reads currentDoc, would then persist the blanks). Carry them across.
  const carry = (nextDoc) => {
    // Snapshot HERE, not when occ() was called: edits made during the await
    // need protecting too, and this still reads the pre-swap currentDoc.
    const pending = new Map();
    for (const name of pendingCommentNames) {
      pending.set(name, currentCommentValue(name));
    }
    currentDoc = nextDoc;
    for (const [name, value] of pending) {
      // Skip names the write legitimately removed (a row delete, or a Randomize
      // that dropped them out of range) — those must stay gone, not resurrect.
      if (!currentDoc.exercises || !currentDoc.exercises[name]) continue;
      currentDoc.exercises[name].comment = value;
    }
    return nextDoc;
  };

  const expected = currentDoc ? currentDoc.version : null;
  try {
    return carry(await mutateChapter(key, expected, mutator));
  } catch (err) {
    if (!(err instanceof VersionConflictError)) throw err;
    carry(err.freshDoc || newChapterDoc(key[0], key[1], key[2]));
    return carry(await mutateChapter(key, currentDoc.version, mutator));
  }
}

/* ------------------------------------------------------------------ *
 * Datalists (smart inputs).
 * ------------------------------------------------------------------ */
function distinct(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (v == null) continue;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function setOptions(datalist, values) {
  if (!datalist) return;
  while (datalist.firstChild) datalist.removeChild(datalist.firstChild);
  const frag = document.createDocumentFragment();
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    frag.appendChild(opt);
  }
  datalist.appendChild(frag);
}

// Rebuild all three datalists from the cache (synchronous). Options are ordered
// by recency (last_used_at desc): instruments = all distinct; books = those
// seen for the typed instrument; chapters = those seen for instrument+book.
function rebuildDatalistDom() {
  const i = instrumentInput.value.trim();
  const b = bookInput.value.trim();
  const byRecency = chaptersCache
    .slice()
    .sort((x, y) => (y.last_used_at || 0) - (x.last_used_at || 0));
  setOptions(instrumentList, distinct(byRecency.map((d) => d.instrument)));
  setOptions(
    bookList,
    distinct(byRecency.filter((d) => d.instrument === i).map((d) => d.book))
  );
  setOptions(
    chapterList,
    distinct(
      byRecency
        .filter((d) => d.instrument === i && d.book === b)
        .map((d) => d.chapter)
    )
  );
}

// Re-query the DB and rebuild the datalist DOM. Called on load and after any
// mutation that can add a triple or change recency ordering.
async function refreshDatalists() {
  await ensureDb();
  try {
    chaptersCache = await listChapters();
  } catch {
    if (!Array.isArray(chaptersCache)) chaptersCache = [];
  }
  rebuildDatalistDom();
}

/* ------------------------------------------------------------------ *
 * Inline SVG icons.
 *
 * All four are 16x16, stroked or filled with `currentColor`, so the existing
 * theme tokens (and the .ex-delete danger color) drive them in light and dark
 * with no extra rules. They are literal strings defined here and are the ONLY
 * thing ever assigned to innerHTML in this file — never user content.
 * ------------------------------------------------------------------ */
const SVG_OPEN =
  '<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"';

const ICONS = {
  // Delete row: a clean two-stroke ×, round-capped so it reads as drawn rather
  // than as the "×" character the button used to hold.
  close:
    `${SVG_OPEN} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">` +
    '<path d="M4 4l8 8M12 4l-8 8"/></svg>',
  // Expand: arrows pushing out to opposite corners of the box.
  expand:
    `${SVG_OPEN} fill="none" stroke="currentColor" stroke-width="1.7" ` +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9.5 2.5H13.5V6.5M6.5 13.5H2.5V9.5M13.5 2.5L9 7M2.5 13.5L7 9"/></svg>',
  // Focused: a bullseye drawn as a reticle — a ring, a solid center, and four
  // crosshair ticks crossing it. The ticks are what make it read as "target" at
  // 16px; two plain concentric rings alone looked like a dot in a circle.
  bullseye:
    `${SVG_OPEN} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">` +
    '<circle cx="8" cy="8" r="5.5"/>' +
    '<path d="M8 .9V4.4M8 11.6V15.1M.9 8H4.4M11.6 8H15.1"/>' +
    '<circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none"/></svg>',
  // Paused: the standard two-bar pause glyph.
  pause:
    `${SVG_OPEN} fill="currentColor">` +
    '<rect x="4" y="3" width="3" height="10" rx="1"/>' +
    '<rect x="9" y="3" width="3" height="10" rx="1"/></svg>',
};

// The three-state toggle, used identically on a row and in the modal: one
// button holding BOTH icons, with CSS lighting whichever one the current
// data-focus names (and dimming both for "normal").
function buildFocusToggle(className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.innerHTML =
    `<span class="focus-icon focus-icon-focused">${ICONS.bullseye}</span>` +
    `<span class="focus-icon focus-icon-paused">${ICONS.pause}</span>`;
  return btn;
}

const FOCUS_LABEL = {
  normal: "normal",
  focused: "focused",
  paused: "paused",
};

// One place sets every surface that shows a focus state: the row (whose
// data-focus drives both the lit icon and the row-level dim/accent) and, when
// the modal is on that exercise, the modal's copy of the toggle.
function syncRowFocus(name) {
  const state = focusOf(currentDoc, name);
  const row = findRow(name);
  if (row) {
    row.dataset.focus = state;
    const btn = row.querySelector(".ex-focus");
    if (btn) {
      btn.dataset.focus = state;
      btn.setAttribute(
        "aria-label",
        `Exercise ${name} is ${FOCUS_LABEL[state]}; change practice focus`
      );
    }
  }
  if (detailsModal.open && modalName === name) {
    modalFocusBtn.dataset.focus = state;
    modalFocusLabel.textContent = FOCUS_LABEL[state];
  }
}

/* ------------------------------------------------------------------ *
 * Rendering.
 * ------------------------------------------------------------------ */
function clearExerciseList() {
  while (exerciseList.firstChild) exerciseList.removeChild(exerciseList.firstChild);
}

function clearCounter() {
  progressCounter.textContent = "";
}

// Paused exercises are shelved, so they count towards neither side of the
// progress fraction. The trailing "N paused" is what keeps that honest: without
// it, "3 of 8 complete" silently contradicts a visible list of eleven rows.
function updateCounter() {
  let total = 0;
  let done = 0;
  let paused = 0;
  if (currentDoc && currentDoc.randomization) {
    for (const name of currentDoc.randomization) {
      if (focusOf(currentDoc, name) === "paused") {
        paused++;
        continue;
      }
      total++;
      const ex = currentDoc.exercises[name];
      if (ex && ex.completed) done++;
    }
  }
  progressCounter.textContent =
    `${done} of ${total} complete` + (paused > 0 ? ` · ${paused} paused` : "");
}

// Point #min/#max at the active scheme: the letter schemes take text, numbers
// and Roman numerals take digits. A value that no longer parses under the new
// scheme is cleared rather than left sitting there for Randomize to reject.
function syncNumberingInputs() {
  const scheme = activeScheme();
  const type = scheme.textInput ? "text" : "number";
  for (const [el, sample] of [[minInput, 1], [maxInput, 12]]) {
    if (el.type !== type) el.type = type;
    el.inputMode = scheme.textInput ? "text" : "numeric";
    el.placeholder = scheme.label(sample);
    if (el.value.trim() !== "" && parseRangeValue(el.value) === null) el.value = "";
  }
  // Only the letter schemes carry a wrapHint (see letterWrapHint above); the
  // element is :empty-hidden for numbers/roman, where there is nothing
  // non-obvious about what comes after 12 or XII.
  numberingHint.textContent = scheme.wrapHint ? scheme.wrapHint() : "";
}

// Adopt a numbering system into the UI. Unknown/absent names fall back to
// numbers, so a document from before this feature loads unchanged.
function applyNumberingSystem(name) {
  numberingSystem = NUMBERING[name] ? name : DEFAULT_NUMBERING;
  numberingSelect.value = numberingSystem;
  syncNumberingInputs();
}

// last_range always stores INDEXES, so the boxes are re-spelled on the way in.
function populateRange(range) {
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
    minInput.value = formatRangeValue(range.min);
    maxInput.value = formatRangeValue(range.max);
  } else if (isCustomList()) {
    // A custom list carries last_range === null. Blank the boxes rather than
    // leaving the previous chapter's digits sitting in disabled inputs, and
    // so that Randomize sees "no range" and takes the reshuffle-in-place path.
    minInput.value = "";
    maxInput.value = "";
  }
  syncRangeLock();
}

// min/max only govern a contiguous chapter. Disable them for a custom list,
// except inside Edit List mode, where typing a range (then pressing Randomize)
// is the deliberate way back to contiguous numbering.
function syncRangeLock() {
  const locked = isCustomList() && !editMode;
  minInput.disabled = locked;
  maxInput.disabled = locked;
}

// The list toolbar is meaningless with nothing on screen.
function syncListToolbar() {
  const hasList = !!(currentDoc && currentDoc.randomization);
  listActions.classList.toggle("hidden", !hasList);
  if (!hasList && editMode) setEditMode(false);
}

function refreshUndoBtn() {
  undoBtn.disabled = undoStack.length === 0;
}

function setEditMode(on) {
  editMode = !!on;
  // The label names the action the button performs, so it flips with the state;
  // .editing supplies the active color on top of that.
  editListBtn.textContent = editMode ? "Exit Edit" : "Edit List";
  editListBtn.classList.toggle("editing", editMode);
  editListBtn.setAttribute("aria-pressed", editMode ? "true" : "false");
  listActions.classList.toggle("edit-mode", editMode);
  exerciseList.classList.toggle("edit-mode", editMode);
  syncRangeLock();
  if (editMode) {
    refreshNewExercisePlaceholder();
  } else {
    // #new-exercise-name always starts empty; leaving Edit List mode (Exit
    // Edit, Reset Form, Delete, any Randomize, a chapter switch, or page
    // load — every path runs through resetEditState()) resets it in case it
    // held an untouched or partially-typed value, and drops any pending
    // live-validity check so it can't fire against a hidden, cleared input.
    cancelNewExerciseNameCheck();
    newExerciseNameInput.value = "";
    newExerciseNameInput.classList.remove("invalid");
  }
}

// Leaving a chapter drops Edit List mode, but deliberately NOT the undo
// history: entries carry their own triple, so an undo remains valid (and
// reachable) after you have navigated elsewhere. Only a page load clears it.
function resetEditState() {
  setEditMode(false);
}

// Build one .exercise-row using exactly the frozen classes.
function buildRow(name) {
  const ex =
    (currentDoc && currentDoc.exercises[name]) ||
    { completed: false, completed_at: null, comment: "" };

  const row = document.createElement("div");
  row.className = "exercise-row" + (ex.completed ? " completed" : "");
  row.dataset.name = name;
  // Drives the paused dimming / focused accent; the toggle's own lit icon is
  // keyed off its matching data-focus, set by syncRowFocus below.
  row.dataset.focus = focusOf(currentDoc, name);

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "ex-check";
  check.checked = !!ex.completed;
  check.addEventListener("change", () => toggleCompleted(name, check.checked));

  const nameSpan = document.createElement("span");
  nameSpan.className = "ex-name";
  nameSpan.textContent = "Exercise " + name;

  const oneline = document.createElement("input");
  oneline.type = "text";
  oneline.className = "ex-oneline";
  oneline.readOnly = isMultiline(ex.comment);
  oneline.value = firstLine(ex.comment);
  // Locked (multi-line) rows open the modal on click; unlocked rows are
  // directly editable, so a click just focuses the box like any text input.
  oneline.addEventListener("click", () => {
    if (oneline.readOnly) openModal(name);
  });
  // Direct single-line editing, bypassing the modal entirely. An <input
  // type="text"> can't hold newlines, so this can never produce multi-line
  // content; the replace() is a defensive no-op against odd paste behavior.
  oneline.addEventListener("input", () => {
    if (oneline.readOnly || !currentDoc) return;
    ensureExerciseCurrent(name);
    const value = oneline.value.replace(/\r?\n/g, " ");
    if (value !== oneline.value) oneline.value = value;
    currentDoc.exercises[name].comment = value;
    scheduleCommentPersist(name);
  });

  // Icon-only: the glyph is the label, and the aria-label carries the name.
  const details = document.createElement("button");
  details.type = "button";
  details.className = "ex-details";
  details.innerHTML = ICONS.expand;
  details.setAttribute("aria-label", "Expand exercise " + name);
  details.addEventListener("click", () => openModal(name));

  // Focus toggle and delete are both built on every row but hidden by CSS
  // unless #exercise-list has .edit-mode, so toggling Edit List never
  // re-renders (and never interrupts typing).
  const focus = buildFocusToggle("ex-focus");
  focus.addEventListener("click", () => cycleFocus(name));

  const del = document.createElement("button");
  del.type = "button";
  del.className = "ex-delete";
  del.innerHTML = ICONS.close;
  del.setAttribute("aria-label", "Delete exercise " + name);
  del.addEventListener("click", () => deleteExercise(name));

  row.append(check, nameSpan, oneline, details, focus, del);
  // Stamps the toggle's data-focus + aria-label from the row it now lives in.
  focus.dataset.focus = row.dataset.focus;
  focus.setAttribute(
    "aria-label",
    `Exercise ${name} is ${FOCUS_LABEL[row.dataset.focus]}; change practice focus`
  );
  return row;
}

// Keeps #new-exercise-name's placeholder honest with whatever
// nextExerciseName(currentDoc) would mint right now. Called from renderList()
// (covers autoload/switch, Undo, Randomize/Sort, numbering rename, init) and
// from setEditMode(true); addExercise()/deleteExercise() call it explicitly
// too, since both intentionally skip renderList() for performance.
function refreshNewExercisePlaceholder() {
  newExerciseNameInput.placeholder = currentDoc ? nextExerciseName(currentDoc) : "";
}

// Render the whole list from currentDoc.randomization (in order).
function renderList() {
  clearExerciseList();
  refreshNewExercisePlaceholder();
  if (!currentDoc || !currentDoc.randomization) {
    clearCounter();
    syncListToolbar();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const name of currentDoc.randomization) frag.appendChild(buildRow(name));
  exerciseList.appendChild(frag);
  updateCounter();
  syncListToolbar();
}

// Sync a single row's completed state (class + checkbox) from currentDoc.
function updateRowCompleted(name) {
  const row = findRow(name);
  if (!row) return;
  const ex = currentDoc && currentDoc.exercises[name];
  const done = !!(ex && ex.completed);
  row.classList.toggle("completed", done);
  const check = row.querySelector(".ex-check");
  if (check) check.checked = done;
}

// Refresh a single row's one-line comment preview from currentDoc. Called live
// while the modal types, so the small bar mirrors the textarea and unlocks or
// relocks the moment the content crosses the single-line boundary.
function refreshRowPreview(name) {
  const row = findRow(name);
  if (!row) return;
  const oneline = row.querySelector(".ex-oneline");
  if (!oneline) return;
  const comment = (currentDoc && currentDoc.exercises[name] && currentDoc.exercises[name].comment) || "";
  oneline.readOnly = isMultiline(comment);
  // Never write .value into the box the user is typing in: assigning it would
  // jump the caret to the end mid-word.
  if (oneline !== document.activeElement) oneline.value = firstLine(comment);
}

/* ------------------------------------------------------------------ *
 * Edit List mode: structural add/delete of individual exercises.
 *
 * Both operations mark the chapter as a custom list and null out last_range,
 * which is what greys the range inputs and switches Randomize to reshuffling
 * in place. Neither touches last_used_at: recency means "chapters you were
 * recently working in", and only top-level field edits and Randomize bump it.
 *
 * Every mutator here is written to converge on a desired state (filter a name
 * out; ensure a name present) rather than to apply a positional delta, so that
 * occ()'s single retry can safely re-run it against a fresher document.
 * ------------------------------------------------------------------ */
function currentKey() {
  const triple = readTriple();
  if (!triple) return null;
  return chapterKey(triple.instrument, triple.book, triple.chapter);
}

// Drop a pending throttled comment write, but only when it targets `name`.
// Without this, deleting a row that was just typed into would let the trailing
// flush re-create the exercise record moments after the delete landed.
function discardPendingCommentFor(name) {
  if (commentTargetName === name) cancelCommentThrottle();
}

// Thrown INSIDE the occ() mutator in addExercise() when the resolved name
// already exists. Deliberately NOT a VersionConflictError: mutateChapter
// aborts its transaction on ANY mutator throw (before next.version/store.put
// are reached, so nothing persists — see db.js), and occ() only retries a
// VersionConflictError, so this propagates straight out to addExercise()'s
// catch block instead of being retried.
class DuplicateExerciseNameError extends Error {
  constructor(name) {
    super(`Exercise name "${name}" is already used in this chapter.`);
    this.name = "DuplicateExerciseNameError";
    this.exerciseName = name;
  }
}

/* ------------------------------------------------------------------ *
 * #new-exercise-name live validity check (debounced) and the duplicate-row
 * flash shown at New Exercise click time. See addExercise() below for the
 * actual duplicate check, which runs against the freshest doc inside the
 * occ() mutator; this debounced check is just an earlier, best-effort hint.
 * ------------------------------------------------------------------ */
let newExerciseNameCheckTimer = null;

function cancelNewExerciseNameCheck() {
  if (newExerciseNameCheckTimer !== null) {
    clearTimeout(newExerciseNameCheckTimer);
    newExerciseNameCheckTimer = null;
  }
}

// Trimmed, non-empty match against an existing exercises[] key -> .invalid.
// Debounced (not per-keystroke) purely to keep typing snappy; the check
// itself is a single object-key lookup, so correctness never depends on it —
// the authoritative check is the one inside addExercise()'s occ() mutator.
function checkNewExerciseNameValidity() {
  newExerciseNameCheckTimer = null;
  const trimmed = newExerciseNameInput.value.trim();
  const dup = !!(trimmed && currentDoc && currentDoc.exercises && currentDoc.exercises[trimmed]);
  newExerciseNameInput.classList.toggle("invalid", dup);
}

function onNewExerciseNameInput() {
  cancelNewExerciseNameCheck();
  newExerciseNameCheckTimer = setTimeout(checkNewExerciseNameValidity, 200);
}

// Timers for the 5s duplicate-row highlight, keyed by exercise name, so a
// repeated duplicate attempt against the SAME row replaces the pending
// removal instead of stacking (same idiom as restartLastUsedTimer /
// cancelLastUsedTimer above).
const rowFlashTimers = new Map();

function flashRow(name) {
  const row = findRow(name);
  if (!row) return; // e.g. another tab deleted it; nothing to highlight

  const prior = rowFlashTimers.get(name);
  if (prior !== undefined) clearTimeout(prior);

  // Force the entrance animation to replay even if it's already mid-flight:
  // remove the class, force a reflow, then re-add it — re-adding the same
  // class within the same frame would otherwise be a no-op for @keyframes.
  row.classList.remove("flash-duplicate");
  void row.offsetWidth;
  row.classList.add("flash-duplicate");
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });

  rowFlashTimers.set(
    name,
    setTimeout(() => {
      rowFlashTimers.delete(name);
      const liveRow = findRow(name); // re-look-up: row may be gone by now
      if (liveRow) liveRow.classList.remove("flash-duplicate");
    }, 5000)
  );
}

async function deleteExercise(name) {
  if (!currentDoc || !currentDoc.randomization) return;
  if (currentDoc.randomization.length <= 1) {
    showError("A list needs at least one exercise.");
    return;
  }
  const triple = readTriple();
  const key = currentKey();
  if (!key || !triple) return;

  // Snapshot BEFORE discarding the pending write, so the note the user just
  // typed is captured (snapshotDoc overlays it) and Undo restores it verbatim.
  // discardPendingCommentFor then stops a throttled write from re-creating the
  // record moments after the delete lands — invariant 9.
  const entry = pushUndo(key, triple);
  discardPendingCommentFor(name);
  if (detailsModal.open && modalName === name) detailsModal.close();

  try {
    await occ(key, (doc) => {
      doc.randomization = (doc.randomization || []).filter((n) => n !== name);
      if (doc.exercises) delete doc.exercises[name];
      doc.custom_list = true;
      doc.last_range = null;
      return doc;
    });
  } catch (err) {
    console.error("Delete exercise failed", err);
    popUndo(entry);
    showError("Could not delete that exercise. Please try again.");
    renderList();
    return;
  }

  entry.after = structuredClone(currentDoc);
  const row = findRow(name);
  if (row) row.remove();
  updateCounter();
  populateRange(currentDoc.last_range); // blanks + greys the range boxes
  refreshNewExercisePlaceholder();
}

async function addExercise() {
  if (!currentDoc || !currentDoc.randomization) return;
  const triple = readTriple();
  const key = currentKey();
  if (!key || !triple) return;

  // Trimmed before both the duplicate check and the stored key: a typed name
  // is the first place stray whitespace can enter (machine-generated names
  // never carried it), and untrimmed "7 " vs "7" would display identically
  // as "Exercise 7" while silently failing to dedupe against each other.
  const typed = newExerciseNameInput.value.trim();

  const entry = pushUndo(key, triple);

  // The name is resolved INSIDE the mutator: on an OCC retry the fresh doc may
  // already contain a name this one would have taken (another tab added one,
  // or a stale currentDoc is behind), and a name chosen up front would
  // collide with it. This is the same reasoning nextExerciseName's gap-fill
  // already relies on (invariant 15) — it just now also covers a typed name.
  let addedName = null;
  try {
    await occ(key, (doc) => {
      // Stamp the selection first: nextExerciseName reads the scheme off the doc.
      doc.numbering_system = numberingSystem;
      const name = typed || nextExerciseName(doc);
      if (doc.exercises && doc.exercises[name]) {
        // Abort the transaction cleanly: nothing is persisted (mutateChapter
        // skips version/updated_at and store.put() on any mutator throw), and
        // this is not a VersionConflictError, so occ() rethrows it as-is
        // instead of retrying.
        throw new DuplicateExerciseNameError(name);
      }
      addedName = name;
      ensureExercise(doc, addedName);
      const order = doc.randomization || [];
      doc.randomization = order.includes(addedName)
        ? order
        : [addedName, ...order];
      doc.custom_list = true;
      doc.last_range = null;
      return doc;
    });
  } catch (err) {
    popUndo(entry);
    if (err instanceof DuplicateExerciseNameError) {
      // Scoped, deliberate exception to the showError()/alert() convention
      // used everywhere else in the app: inline highlighting only, no alert.
      newExerciseNameInput.classList.add("invalid");
      flashRow(err.exerciseName);
      return;
    }
    console.error("Add exercise failed", err);
    showError("Could not add an exercise. Please try again.");
    return;
  }

  entry.after = structuredClone(currentDoc);
  exerciseList.prepend(buildRow(addedName));
  updateCounter();
  populateRange(currentDoc.last_range);
  // Clear back to empty and refresh the placeholder to the new
  // nextExerciseName(doc) now that this name is taken.
  cancelNewExerciseNameCheck();
  newExerciseNameInput.value = "";
  newExerciseNameInput.classList.remove("invalid");
  refreshNewExercisePlaceholder();
}

// Reorder the list for pruning: unfinished first, finished at the bottom, each
// group by exercise number. Touches ONLY `randomization` — not custom_list,
// last_range, completion, comments, or the recency counters. Undoable, and
// deliberately unconfirmed: Undo is the safety net, not a dialog.
async function onSort() {
  if (!currentDoc || !currentDoc.randomization) return;
  const triple = readTriple();
  const key = currentKey();
  if (!key || !triple) return;

  const entry = pushUndo(key, triple);

  try {
    await occ(key, (doc) => {
      // Computed from the mutator's OWN doc, so an OCC retry converges on the
      // correct sorted state instead of replaying a stale array.
      doc.randomization = sortedOrder(doc, doc.randomization || []);
      return doc;
    });
  } catch (err) {
    console.error("Sort failed", err);
    popUndo(entry);
    showError("Could not sort the list. Please try again.");
    return;
  }

  entry.after = structuredClone(currentDoc);
  renderList();
}

/* ------------------------------------------------------------------ *
 * Undo.
 *
 * Snapshot the whole document before an action, restore it afterward. This
 * replaced a set of hand-written inverses (delete → reinsert at index, add →
 * remove) because every new undoable action needed another one, and Randomize
 * has no inverse expressible as a delta at all.
 * ------------------------------------------------------------------ */

// Clone currentDoc with any still-unpersisted comments overlaid, so a note the
// user typed seconds ago is inside the snapshot rather than reverted by the
// undo. Deliberately does NOT flushComment(): that would issue a write, and the
// two callers that most need an accurate snapshot (row delete, chapter Delete)
// are about to remove the very record it would write to.
function snapshotDoc() {
  if (!currentDoc) return null;
  const clone = structuredClone(currentDoc);
  for (const name of pendingCommentNames) {
    if (clone.exercises && clone.exercises[name]) {
      clone.exercises[name].comment = currentCommentValue(name);
    }
  }
  return clone;
}

// Take the "before" snapshot and stack it. Call this immediately BEFORE the
// action's write; the caller fills in entry.after once the write lands, and
// pops the entry back off if the write fails.
function pushUndo(key, triple) {
  const entry = {
    key,
    triple: { ...triple },
    before: snapshotDoc(),
    after: null,
  };
  undoStack.push(entry);
  // Oldest first: an in-memory stack of whole documents must stay bounded.
  while (undoStack.length > UNDO_LIMIT) undoStack.shift();
  refreshUndoBtn();
  return entry;
}

function popUndo(entry) {
  const at = undoStack.lastIndexOf(entry);
  if (at !== -1) undoStack.splice(at, 1);
  refreshUndoBtn();
}

// Deep value equality, enough for the plain JSON-ish records stored here.
function sameValue(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => sameValue(a[k], b[k]));
}

/* Three-way merge for Undo.
 *
 * THE CONFLICT RULE, in one line: the other tab wins on anything it touched
 * since the action; everything else reverts to the snapshot.
 *
 * `after` is what the document looked like right after the action, so any
 * field where `live` still equals `after` is untouched and safe to revert;
 * anywhere `live` has moved on, another tab wrote it and keeps it. Note the
 * consequence — with a second tab active, Undo is a merge, not a rewind, and
 * can legitimately produce a state that never previously existed (your
 * pre-sort order back, but the other tab's newer checkbox still ticked).
 * Pure: never mutates its arguments.
 */
function mergeRestore(before, after, live) {
  // Another tab deleted the chapter outright; there is nothing to merge with,
  // so the snapshot simply comes back.
  if (!live) return structuredClone(before);

  const base = after || {};
  const pick = (field) =>
    sameValue(live[field], base[field]) ? before[field] : live[field];

  const beforeEx = before.exercises || {};
  const baseEx = base.exercises || {};
  const liveEx = live.exercises || {};

  const exercises = {};
  const names = new Set([
    ...Object.keys(beforeEx),
    ...Object.keys(baseEx),
    ...Object.keys(liveEx),
  ]);
  for (const name of names) {
    // Presence counts as a value, so an exercise another tab added survives
    // the undo and one it deleted stays deleted.
    const theirs = sameValue(liveEx[name], baseEx[name]) ? beforeEx[name] : liveEx[name];
    if (theirs !== undefined) exercises[name] = structuredClone(theirs);
  }

  // Restore the snapshot's order, minus names that no longer exist, then
  // append anything the merge kept that it does not mention (in the live
  // order, so a concurrent add lands where that tab put it relative to itself).
  const order = (before.randomization || []).filter((n) => exercises[n]);
  const seen = new Set(order);
  for (const name of live.randomization || []) {
    if (exercises[name] && !seen.has(name)) {
      order.push(name);
      seen.add(name);
    }
  }
  for (const name of Object.keys(exercises)) {
    if (!seen.has(name)) {
      order.push(name);
      seen.add(name);
    }
  }

  return {
    instrument: before.instrument,
    book: before.book,
    chapter: before.chapter,
    version: live.version, // restoreChapter overwrites this
    use_count: pick("use_count"),
    last_used_at: pick("last_used_at"),
    last_range: pick("last_range"),
    custom_list: pick("custom_list"),
    numbering_system: pick("numbering_system"),
    randomization: before.randomization === null && order.length === 0 ? null : order,
    randomized_at: pick("randomized_at"),
    exercises,
    updated_at: Date.now(), // restoreChapter overwrites this
  };
}

// Reverse the most recent undoable action, wherever it happened. Navigates to
// that chapter so the result is visible — the action may well have been in a
// chapter the user has since left (in particular, one they deleted).
async function undoLast() {
  if (undoStack.length === 0) return;
  const entry = undoStack.pop();
  refreshUndoBtn();

  // The action being undone may have targeted the chapter on screen, so drop
  // any in-flight comment write before the restore rather than after it.
  cancelCommentThrottle();
  cancelLastUsedTimer();
  if (detailsModal.open) detailsModal.close();
  // Same hazard as chapter Delete: undoing a create removes the document, and a
  // comment write still in flight would put it straight back.
  await drainCommentWrites();

  let restored;
  try {
    restored = await restoreChapter(entry.key, (live) =>
      entry.before === null ? null : mergeRestore(entry.before, entry.after, live)
    );
  } catch (err) {
    console.error("Undo failed", err);
    undoStack.push(entry);
    refreshUndoBtn();
    showError("Could not undo that change. Please try again.");
    return;
  }

  // Navigate to the restored chapter (or away from one that undo removed).
  instrumentInput.value = entry.triple.instrument;
  bookInput.value = entry.triple.book;
  chapterInput.value = entry.triple.chapter;
  currentDoc = restored || null;
  if (currentDoc) {
    applyNumberingSystem(currentDoc.numbering_system);
    populateRange(currentDoc.last_range);
    renderList();
    backfillLetterNumberingIfNeeded();
  } else {
    applyNumberingSystem(DEFAULT_NUMBERING);
    minInput.value = "";
    maxInput.value = "";
    clearExerciseList();
    clearCounter();
    syncListToolbar();
  }
  syncRangeLock();
  refreshDatalists();
}

/* ------------------------------------------------------------------ *
 * Export / import.
 *
 * IndexedDB is per-origin AND per-device, so a phone, a tablet and a laptop
 * each hold an independent database. These two operations are the manual sync
 * between them: Export writes the WHOLE store to one JSON file, and Import
 * REPLACES the whole store with one. There is no merge — whichever device you
 * export from is the one that wins, and a chapter deleted there disappears here.
 *
 * Import is destructive and cannot be expressed on the per-chapter undo stack
 * (see importBackup), so its guard is a whole-database snapshot taken just
 * before the write plus the #undo-import-btn that restores it. Consistent with
 * the rest of the app, neither operation confirms.
 * ------------------------------------------------------------------ */
const EXPORT_FORMAT = "music-practice-tracker-export";
const EXPORT_FORMAT_VERSION = 1;

// Pure: wraps the raw documents in an envelope that identifies what they are.
// The documents go in verbatim, `version` included, so an import restores the
// exact OCC baselines the exporting device had.
function buildExportPayload(docs, now) {
  return {
    format: EXPORT_FORMAT,
    format_version: EXPORT_FORMAT_VERSION,
    app_guid: APP_GUID,
    db_version: DB_VERSION,
    exported_at: now,
    chapters: docs,
  };
}

// Pure: returns the chapter array, or throws an Error whose message is meant to
// be shown to the user. Every check exists to keep a wrong file from wiping the
// database, so this runs to completion BEFORE anything is written.
//
// The db_version check is deliberately one-sided. A file from a NEWER app could
// hold a shape this build cannot read, and importing it would look like data
// corruption, so it is refused. A file from an OLDER app is fine: every optional
// field in this schema is defined so that absent means the default
// (`custom_list` absent = contiguous, `numbering_system` absent = numbers,
// `focus` absent = normal), which is exactly what an older export looks like.
function parseImportPayload(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON. Pick a file exported by this app.");
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("That file is not a Music Practice Tracker export.");
  }
  if (data.format !== EXPORT_FORMAT) {
    throw new Error("That file is not a Music Practice Tracker export.");
  }
  // Permanent and hardcoded, so this can only fail on a file from another app
  // that happens to share the format string — but it is one comparison.
  if (data.app_guid !== APP_GUID) {
    throw new Error("That export belongs to a different app database.");
  }
  if (typeof data.db_version === "number" && data.db_version > DB_VERSION) {
    throw new Error(
      `That file was exported by a newer version of this app (database v${data.db_version}; ` +
        `this device reads v${DB_VERSION}). Reload this page to update, then try again.`
    );
  }
  if (!Array.isArray(data.chapters)) {
    throw new Error("That export is missing its chapter list.");
  }

  for (const doc of data.chapters) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("That export contains a chapter that is not a record.");
    }
    // The composite keyPath is [instrument, book, chapter]; a non-string here
    // would make store.put() throw mid-transaction and abort the import.
    if (
      typeof doc.instrument !== "string" ||
      typeof doc.book !== "string" ||
      typeof doc.chapter !== "string"
    ) {
      throw new Error("That export contains a chapter with a malformed key.");
    }
    if (!doc.exercises || typeof doc.exercises !== "object") {
      throw new Error(
        `That export's "${doc.instrument} / ${doc.book} / ${doc.chapter}" has no exercise data.`
      );
    }
  }

  return data.chapters;
}

// Success feedback for the data panel. Errors keep going through showError()
// (an alert), because they need to interrupt.
function setDataStatus(msg) {
  dataStatus.textContent = msg || "";
}

function refreshUndoImportBtn() {
  undoImportBtn.disabled = importBackup === null;
}

// Hand the file to the OS. On iOS/iPadOS the share sheet is the only convenient
// way to get a file to another device (AirDrop, Messages, Files); everywhere
// else — and whenever the share is cancelled or unsupported — fall back to a
// plain download, the same Blob + <a download> dance d4cubeoptim uses.
async function shareOrDownload(filename, json) {
  const blob = new Blob([json], { type: "application/json" });

  try {
    const file = new File([blob], filename, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    }
  } catch (err) {
    // AbortError = the user dismissed the sheet; they chose not to export, so
    // do not then shove a download at them.
    if (err && err.name === "AbortError") return "cancelled";
    console.error("Share failed; falling back to download", err);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return "downloaded";
}

async function onExport() {
  // A note typed in the last 250ms is still behind the throttle and would be
  // missing from the file, so land it first and wait for it to settle.
  flushComment();
  await drainCommentWrites();

  let docs;
  try {
    docs = await listChapters();
  } catch (err) {
    console.error("Export failed", err);
    showError("Could not read the database to export it. Please try again.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const json = JSON.stringify(buildExportPayload(docs, Date.now()), null, 2);

  let outcome;
  try {
    outcome = await shareOrDownload(`music-practice-tracker-${stamp}.json`, json);
  } catch (err) {
    console.error("Export failed", err);
    showError("Could not save the export file. Please try again.");
    return;
  }

  if (outcome === "cancelled") {
    setDataStatus("Export cancelled.");
    return;
  }
  const n = docs.length;
  setDataStatus(`Exported ${n} ${n === 1 ? "chapter" : "chapters"}.`);
}

// Swap the whole store for `docs`, then rebuild every piece of in-memory state
// that described the store we just threw away. Shared by Import and Undo Import.
async function swapDatabase(docs) {
  await replaceAllChapters(docs);

  // The undo stack holds per-chapter snapshots whose `version` values were
  // meaningful against the OLD database, and whose chapters may not even exist
  // in the new one. Since restoreChapter has no version check, an Undo pressed
  // after this would write a document from the previous database straight over
  // the imported one. Drop the stack instead.
  undoStack = [];
  refreshUndoBtn();

  currentDoc = null;
  pendingCommentNames.clear();
  if (detailsModal.open) detailsModal.close();
  modalName = null;
  modalSnapshot = null;
  resetEditState();

  await loadMostRecentChapter();
  await refreshDatalists();
}

async function onImportFile(file) {
  // Same preamble as undoLast(), for the same reason: comment writes are
  // fire-and-forget and their mutator re-creates a missing document, so one
  // still in flight would land AFTER the store is cleared and resurrect a
  // chapter the imported file does not contain. Flush rather than cancel, so a
  // note typed seconds ago survives if the file below turns out to be invalid.
  flushComment();
  cancelLastUsedTimer();
  if (detailsModal.open) detailsModal.close();
  await drainCommentWrites();

  let chapters;
  try {
    chapters = parseImportPayload(await file.text());
  } catch (err) {
    // Nothing has been written at this point — a rejected file leaves the
    // database exactly as it was.
    showError(err.message || "Could not read that file.");
    return;
  }

  // The auto-backup, taken immediately before the overwrite. This is the guard
  // that lets Import skip a confirmation dialog like every other action here.
  let backup;
  try {
    backup = await listChapters();
  } catch (err) {
    console.error("Import failed while backing up", err);
    showError("Could not back up the current data, so nothing was imported.");
    return;
  }

  try {
    await swapDatabase(chapters);
  } catch (err) {
    console.error("Import failed", err);
    showError("Could not import that file. Nothing was changed.");
    return;
  }

  importBackup = backup;
  refreshUndoImportBtn();
  setDataStatus(
    `Imported ${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}, ` +
      `replacing ${backup.length}. Undo Import puts the old data back until you reload.`
  );
}

async function onUndoImport() {
  if (importBackup === null) return;

  flushComment();
  cancelLastUsedTimer();
  if (detailsModal.open) detailsModal.close();
  await drainCommentWrites();

  const backup = importBackup;
  try {
    await swapDatabase(backup);
  } catch (err) {
    console.error("Undo Import failed", err);
    showError("Could not restore the previous data. Please try again.");
    return;
  }

  // One-shot: the backup describes the state before *the* import, and there is
  // nothing sensible to restore a second time.
  importBackup = null;
  refreshUndoImportBtn();
  setDataStatus(
    `Restored ${backup.length} ${backup.length === 1 ? "chapter" : "chapters"} from before the import.`
  );
}

/* ------------------------------------------------------------------ *
 * last_used_at inactivity timer.
 *
 * Any edit to a top-level field (instrument/book/chapter/min/max) (re)starts a
 * 60s timer. When it fires, if a persisted doc matches the current triple, bump
 * its last_used_at (NOT use_count). Comment edits and checkbox toggles must not
 * touch this timer.
 * ------------------------------------------------------------------ */
let lastUsedTimer = null;

function restartLastUsedTimer() {
  if (lastUsedTimer !== null) clearTimeout(lastUsedTimer);
  lastUsedTimer = setTimeout(fireLastUsedTimer, 60000);
}

function cancelLastUsedTimer() {
  if (lastUsedTimer !== null) {
    clearTimeout(lastUsedTimer);
    lastUsedTimer = null;
  }
}

async function fireLastUsedTimer() {
  lastUsedTimer = null;
  const triple = readTriple();
  if (!triple) return;
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  await ensureDb();
  const existing = await getChapter(key);
  if (!existing) return; // no saved doc for this triple -> nothing to bump
  // Align the OCC baseline with reality before mutating.
  if (!currentDoc || !tripleEq(currentDoc, triple)) currentDoc = existing;
  try {
    await occ(key, (doc) => {
      doc = doc || newChapterDoc(triple.instrument, triple.book, triple.chapter);
      doc.last_used_at = Date.now(); // use_count deliberately untouched
      return doc;
    });
    // Recency ordering changed; keep datalists fresh.
    refreshDatalists();
  } catch {
    /* best-effort background bump; ignore failures */
  }
}

/* ------------------------------------------------------------------ *
 * Autoload on triple change (no button).
 * ------------------------------------------------------------------ */
async function autoload() {
  rebuildDatalistDom(); // dependent datalists always refresh (sync, from cache)
  const triple = readTriple();
  if (!triple) {
    // An incomplete triple can never match a saved doc; drop whatever the
    // previous (now-stale) triple had on screen instead of leaving it behind.
    currentDoc = null;
    resetEditState();
    clearExerciseList();
    clearCounter();
    syncListToolbar();
    return;
  }
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  await ensureDb();
  const doc = await getChapter(key);
  // Guard against races: several autoloads may be in flight while typing.
  // Ignore this result if the inputs no longer match what we queried.
  if (!tripleEq(readTriple(), triple)) return;
  // Only tear down edit mode when we are genuinely moving to another chapter;
  // a redundant autoload for the same triple must not kick the user out of it.
  const switched = !tripleEq(currentDoc, triple);
  if (doc) {
    currentDoc = doc;
    if (switched) resetEditState();
    // Before populateRange: it spells the range using the adopted scheme.
    applyNumberingSystem(doc.numbering_system);
    populateRange(doc.last_range);
    renderList();
    backfillLetterNumberingIfNeeded(); // fire-and-forget; re-renders if it finds anything
  } else {
    currentDoc = null;
    resetEditState();
    clearExerciseList();
    clearCounter();
    syncListToolbar();
  }
}

// Tracks the one backfill write currently in flight, so two DOM events for the
// same still-unmigrated chapter (a keystroke's "input" plus a later blur's
// "change", both routed through autoload()) await the same occ() call instead
// of each starting their own. Purely an efficiency guard — occ() would make a
// second concurrent write safe (it just finds nothing left to do and writes
// the doc back unchanged) — but there is no reason to pay for two.
let letterBackfillInFlight = null; // { triple, promise } | null

// Migrate the chapter now on screen off the old "aa"/"bb" letter spelling, if
// it is still holding any (see backfillLetterNumbering() above). Called after
// every load of a chapter — autoload, startup/import/undo-import via
// loadMostRecentChapter(), and Undo — never after a plain edit, so it runs
// once per legacy chapter and then never finds anything to do again.
//
// Not awaited by its callers: the list is already shown with whatever names it
// loaded with, and this quietly re-renders if the rename lands. Re-derives the
// rename map INSIDE the occ() mutator, like the numbering-system rename and
// nextExerciseName, so a retry against a fresher doc still migrates whatever
// it actually finds. Deliberately NOT undoable and does not touch
// last_used_at — a passive migration is not a user edit.
async function backfillLetterNumberingIfNeeded() {
  if (!currentDoc || !backfillLetterNumbering(currentDoc)) return;
  const triple = readTriple();
  const key = currentKey();
  if (!triple || !key) return;

  if (letterBackfillInFlight && tripleEq(letterBackfillInFlight.triple, triple)) {
    await letterBackfillInFlight.promise;
    return;
  }

  // A queued comment edit targets the OLD name; land it before the rename
  // moves that exercise to a new key, exactly as the numbering-system change
  // does and for the same reason — occ()'s carry() only re-applies pending
  // comments to names still present in the incoming doc.
  flushComment();

  const promise = (async () => {
    try {
      return await occ(key, (doc) => {
        if (!doc) throw new Error("chapter no longer exists");
        return backfillLetterNumbering(doc) || doc;
      });
    } catch (err) {
      console.error("Letter-numbering backfill failed", err);
      return null;
    }
  })();
  letterBackfillInFlight = { triple, promise };
  const result = await promise;
  if (letterBackfillInFlight && letterBackfillInFlight.promise === promise) {
    letterBackfillInFlight = null;
  }
  if (!result) return;

  // Only reflect it on screen if this chapter is still the one showing — the
  // user may have navigated away (or deleted it) while the write was in flight.
  if (currentDoc && tripleEq(currentDoc, triple) && tripleEq(readTriple(), triple)) {
    currentDoc = result;
    renderList();
  }
}

/* ------------------------------------------------------------------ *
 * Randomize.
 * ------------------------------------------------------------------ */
async function onRandomize() {
  const triple = readTriple();
  const scheme = activeScheme();
  const min = parseRangeValue(minInput.value);
  const max = parseRangeValue(maxInput.value);

  // Validate before touching the DB.
  if (!triple) {
    showError("Please fill in instrument, book, and chapter.");
    return;
  }

  // A custom (hand-edited) list is not described by a range. With both boxes
  // blank, Randomize reshuffles the existing set in place; filling both in is
  // the deliberate way back to contiguous numbering, and takes the normal
  // rebuild path below. One box filled is ambiguous, so refuse to guess.
  const custom = isCustomList();
  if (custom && min === null && max === null) {
    await reshuffleCustomList(triple);
    return;
  }
  if (custom && (min === null || max === null)) {
    showError(
      "Fill in both min and max to switch back to a numbered range, or clear both to reshuffle the current list."
    );
    return;
  }

  if (min === null || max === null) {
    showError(
      scheme.textInput
        ? "Min and max must be letters like a, b, or aa."
        : "Min and max must be whole numbers of 1 or more."
    );
    return;
  }
  if (min > max) {
    showError("Min must be less than or equal to max.");
    return;
  }
  if (max - min + 1 > 1000) {
    showError("That range is too large (limit is 1000 exercises).");
    return;
  }

  // Land any queued note edit BEFORE the rebuild reads comments off the stored
  // doc, so a note typed moments ago is carried over rather than lost.
  flushComment();

  // No confirmation dialog: this rebuild is destructive (checkboxes reset,
  // out-of-range exercises dropped) but fully undoable.
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  const entry = pushUndo(key, triple);

  // Randomize settles any pending inactivity timer and bumps last_used_at now.
  cancelLastUsedTimer();

  const names = [];
  for (let n = min; n <= max; n++) names.push(scheme.label(n));

  try {
    await occ(key, (doc) => {
      doc = doc || newChapterDoc(triple.instrument, triple.book, triple.chapter);
      // A chapter has exactly one active range: rebuild `exercises` from
      // scratch for the new range only, dropping anything outside it.
      // Completed state always resets; comments carry over for exercise
      // names that were already present (i.e. overlap the old range).
      const newExercises = {};
      for (const nm of names) {
        const prev = doc.exercises[nm];
        newExercises[nm] = {
          completed: false,
          completed_at: null,
          comment: prev ? prev.comment || "" : "",
        };
        // Focus carries over on exactly the same terms as the comment: kept for
        // names present in both ranges, gone with anything dropped. Written only
        // when it is not the default, so a chapter nobody has focused stays
        // byte-identical to what earlier versions of the app wrote.
        const focus = prev ? focusOf(doc, nm) : DEFAULT_FOCUS;
        if (focus !== DEFAULT_FOCUS) newExercises[nm].focus = focus;
      }
      doc.exercises = newExercises;
      // last_range holds indexes, not labels, so it stays meaningful if the
      // numbering system changes later.
      doc.last_range = { min, max };
      doc.numbering_system = numberingSystem;
      // Rebuilding from a range is exactly what un-customizes a chapter.
      doc.custom_list = false;
      // Shuffled within each focus category, focused block first. Read off the
      // doc AFTER newExercises lands, so it sees the carried-over states.
      doc.randomization = shuffleByFocus(doc, names);
      doc.randomized_at = Date.now();
      doc.use_count = (doc.use_count || 0) + 1;
      doc.last_used_at = Date.now();
      return doc;
    });
    entry.after = structuredClone(currentDoc);
    resetEditState();
    renderList();
    syncRangeLock();
    refreshDatalists();
  } catch (err) {
    console.error("Randomize failed", err);
    popUndo(entry);
    showError("Could not save the randomization. Please try again.");
  }
}

/* ------------------------------------------------------------------ *
 * Randomize for a custom list: reshuffle the exercises that are already
 * there. min/max are ignored entirely — nothing is added, nothing is
 * dropped, and every comment and focus state is left exactly as it was.
 * Completion state still resets chapter-wide, matching the contiguous path,
 * and the new order is grouped by focus exactly as the contiguous path's is.
 * ------------------------------------------------------------------ */
async function reshuffleCustomList(triple) {
  flushComment(); // land any in-flight note edit before we rewrite the doc
  // Unconfirmed and undoable, like the contiguous path.
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  const entry = pushUndo(key, triple);

  cancelLastUsedTimer();

  try {
    await occ(key, (doc) => {
      const names =
        doc.randomization && doc.randomization.length
          ? doc.randomization.slice()
          : Object.keys(doc.exercises || {});
      for (const nm of names) {
        ensureExercise(doc, nm);
        doc.exercises[nm].completed = false;
        doc.exercises[nm].completed_at = null;
        // comment and focus deliberately untouched
      }
      doc.randomization = shuffleByFocus(doc, names);
      doc.randomized_at = Date.now();
      doc.use_count = (doc.use_count || 0) + 1;
      doc.last_used_at = Date.now();
      return doc; // custom_list and last_range stay as they are
    });
    entry.after = structuredClone(currentDoc);
    resetEditState();
    renderList();
    syncRangeLock();
    refreshDatalists();
  } catch (err) {
    console.error("Reshuffle failed", err);
    popUndo(entry);
    showError("Could not save the randomization. Please try again.");
  }
}

/* ------------------------------------------------------------------ *
 * Delete — removes the whole saved chapter document, then resets the form
 * like Reset Form. Destructive but undoable: the snapshot taken here is what
 * lets Undo put the chapter back (and navigate to it), which is why it no
 * longer asks for confirmation. The undo stack is in-memory, so a reload
 * between the delete and the undo does make it permanent.
 * ------------------------------------------------------------------ */
async function onDeleteChapter() {
  const triple = readTriple();
  if (!triple) {
    showError("Please fill in instrument, book, and chapter.");
    return;
  }
  if (!currentDoc || !tripleEq(currentDoc, triple)) {
    showError("No saved entry for this chapter to delete.");
    return;
  }

  // Snapshot first (it captures unpersisted notes without writing), THEN drop
  // the throttle. Flushing here would push a write at the record we are about
  // to delete, which could land after the delete and resurrect the chapter.
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  const entry = pushUndo(key, triple);
  entry.after = null; // the action leaves nothing stored to merge against

  cancelLastUsedTimer();
  cancelCommentThrottle();
  // Let any comment write already in flight land BEFORE the delete; its mutator
  // would otherwise re-create the document moments after we removed it.
  await drainCommentWrites();

  try {
    await deleteChapter(key);
  } catch (err) {
    console.error("Delete failed", err);
    popUndo(entry);
    showError("Could not delete this chapter. Please try again.");
    return;
  }

  instrumentInput.value = "";
  bookInput.value = "";
  chapterInput.value = "";
  minInput.value = "";
  maxInput.value = "";
  currentDoc = null;
  applyNumberingSystem(DEFAULT_NUMBERING);
  resetEditState();
  syncRangeLock();
  clearExerciseList();
  clearCounter();
  syncListToolbar();
  rebuildDatalistDom();
  refreshDatalists();
}

/* ------------------------------------------------------------------ *
 * Checkbox toggle (row or modal). Never touches last_used_at.
 * ------------------------------------------------------------------ */
async function toggleCompleted(name, checked) {
  const triple = readTriple();
  if (!triple) return;
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  try {
    await occ(key, (doc) => {
      doc = doc || newChapterDoc(triple.instrument, triple.book, triple.chapter);
      ensureExercise(doc, name);
      doc.exercises[name].completed = checked;
      doc.exercises[name].completed_at = checked ? Date.now() : null;
      return doc;
    });
    updateRowCompleted(name);
    if (detailsModal.open && modalName === name) modalCheck.checked = checked;
    updateCounter();
  } catch (err) {
    console.error("Toggle failed", err);
    renderList(); // fall back to a full re-render from whatever we have
  }
}

/* ------------------------------------------------------------------ *
 * Focus toggle (row or modal). Like the checkbox and unlike Sort, this is
 * deliberately NOT pushed onto the undo stack: it is a single visible click
 * that the same click cycles back out of, and stacking it would push the
 * genuinely destructive actions off the capped stack. Reset Focus, which
 * rewrites every exercise at once, IS undoable. Never touches last_used_at.
 *
 * The writes are SERIALIZED through one chain. A press is a single click on a
 * cycling button, so bursts are normal — three presses to walk back to normal,
 * or a sweep down the list — and firing them concurrently means every write
 * after the first opens against a stale version. occ() retries a conflict only
 * once, so the third overlapping write in a burst loses outright and the row
 * silently snaps back. Queuing costs nothing here (each write is tiny and the
 * UI already updated optimistically) and removes the self-collision entirely;
 * occ()'s retry is left to do its real job, which is other tabs.
 * ------------------------------------------------------------------ */
let focusWriteChain = Promise.resolve();

function queueFocusWrite(run) {
  const next = focusWriteChain.then(run, run);
  // The chain itself must never stay rejected, or every later write inherits
  // the failure; callers get the real promise back and handle their own errors.
  focusWriteChain = next.catch(() => {});
  return next;
}

async function setFocus(name, state) {
  const triple = readTriple();
  if (!triple || !currentDoc) return;
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);

  // Update memory and the UI BEFORE awaiting the write, the way comment typing
  // does. Two quick presses would otherwise both read the pre-write state off
  // currentDoc and resolve to the same next state, so the second press would
  // look like it did nothing.
  const previous = focusOf(currentDoc, name);
  ensureExerciseCurrent(name);
  currentDoc.exercises[name].focus = state;
  syncRowFocus(name);
  updateCounter();

  try {
    await queueFocusWrite(() =>
      occ(key, (doc) => {
        doc = doc || newChapterDoc(triple.instrument, triple.book, triple.chapter);
        ensureExercise(doc, name);
        doc.exercises[name].focus = state;
        return doc;
      })
    );
    syncRowFocus(name);
    updateCounter();
  } catch (err) {
    console.error("Focus change failed", err);
    if (currentDoc && currentDoc.exercises && currentDoc.exercises[name]) {
      currentDoc.exercises[name].focus = previous;
    }
    renderList();
  }
}

function cycleFocus(name) {
  setFocus(name, nextFocus(focusOf(currentDoc, name)));
}

// Put the whole chapter back to normal in one write. Destructive across every
// exercise at once, so — like Sort, Randomize and chapter Delete — it does not
// confirm and is undoable instead.
async function onResetFocus() {
  const triple = readTriple();
  if (!triple) {
    showError("Please fill in instrument, book, and chapter.");
    return;
  }
  if (!currentDoc || !tripleEq(currentDoc, triple)) {
    showError("No saved entry for this chapter.");
    return;
  }

  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  const entry = pushUndo(key, triple);

  try {
    await occ(key, (doc) => {
      // Delete rather than write "normal": absent IS normal (see focusOf), and
      // leaving the field off keeps a never-focused chapter byte-identical to
      // what older versions of the app wrote.
      for (const ex of Object.values(doc.exercises || {})) delete ex.focus;
      return doc;
    });
  } catch (err) {
    console.error("Reset focus failed", err);
    popUndo(entry);
    showError("Could not reset focus. Please try again.");
    return;
  }

  entry.after = structuredClone(currentDoc);
  renderList();
}

/* ------------------------------------------------------------------ *
 * Modal comment throttle.
 *
 * At most ONE DB write per 250ms, with a guaranteed trailing flush so the final
 * value always lands. Leading edge writes immediately and opens a window; edits
 * during the window mark "dirty"; on tick, if dirty, write latest and reopen
 * the window, else stop. flush() forces the trailing write; cancel() drops it
 * (used by Cancel, which must undo even throttle-saved edits).
 * ------------------------------------------------------------------ */
let commentTimer = null;
let commentDirty = false;
let commentTargetName = null;
// Exercises whose comment has been typed but is not yet known to be persisted.
// occ() consults this to avoid clobbering those edits when it adopts a write
// result built from the stored doc.
let pendingCommentNames = new Set();
// Comment writes are fire-and-forget, and their mutator RE-CREATES a missing
// document. Anything that removes a document must therefore wait for them to
// settle first, or a write still in flight lands afterwards and resurrects the
// chapter. (This used to be hidden by the delete confirmation dialog, whose
// blocking prompt gave in-flight writes time to land before the delete ran.)
const inFlightCommentWrites = new Set();

async function drainCommentWrites() {
  while (inFlightCommentWrites.size) {
    await Promise.allSettled([...inFlightCommentWrites]);
  }
}

function writeCommentNow(name) {
  const triple = readTriple();
  if (!triple) return;
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  // Textarea value is authoritative and re-read inside the mutator, so OCC
  // retries against a fresh doc still persist the latest keystrokes.
  const write = occ(key, (doc) => {
    doc = doc || newChapterDoc(triple.instrument, triple.book, triple.chapter);
    ensureExercise(doc, name);
    doc.exercises[name].comment = currentCommentValue(name);
    return doc;
  });
  inFlightCommentWrites.add(write);
  write
    .catch(() => {})
    .finally(() => inFlightCommentWrites.delete(write));
  write
    .then(() => {
      // Stop protecting this name once its value is on disk — unless newer
      // keystrokes for it are still queued behind the throttle.
      if (!(commentDirty && commentTargetName === name)) {
        pendingCommentNames.delete(name);
      }
    })
    .catch((err) => console.error("Comment persist failed", err));
}

function scheduleCommentPersist(name) {
  pendingCommentNames.add(name);
  // The throttle tracks ONE target at a time. Moving to a different exercise
  // mid-window would drop the previous one's queued edit on the floor, so flush
  // it first; the extra write is bounded by how often the user switches rows.
  if (
    commentTimer !== null &&
    commentDirty &&
    commentTargetName !== null &&
    commentTargetName !== name
  ) {
    writeCommentNow(commentTargetName);
    commentDirty = false;
  }
  commentTargetName = name;
  if (commentTimer === null) {
    // Leading edge: persist now and open the 250ms throttle window.
    writeCommentNow(name);
    commentDirty = false;
    commentTimer = setTimeout(onCommentTick, 250);
  } else {
    // Within the window: remember there is newer content to flush at the end.
    commentDirty = true;
  }
}

function onCommentTick() {
  if (commentDirty) {
    writeCommentNow(commentTargetName);
    commentDirty = false;
    commentTimer = setTimeout(onCommentTick, 250);
  } else {
    commentTimer = null;
  }
}

function flushComment() {
  if (commentTimer !== null) {
    clearTimeout(commentTimer);
    commentTimer = null;
  }
  if (commentDirty) {
    writeCommentNow(commentTargetName);
    commentDirty = false;
  }
}

function cancelCommentThrottle() {
  if (commentTimer !== null) {
    clearTimeout(commentTimer);
    commentTimer = null;
  }
  commentDirty = false;
  // Only the current target's queued edit is being discarded; other names may
  // still have writes in flight that memory must not regress behind.
  if (commentTargetName !== null) pendingCommentNames.delete(commentTargetName);
}

/* ------------------------------------------------------------------ *
 * Modal open / save / cancel.
 * ------------------------------------------------------------------ */
function openModal(name) {
  if (!currentDoc) return;
  // Land any queued edit before taking the snapshot below, rather than dropping
  // it: the pending write may belong to a different row (whose text must not be
  // lost) or to this one (where the snapshot must match what is on disk, so
  // that Cancel reverts to a real state).
  flushComment();
  ensureExerciseCurrent(name);
  modalName = name;
  const ex = currentDoc.exercises[name];
  // Snapshot for a true Cancel/undo.
  // `focus` belongs here because revertModal() writes this snapshot back as the
  // WHOLE record: anything missing from it would be erased by a Cancel/Esc.
  modalSnapshot = {
    completed: !!ex.completed,
    completed_at: ex.completed_at != null ? ex.completed_at : null,
    comment: ex.comment || "",
    focus: focusOf(currentDoc, name),
  };
  modalTitle.textContent = "Exercise " + name;
  modalCheck.checked = !!ex.completed;
  modalComment.value = ex.comment || "";
  if (!detailsModal.open) detailsModal.showModal();
  syncRowFocus(name); // now that the modal is open, stamp its toggle too
}

// Revert the edited exercise to its on-open snapshot (in memory) and persist
// the reverted record. Undoes edits made since opening, including ones the
// throttle already saved.
function revertModal() {
  if (modalName === null || !currentDoc) return;
  const name = modalName;
  cancelCommentThrottle(); // discard any pending edit write; we are reverting
  const snapshot = { ...modalSnapshot };
  currentDoc.exercises[name] = { ...snapshot };
  const triple = readTriple();
  if (!triple) return;
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  occ(key, (doc) => {
    doc = doc || newChapterDoc(triple.instrument, triple.book, triple.chapter);
    doc.exercises[name] = { ...snapshot };
    return doc;
  })
    .then(() => {
      refreshRowPreview(name);
      updateRowCompleted(name);
      syncRowFocus(name);
      updateCounter();
    })
    .catch((err) => console.error("Cancel revert failed", err));
}

// Comment typing: update memory synchronously, then schedule a throttled write.
// The row preview refreshes on every keystroke rather than only on Save, so the
// small bar stays a live mirror of the textarea — and stays editable — for as
// long as the note is still a single line.
modalComment.addEventListener("input", () => {
  if (modalName === null || !currentDoc) return;
  ensureExerciseCurrent(modalName);
  currentDoc.exercises[modalName].comment = modalComment.value;
  refreshRowPreview(modalName);
  scheduleCommentPersist(modalName);
});

// Checkbox inside the modal behaves like the row checkbox for modalName.
modalCheck.addEventListener("change", () => {
  if (modalName === null) return;
  toggleCompleted(modalName, modalCheck.checked);
});

// Save: flush the final comment, refresh the row preview + counter, then close.
modalSave.addEventListener("click", () => {
  const name = modalName;
  flushComment();
  if (name !== null) {
    refreshRowPreview(name);
    updateCounter();
  }
  detailsModal.close();
});

// Cancel button: revert (memory + persist), then close.
modalCancel.addEventListener("click", () => {
  revertModal();
  detailsModal.close();
});

// Esc dismiss fires the dialog "cancel" event -> same revert, then let it close.
detailsModal.addEventListener("cancel", () => {
  revertModal();
});

// Any close path clears the modal editing state.
detailsModal.addEventListener("close", () => {
  modalName = null;
  modalSnapshot = null;
});

// If the tab is being hidden, make sure the final comment lands.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushComment();
});

/* ------------------------------------------------------------------ *
 * Reset Form — UI-ONLY reset, deletes nothing.
 * ------------------------------------------------------------------ */
function onClearForm() {
  cancelLastUsedTimer();
  cancelCommentThrottle();
  instrumentInput.value = "";
  bookInput.value = "";
  chapterInput.value = "";
  minInput.value = "";
  maxInput.value = "";
  currentDoc = null;
  applyNumberingSystem(DEFAULT_NUMBERING);
  resetEditState();
  syncRangeLock();
  clearExerciseList();
  clearCounter();
  syncListToolbar();
  rebuildDatalistDom(); // book/chapter suggestions now have no instrument context
}

/* ------------------------------------------------------------------ *
 * Event wiring.
 * ------------------------------------------------------------------ */
// instrument -> book -> chapter is a hierarchy: changing an ancestor field
// invalidates whatever was typed into its descendants, so wipe them.
function clearDescendants(level) {
  if (level === "instrument") {
    bookInput.value = "";
    chapterInput.value = "";
  } else if (level === "book") {
    chapterInput.value = "";
  }
}

function onFieldChanged(level) {
  clearDescendants(level);
  restartLastUsedTimer(); // top-level field change (re)starts the 60s timer
  autoload();
}

// The × buttons blank their own field, then cascade exactly like typing would.
function resetField(level) {
  const input =
    level === "instrument" ? instrumentInput : level === "book" ? bookInput : chapterInput;
  input.value = "";
  onFieldChanged(level);
  input.focus();
}

function onRangeInput() {
  restartLastUsedTimer(); // min/max are top-level fields too
}

/* Build the old-name -> new-name map for a change of numbering system.
 *
 * Every name the OLD scheme can parse is re-spelled by the NEW scheme at the
 * SAME index, so 1<->a, 2<->b, 9<->IX. Names the old scheme cannot read have
 * no index to carry across and keep their name (a mixed-scheme list is a
 * legitimate state, not a bug to repair).
 *
 * Renames that would collide are dropped rather than guessed at: switching a
 * list holding both "1" and "a" from letters to numbers would map "a"->"1" on
 * top of an existing "1", so "a" simply stays "a". Two source names competing
 * for one target resolve the same way — first one wins, the rest stay put.
 * Pure, and returns only the entries that actually change.
 */
function buildRenameMap(names, fromScheme, toScheme) {
  const indexOf = new Map();
  for (const name of names) {
    const index = fromScheme.parse(name);
    if (index !== null && index >= 1) indexOf.set(name, index);
  }

  // Names that are staying put claim their spelling up front: those the old
  // scheme cannot read, and those the new scheme spells identically. Names
  // that ARE moving vacate theirs, so 1->a can take "a" if "a" is becoming "b".
  const taken = new Set();
  for (const name of names) {
    const index = indexOf.get(name);
    if (index === undefined || toScheme.label(index) === name) taken.add(name);
  }

  const map = new Map();
  for (const name of names) {
    const index = indexOf.get(name);
    if (index === undefined) continue;
    const next = toScheme.label(index);
    if (next === name || taken.has(next)) continue;
    map.set(name, next);
    taken.add(next);
  }
  return map;
}

// Changing the numbering system re-spells the whole chapter: every exercise the
// outgoing scheme can parse is renamed to the incoming scheme's spelling at the
// same index, carrying its completion state and comment with it, and the list
// order is mapped through unchanged. `last_range` holds INDEXES, so it needs no
// translation. Undoable and unconfirmed like the other write actions.
async function onNumberingChanged() {
  applyNumberingSystem(numberingSelect.value);
  restartLastUsedTimer();
  const triple = readTriple();
  const key = currentKey();
  // With nothing saved for this triple yet there is no document to stamp, and
  // creating one here would put a listless chapter in the datalists; the first
  // Randomize persists the selection instead.
  if (!key || !triple || !currentDoc) return;

  // Land any queued note edit first. The rename moves each exercise record to a
  // NEW key, and occ()'s carry() only re-applies pending comments to names that
  // still exist in the incoming doc — so a note queued against "1" would be lost
  // the moment "1" becomes "a".
  flushComment();

  const entry = pushUndo(key, triple);
  try {
    await occ(key, (doc) => {
      // Re-derive from the mutator's own doc: on an OCC retry the fresh doc may
      // hold names this tab never saw, and they need renaming too.
      const from = schemeOf(doc);
      const to = activeScheme();
      const names = Object.keys(doc.exercises || {});
      const renames = buildRenameMap(names, from, to);

      const exercises = {};
      for (const name of names) {
        exercises[renames.get(name) || name] = doc.exercises[name];
      }
      doc.exercises = exercises;
      if (doc.randomization) {
        doc.randomization = doc.randomization.map((n) => renames.get(n) || n);
      }
      doc.numbering_system = numberingSystem;
      return doc;
    });
  } catch (err) {
    console.error("Numbering system persist failed", err);
    popUndo(entry);
    showError("Could not change the numbering system. Please try again.");
    return;
  }

  entry.after = structuredClone(currentDoc);
  // applyNumberingSystem blanked #min/#max because the digits it found there no
  // longer parse as (say) letters. Now that the chapter itself has been
  // renumbered, re-spell the range from last_range, which holds INDEXES and so
  // survived the switch untouched — otherwise the boxes come back empty and
  // Randomize refuses the chapter it was just describing.
  populateRange(currentDoc.last_range);
  renderList();
}

function wireEvents() {
  // The modal's focus toggle is the same control the rows use, dropped into the
  // slot index.html reserves for it. Built here (not at module scope) so it runs
  // after the ICONS table is initialized.
  modalFocusBtn = buildFocusToggle("focus-toggle");
  modalFocusBtn.dataset.focus = DEFAULT_FOCUS;
  modalFocusBtn.setAttribute("aria-label", "Change practice focus");
  modalFocusBtn.addEventListener("click", () => {
    if (modalName !== null) cycleFocus(modalName);
  });
  modalFocusSlot.appendChild(modalFocusBtn);

  for (const level of ["instrument", "book", "chapter"]) {
    const el = level === "instrument" ? instrumentInput : level === "book" ? bookInput : chapterInput;
    el.addEventListener("input", () => onFieldChanged(level));
    el.addEventListener("change", () => onFieldChanged(level));
  }
  instrumentClearBtn.addEventListener("click", () => resetField("instrument"));
  bookClearBtn.addEventListener("click", () => resetField("book"));
  chapterClearBtn.addEventListener("click", () => resetField("chapter"));
  for (const el of [minInput, maxInput]) {
    el.addEventListener("input", onRangeInput);
    el.addEventListener("change", onRangeInput);
  }
  numberingSelect.addEventListener("change", onNumberingChanged);
  randomizeBtn.addEventListener("click", onRandomize);
  clearBtn.addEventListener("click", onClearForm);
  deleteBtn.addEventListener("click", onDeleteChapter);
  resetFocusBtn.addEventListener("click", onResetFocus);
  undoBtn.addEventListener("click", undoLast);
  editListBtn.addEventListener("click", () => setEditMode(!editMode));
  sortBtn.addEventListener("click", onSort);
  newExerciseBtn.addEventListener("click", addExercise);
  newExerciseNameInput.addEventListener("input", onNewExerciseNameInput);

  // Data panel. #import-btn forwards to the hidden file input so the visible
  // control is a .btn; the input's value is cleared afterwards or picking the
  // same file twice in a row would not fire `change` again.
  exportBtn.addEventListener("click", onExport);
  importBtn.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", async () => {
    const file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = "";
    if (file) await onImportFile(file);
  });
  undoImportBtn.addEventListener("click", onUndoImport);
}

/* ------------------------------------------------------------------ *
 * Startup.
 * ------------------------------------------------------------------ */

// Show whatever chapter the database says was used most recently, or clear the
// form if there is none. Shared by page load and by both whole-database swaps
// (Import and Undo Import), which need to rebuild the view from scratch after
// the store underneath it has been replaced.
async function loadMostRecentChapter() {
  let recent = null;
  try {
    recent = await getMostRecentChapter();
  } catch (err) {
    console.error("Failed to restore most recent chapter", err);
  }

  if (recent) {
    currentDoc = recent;
    instrumentInput.value = recent.instrument || "";
    bookInput.value = recent.book || "";
    chapterInput.value = recent.chapter || "";
    applyNumberingSystem(recent.numbering_system);
    populateRange(recent.last_range); // blanks + greys min/max for a custom list
    renderList(); // handles null randomization (clears list + counter)
    backfillLetterNumberingIfNeeded();
  } else {
    // Empty database (a fresh browser, or an import of a file with no
    // chapters): leave the form in the same state Reset Form produces.
    currentDoc = null;
    instrumentInput.value = "";
    bookInput.value = "";
    chapterInput.value = "";
    minInput.value = "";
    maxInput.value = "";
    applyNumberingSystem(DEFAULT_NUMBERING);
    clearExerciseList();
    clearCounter();
  }

  syncRangeLock();
  syncListToolbar();
}

async function init() {
  // Best-effort durable storage so practice history is not evicted.
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }

  await ensureDb();

  await loadMostRecentChapter();

  // Edit mode is session-only, and a page load is the one thing that empties
  // the undo stack (it is in-memory and never persisted). The same goes for the
  // import backup — a reload is what makes an import permanent.
  undoStack = [];
  importBackup = null;
  resetEditState();
  refreshUndoBtn();
  refreshUndoImportBtn();
  syncRangeLock();
  syncListToolbar();

  await refreshDatalists();
}

wireEvents();
init();
