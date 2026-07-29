// app.js — controller for the "music-practice-tracker" SPA.
//
// Wires the frozen DOM (header form + exercise list + details modal) to the
// IndexedDB persistence layer in db.js. Every (instrument, book, chapter)
// triple maps to ONE document; writes go through mutateChapter with optimistic
// concurrency control (OCC) so multiple tabs converge to per-field
// last-write-wins with no user-facing errors.

import {
  chapterKey,
  newChapterDoc,
  openDb,
  getChapter,
  getMostRecentChapter,
  listChapters,
  VersionConflictError,
  mutateChapter,
  deleteChapter,
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
const randomizeBtn = document.getElementById("randomize-btn");
const clearBtn = document.getElementById("clear-btn");
const deleteBtn = document.getElementById("delete-btn");
const progressCounter = document.getElementById("progress-counter");
const listActions = document.getElementById("list-actions");
const editListBtn = document.getElementById("edit-list-btn");
const newExerciseBtn = document.getElementById("new-exercise-btn");
const undoBtn = document.getElementById("undo-btn");
const exerciseList = document.getElementById("exercise-list");

const detailsModal = document.getElementById("details-modal");
const modalTitle = document.getElementById("modal-title");
const modalCheck = document.getElementById("modal-check");
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

// Cached chapter list, used to build the datalists synchronously on every
// keystroke without hitting the DB each time. Refreshed after mutations.
let chaptersCache = [];

// Edit List mode: purely a UI state, deliberately NOT persisted. Every page
// load and every chapter switch starts with it off.
let editMode = false;
// Undo history for edit-mode structural changes, newest last. Entries are
// {type:"add", name} or {type:"delete", name, index, record}. Session-only and
// in-memory: cleared on reload, chapter switch, form reset, and Randomize.
let undoStack = [];

/* ------------------------------------------------------------------ *
 * Small pure helpers.
 * ------------------------------------------------------------------ */
const firstLine = (s) => (s || "").split("\n")[0];

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

// aa/bb/cc after one alphabet is exhausted: the letter cycles every 26 and the
// repeat count grows, so index 27 is "aa" and 53 is "aaa".
function letterLabel(n, alphabet) {
  const i = n - 1;
  return alphabet[i % 26].repeat(Math.floor(i / 26) + 1);
}

function letterParse(s, alphabet) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  // One letter of this alphabet, repeated: "b", "bb", "bbb". Mixed runs like
  // "ab" belong to no index in this scheme and are rejected.
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
  },
  "letters-lower": {
    textInput: true,
    label: (n) => letterLabel(n, LOWER),
    parse: (s) => letterParse(s, LOWER),
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
 * Rendering.
 * ------------------------------------------------------------------ */
function clearExerciseList() {
  while (exerciseList.firstChild) exerciseList.removeChild(exerciseList.firstChild);
}

function clearCounter() {
  progressCounter.textContent = "";
}

function updateCounter() {
  let total = 0;
  let done = 0;
  if (currentDoc && currentDoc.randomization) {
    total = currentDoc.randomization.length;
    for (const name of currentDoc.randomization) {
      const ex = currentDoc.exercises[name];
      if (ex && ex.completed) done++;
    }
  }
  progressCounter.textContent = `${done} of ${total} complete`;
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
  refreshUndoBtn();
}

// Leaving a chapter (or rebuilding its list) invalidates the undo history,
// which holds names and positions from the list being left behind.
function resetEditState() {
  undoStack = [];
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
  const multiline = (ex.comment || "").includes("\n");
  oneline.readOnly = multiline;
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

  const details = document.createElement("button");
  details.type = "button";
  details.className = "ex-details";
  details.textContent = "Expand";
  details.setAttribute("aria-label", "Expand exercise " + name);
  details.addEventListener("click", () => openModal(name));

  // Built on every row but hidden by CSS unless #exercise-list has .edit-mode,
  // so toggling Edit List never re-renders (and never interrupts typing).
  const del = document.createElement("button");
  del.type = "button";
  del.className = "ex-delete";
  del.textContent = "×";
  del.setAttribute("aria-label", "Delete exercise " + name);
  del.addEventListener("click", () => deleteExercise(name));

  row.append(check, nameSpan, oneline, details, del);
  return row;
}

// Render the whole list from currentDoc.randomization (in order).
function renderList() {
  clearExerciseList();
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

// Refresh a single row's one-line comment preview from currentDoc.
function refreshRowPreview(name) {
  const row = findRow(name);
  if (!row) return;
  const oneline = row.querySelector(".ex-oneline");
  if (!oneline) return;
  const comment = (currentDoc && currentDoc.exercises[name] && currentDoc.exercises[name].comment) || "";
  oneline.readOnly = comment.includes("\n");
  oneline.value = firstLine(comment);
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

async function deleteExercise(name) {
  if (!currentDoc || !currentDoc.randomization) return;
  if (currentDoc.randomization.length <= 1) {
    showError("A list needs at least one exercise.");
    return;
  }
  const key = currentKey();
  if (!key) return;

  discardPendingCommentFor(name);
  if (detailsModal.open && modalName === name) detailsModal.close();

  // Snapshot before the write so Undo can restore the note and the position.
  const entry = {
    type: "delete",
    name,
    index: currentDoc.randomization.indexOf(name),
    record: { ...(currentDoc.exercises[name] || {}) },
  };
  undoStack.push(entry);

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
    undoStack.pop();
    refreshUndoBtn();
    showError("Could not delete that exercise. Please try again.");
    renderList();
    return;
  }

  const row = findRow(name);
  if (row) row.remove();
  updateCounter();
  populateRange(currentDoc.last_range); // blanks + greys the range boxes
  refreshUndoBtn();
}

async function addExercise() {
  if (!currentDoc || !currentDoc.randomization) return;
  const key = currentKey();
  if (!key) return;

  // The name is computed INSIDE the mutator: on an OCC retry the fresh doc may
  // already contain a name this one would have taken (another tab added one),
  // and a name chosen up front would collide with it. Gap-filling makes that
  // more likely than plain max+1 did, not less.
  let addedName = null;
  try {
    await occ(key, (doc) => {
      // Stamp the selection first: nextExerciseName reads the scheme off the doc.
      doc.numbering_system = numberingSystem;
      addedName = nextExerciseName(doc);
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
    console.error("Add exercise failed", err);
    showError("Could not add an exercise. Please try again.");
    return;
  }

  undoStack.push({ type: "add", name: addedName });
  exerciseList.prepend(buildRow(addedName));
  updateCounter();
  populateRange(currentDoc.last_range);
  refreshUndoBtn();
}

// Reverse the most recent edit-mode action. Neither direction clears
// custom_list — the flag is sticky once the list has been hand-edited.
async function undoLastEdit() {
  if (!currentDoc || undoStack.length === 0) return;
  const key = currentKey();
  if (!key) return;
  const entry = undoStack.pop();
  refreshUndoBtn();

  try {
    if (entry.type === "add") {
      discardPendingCommentFor(entry.name);
      if (detailsModal.open && modalName === entry.name) detailsModal.close();
      await occ(key, (doc) => {
        doc.randomization = (doc.randomization || []).filter(
          (n) => n !== entry.name
        );
        if (doc.exercises) delete doc.exercises[entry.name];
        return doc;
      });
      const row = findRow(entry.name);
      if (row) row.remove();
    } else {
      await occ(key, (doc) => {
        if (!doc.exercises) doc.exercises = {};
        doc.exercises[entry.name] = { ...entry.record };
        const order = (doc.randomization || []).filter(
          (n) => n !== entry.name
        );
        // Clamp: a concurrent tab may have shortened the list since the delete.
        const at = Math.min(Math.max(entry.index, 0), order.length);
        order.splice(at, 0, entry.name);
        doc.randomization = order;
        return doc;
      });
      const at = currentDoc.randomization.indexOf(entry.name);
      const row = buildRow(entry.name);
      const before = exerciseList.children[at] || null;
      exerciseList.insertBefore(row, before);
    }
  } catch (err) {
    console.error("Undo failed", err);
    undoStack.push(entry);
    refreshUndoBtn();
    showError("Could not undo that change. Please try again.");
    renderList();
    return;
  }

  updateCounter();
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
  } else {
    currentDoc = null;
    resetEditState();
    clearExerciseList();
    clearCounter();
    syncListToolbar();
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

  const confirmed = window.confirm(
    "Randomizing will reset every exercise's completed checkbox for this chapter, and drop any exercises outside the new range. Comments for exercises staying in range are kept. Continue?"
  );
  if (!confirmed) return;

  // Randomize settles any pending inactivity timer and bumps last_used_at now.
  cancelLastUsedTimer();

  const names = [];
  for (let n = min; n <= max; n++) names.push(scheme.label(n));

  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
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
      }
      doc.exercises = newExercises;
      // last_range holds indexes, not labels, so it stays meaningful if the
      // numbering system changes later.
      doc.last_range = { min, max };
      doc.numbering_system = numberingSystem;
      // Rebuilding from a range is exactly what un-customizes a chapter.
      doc.custom_list = false;
      doc.randomization = shuffle(names);
      doc.randomized_at = Date.now();
      doc.use_count = (doc.use_count || 0) + 1;
      doc.last_used_at = Date.now();
      return doc;
    });
    resetEditState();
    renderList();
    syncRangeLock();
    refreshDatalists();
  } catch (err) {
    console.error("Randomize failed", err);
    showError("Could not save the randomization. Please try again.");
  }
}

/* ------------------------------------------------------------------ *
 * Randomize for a custom list: reshuffle the exercises that are already
 * there. min/max are ignored entirely — nothing is added, nothing is
 * dropped, and every comment is left exactly as it was. Completion state
 * still resets chapter-wide, matching the contiguous path.
 * ------------------------------------------------------------------ */
async function reshuffleCustomList(triple) {
  flushComment(); // land any in-flight note edit before we rewrite the doc
  const confirmed = window.confirm(
    "Randomizing will reset every exercise's completed checkbox for this chapter. Your exercise list and notes are kept. Continue?"
  );
  if (!confirmed) return;

  cancelLastUsedTimer();

  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
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
        // comment deliberately untouched
      }
      doc.randomization = shuffle(names);
      doc.randomized_at = Date.now();
      doc.use_count = (doc.use_count || 0) + 1;
      doc.last_used_at = Date.now();
      return doc; // custom_list and last_range stay as they are
    });
    resetEditState();
    renderList();
    syncRangeLock();
    refreshDatalists();
  } catch (err) {
    console.error("Reshuffle failed", err);
    showError("Could not save the randomization. Please try again.");
  }
}

/* ------------------------------------------------------------------ *
 * Delete — removes the whole saved chapter document. Destructive and
 * confirmed; resets the form afterward like Reset Form.
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

  const confirmed = window.confirm(
    `Delete the saved entry for ${triple.instrument} / ${triple.book} / ${triple.chapter}? This cannot be undone.`
  );
  if (!confirmed) return;

  cancelLastUsedTimer();
  cancelCommentThrottle();

  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  try {
    await deleteChapter(key);
  } catch (err) {
    console.error("Delete failed", err);
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

function writeCommentNow(name) {
  const triple = readTriple();
  if (!triple) return;
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  // Textarea value is authoritative and re-read inside the mutator, so OCC
  // retries against a fresh doc still persist the latest keystrokes.
  occ(key, (doc) => {
    doc = doc || newChapterDoc(triple.instrument, triple.book, triple.chapter);
    ensureExercise(doc, name);
    doc.exercises[name].comment = currentCommentValue(name);
    return doc;
  })
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
  modalSnapshot = {
    completed: !!ex.completed,
    completed_at: ex.completed_at != null ? ex.completed_at : null,
    comment: ex.comment || "",
  };
  modalTitle.textContent = "Exercise " + name;
  modalCheck.checked = !!ex.completed;
  modalComment.value = ex.comment || "";
  if (!detailsModal.open) detailsModal.showModal();
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
      updateCounter();
    })
    .catch((err) => console.error("Cancel revert failed", err));
}

// Comment typing: update memory synchronously, then schedule a throttled write.
modalComment.addEventListener("input", () => {
  if (modalName === null || !currentDoc) return;
  ensureExerciseCurrent(modalName);
  currentDoc.exercises[modalName].comment = modalComment.value;
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

// Changing the numbering system re-spells FUTURE names only; the exercises
// already in the list keep theirs, because a name is an exercise's identity and
// its comment is filed under it. Rebuilding from a range (fill in min/max and
// press Randomize) remains the one way to renumber a whole chapter.
async function onNumberingChanged() {
  applyNumberingSystem(numberingSelect.value);
  restartLastUsedTimer();
  const key = currentKey();
  // With nothing saved for this triple yet there is no document to stamp, and
  // creating one here would put a listless chapter in the datalists; the first
  // Randomize persists the selection instead.
  if (!key || !currentDoc) return;
  try {
    await occ(key, (doc) => {
      doc.numbering_system = numberingSystem;
      return doc;
    });
  } catch (err) {
    console.error("Numbering system persist failed", err);
  }
}

function wireEvents() {
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
  editListBtn.addEventListener("click", () => setEditMode(!editMode));
  newExerciseBtn.addEventListener("click", addExercise);
  undoBtn.addEventListener("click", undoLastEdit);
}

/* ------------------------------------------------------------------ *
 * Startup.
 * ------------------------------------------------------------------ */
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

  // Restore the most recently used chapter, if any.
  try {
    const recent = await getMostRecentChapter();
    if (recent) {
      currentDoc = recent;
      instrumentInput.value = recent.instrument || "";
      bookInput.value = recent.book || "";
      chapterInput.value = recent.chapter || "";
      applyNumberingSystem(recent.numbering_system);
      populateRange(recent.last_range); // blanks + greys min/max for a custom list
      renderList(); // handles null randomization (clears list + counter)
    }
  } catch (err) {
    console.error("Failed to restore most recent chapter", err);
  }

  // Edit mode is session-only: always start off, with an empty undo stack.
  resetEditState();
  syncRangeLock();
  syncListToolbar();

  await refreshDatalists();
}

wireEvents();
init();
