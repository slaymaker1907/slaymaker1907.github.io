// db.js — data-access layer for the "music-practice-tracker" SPA.
//
// Persistence model: ONE IndexedDB object store, "chapters". Each record is a
// self-contained document keyed by the composite [instrument, book, chapter].
// A document holds everything about that chapter: the current randomization,
// per-exercise completion state, recency/usage counters, etc. There are no
// other stores and no cross-document relations — a chapter is the unit of read
// and write.
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
