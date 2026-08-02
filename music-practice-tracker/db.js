// db.js — data-access layer for the "music-practice-tracker" SPA.
//
// Persistence model: ONE IndexedDB object store, "chapters". Each record is a
// self-contained document keyed by the composite [instrument, book, chapter].
// A document holds everything about that chapter: the current randomization,
// per-exercise completion state, recency/usage counters, etc. There are no
// other stores and no cross-document relations — a chapter is the unit of read
// and write.
//
// Two shapes of exercise list share that document. Normally the list is a
// contiguous integer run described by `last_range` {min,max}, regenerated from
// scratch on every Randomize. Once the user hand-edits the list (adding or
// deleting individual exercises), `custom_list` flips to true and stays true:
// `last_range` is set to null, the range inputs stop governing the chapter, and
// Randomize reshuffles the existing exercise set in place instead of rebuilding
// it. Documents written before `custom_list` existed simply lack the field, so
// read it as `!!doc.custom_list` — that absence means "contiguous", which is
// why this needed no DB_VERSION bump or migration.
//
// `numbering_system` names how exercise names are spelled ("numbers",
// "letters-upper", "letters-lower", "roman"). Exercise identity has always been
// an arbitrary string key, so this is a display/minting choice only; documents
// written before it existed lack the field and read as "numbers", which is again
// why no DB_VERSION bump or migration was needed. `last_range` stores 1-based
// INDEXES rather than spelled names, so it survives a change of system.
//
// Optimistic-concurrency (OCC) contract: every document carries a numeric
// `version`. Writes go through mutateChapter(key, expectedVersion, mutator),
// which — inside a SINGLE readwrite transaction — reads the current doc, checks
// that its version still equals `expectedVersion`, applies the mutator, then
// writes back with `version` incremented by one. If the stored version has
// moved on, the write is aborted and a VersionConflictError (carrying the fresh
// doc) is thrown so the caller can reconcile and retry. Passing
// expectedVersion === null skips the check entirely (create-if-absent / no
// check), used on the very first Randomize.
//
// Exactly TWO functions bypass that check, both deliberately:
// deleteChapter(key), because removing a chapter means "get rid of this
// regardless of version"; and restoreChapter(key, resolver), used by Undo.
// restoreChapter is only safe because it hands the resolver the live stored
// document and the resolver MERGES against it — see app.js's mergeRestore().
// Never use restoreChapter for a plain "write this doc back": it wins
// unconditionally, so an unmerged document would erase another tab's edits.

export const APP_GUID = "339718e4-583f-4270-bd72-23f4d23a6c9e";
export const DB_NAME = `music-practice-tracker-${APP_GUID}`;
export const DB_VERSION = 1;

const STORE = "chapters";
const RECENCY_INDEX = "by_last_used_at";

// --- small promise helpers around the raw IDB callback API ------------------

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- key + document factories ----------------------------------------------

export function chapterKey(instrument, book, chapter) {
  return [instrument, book, chapter];
}

export function newChapterDoc(instrument, book, chapter) {
  const now = Date.now();
  return {
    instrument,
    book,
    chapter,
    version: 0,
    use_count: 0,
    last_used_at: now,
    last_range: null,
    custom_list: false,
    numbering_system: "numbers",
    randomization: null,
    randomized_at: null,
    exercises: {},
    updated_at: now,
  };
}

// --- connection management --------------------------------------------------

// Cache the open connection in a module-level promise so repeated calls reuse
// one connection. Reset on failure/version-change so a later call can reopen.
let _dbPromise = null;

export async function openDb() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: ["instrument", "book", "chapter"],
        });
        store.createIndex(RECENCY_INDEX, "last_used_at");
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // If another tab requests an upgrade, step aside instead of blocking it.
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error(`openDb blocked: another connection is holding ${DB_NAME}`));
  });

  // Don't cache a rejected promise — allow a retry on the next call.
  _dbPromise.catch(() => {
    _dbPromise = null;
  });

  return _dbPromise;
}

// --- reads ------------------------------------------------------------------

export async function getChapter(key) {
  const db = await openDb();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  return requestToPromise(store.get(key));
}

export async function getMostRecentChapter() {
  const db = await openDb();
  const index = db
    .transaction(STORE, "readonly")
    .objectStore(STORE)
    .index(RECENCY_INDEX);
  return new Promise((resolve, reject) => {
    const req = index.openCursor(null, "prev"); // highest last_used_at first
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? cursor.value : undefined);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listChapters() {
  const db = await openDb();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  return requestToPromise(store.getAll());
}

// --- delete -------------------------------------------------------------

// User-initiated, destructive removal of an entire chapter document.
// Deliberately bypasses mutateChapter's OCC version check: deleting means
// "get rid of this regardless of version," not a conditional field update.
export async function deleteChapter(key) {
  const db = await openDb();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  return requestToPromise(store.delete(key));
}

// --- undo restore -----------------------------------------------------------

// Read-modify-write for Undo, in ONE transaction like mutateChapter but with no
// version check. `resolver(stored | null)` returns the document to store, or
// null to remove the record (undoing an action that created the chapter).
//
// The missing version check is the whole point: Undo must always land, and a
// conflict has nothing useful to retry — the snapshot it wants to restore does
// not get "fresher". Safety comes from the resolver instead, which is handed
// the live document and is required to merge against it rather than overwrite
// it (app.js's mergeRestore). Resolves with the stored document, or null.
export async function restoreChapter(key, resolver) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

    let result = null;
    let resolverError = null;

    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const live = getReq.result || null;

      let next;
      try {
        next = resolver(live);
      } catch (err) {
        resolverError = err;
        tx.abort();
        return;
      }

      if (next === null || next === undefined) {
        store.delete(key);
        return;
      }

      // Advance past whatever is stored so other tabs' next OCC write conflicts
      // and retries against this state rather than silently clobbering it.
      next.version = (live ? live.version : -1) + 1;
      next.updated_at = Date.now();
      result = next;
      store.put(next);
    };

    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(resolverError || tx.error || new Error("restoreChapter transaction aborted"));
    tx.onerror = () =>
      reject(resolverError || tx.error || new Error("restoreChapter transaction error"));
  });
}

// --- optimistic-concurrency write ------------------------------------------

export class VersionConflictError extends Error {
  constructor(message, freshDoc) {
    super(message);
    this.name = "VersionConflictError";
    this.freshDoc = freshDoc; // current stored doc (may be undefined)
  }
}

export async function mutateChapter(key, expectedVersion, mutator) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

    let result = null; // the doc we intend to store; resolved on complete
    let conflict = null; // VersionConflictError, if the check failed
    let mutatorError = null; // error thrown by the mutator, if any

    // Read and write happen in this ONE transaction so the read-modify-write
    // is atomic — no second transaction between get() and put().
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const doc = getReq.result;
      const cur = doc ? doc.version : 0;

      if (expectedVersion !== null && cur !== expectedVersion) {
        conflict = new VersionConflictError(
          `Version conflict for ${JSON.stringify(key)}: expected ${expectedVersion}, found ${cur}`,
          doc
        );
        tx.abort();
        return;
      }

      let next;
      try {
        next = mutator(doc);
        next.version = cur + 1;
        next.updated_at = Date.now();
      } catch (err) {
        mutatorError = err;
        tx.abort();
        return;
      }

      result = next;
      store.put(next);
    };
    // A failed get() surfaces via tx.onerror below.

    tx.oncomplete = () => resolve(result);
    tx.onabort = () => {
      if (conflict) reject(conflict);
      else if (mutatorError) reject(mutatorError);
      else reject(tx.error || new Error("mutateChapter transaction aborted"));
    };
    tx.onerror = () => {
      if (conflict) reject(conflict);
      else if (mutatorError) reject(mutatorError);
      else reject(tx.error || new Error("mutateChapter transaction error"));
    };
  });
}
