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
const instrumentList = document.getElementById("instrument-list");
const bookList = document.getElementById("book-list");
const chapterList = document.getElementById("chapter-list");
const minInput = document.getElementById("min");
const maxInput = document.getElementById("max");
const randomizeBtn = document.getElementById("randomize-btn");
const clearBtn = document.getElementById("clear-btn");
const deleteBtn = document.getElementById("delete-btn");
const progressCounter = document.getElementById("progress-counter");
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
  const expected = currentDoc ? currentDoc.version : null;
  try {
    const result = await mutateChapter(key, expected, mutator);
    currentDoc = result;
    return result;
  } catch (err) {
    if (!(err instanceof VersionConflictError)) throw err;
    currentDoc = err.freshDoc || newChapterDoc(key[0], key[1], key[2]);
    const result = await mutateChapter(key, currentDoc.version, mutator);
    currentDoc = result;
    return result;
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

function populateRange(range) {
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
    minInput.value = String(range.min);
    maxInput.value = String(range.max);
  }
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
  details.textContent = "Edit";
  details.addEventListener("click", () => openModal(name));

  row.append(check, nameSpan, oneline, details);
  return row;
}

// Render the whole list from currentDoc.randomization (in order).
function renderList() {
  clearExerciseList();
  if (!currentDoc || !currentDoc.randomization) {
    clearCounter();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const name of currentDoc.randomization) frag.appendChild(buildRow(name));
  exerciseList.appendChild(frag);
  updateCounter();
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
  if (!triple) return; // need all three fields to look anything up
  const key = chapterKey(triple.instrument, triple.book, triple.chapter);
  await ensureDb();
  const doc = await getChapter(key);
  // Guard against races: several autoloads may be in flight while typing.
  // Ignore this result if the inputs no longer match what we queried.
  if (!tripleEq(readTriple(), triple)) return;
  if (doc) {
    currentDoc = doc;
    populateRange(doc.last_range);
    renderList();
  } else {
    currentDoc = null;
    clearExerciseList();
    clearCounter();
  }
}

/* ------------------------------------------------------------------ *
 * Randomize.
 * ------------------------------------------------------------------ */
async function onRandomize() {
  const triple = readTriple();
  const min = parseIntStrict(minInput.value);
  const max = parseIntStrict(maxInput.value);

  // Validate before touching the DB.
  if (!triple) {
    showError("Please fill in instrument, book, and chapter.");
    return;
  }
  if (min === null || max === null) {
    showError("Min and max must be whole numbers.");
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

  const confirmed = window.confirm(
    "Randomizing will reset every exercise's completed checkbox for this chapter, and drop any exercises outside the new range. Comments for exercises staying in range are kept. Continue?"
  );
  if (!confirmed) return;

  // Randomize settles any pending inactivity timer and bumps last_used_at now.
  cancelLastUsedTimer();

  const names = [];
  for (let n = min; n <= max; n++) names.push(String(n));

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
      doc.last_range = { min, max };
      doc.randomization = shuffle(names);
      doc.randomized_at = Date.now();
      doc.use_count = (doc.use_count || 0) + 1;
      doc.last_used_at = Date.now();
      return doc;
    });
    renderList();
    refreshDatalists();
  } catch (err) {
    console.error("Randomize failed", err);
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
  clearExerciseList();
  clearCounter();
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
  }).catch((err) => console.error("Comment persist failed", err));
}

function scheduleCommentPersist(name) {
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
}

/* ------------------------------------------------------------------ *
 * Modal open / save / cancel.
 * ------------------------------------------------------------------ */
function openModal(name) {
  if (!currentDoc) return;
  cancelCommentThrottle(); // drop any stale pending write from a prior session
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
  clearExerciseList();
  clearCounter();
  rebuildDatalistDom(); // book/chapter suggestions now have no instrument context
}

/* ------------------------------------------------------------------ *
 * Event wiring.
 * ------------------------------------------------------------------ */
function onTripleInput() {
  restartLastUsedTimer(); // top-level field change (re)starts the 60s timer
  autoload();
}

function onRangeInput() {
  restartLastUsedTimer(); // min/max are top-level fields too
}

function wireEvents() {
  for (const el of [instrumentInput, bookInput, chapterInput]) {
    el.addEventListener("input", onTripleInput);
    el.addEventListener("change", onTripleInput);
  }
  for (const el of [minInput, maxInput]) {
    el.addEventListener("input", onRangeInput);
    el.addEventListener("change", onRangeInput);
  }
  randomizeBtn.addEventListener("click", onRandomize);
  clearBtn.addEventListener("click", onClearForm);
  deleteBtn.addEventListener("click", onDeleteChapter);
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
      populateRange(recent.last_range);
      renderList(); // handles null randomization (clears list + counter)
    }
  } catch (err) {
    console.error("Failed to restore most recent chapter", err);
  }

  await refreshDatalists();
}

wireEvents();
init();
