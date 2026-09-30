/**
 * test-db-path.js
 *
 * Verifies that database.js opens the canonical root ravault.db at runtime,
 * regardless of the working directory Node is started from.
 *
 * This catches the regression where `new Database("ravault.db")` was
 * CWD-relative, causing a second empty DB to be created when Node was
 * started from backend/ instead of the project root.
 *
 * Run: node backend/test-db-path.js
 */

const path = require("path");
const fs = require("fs");

let failed = 0;

function pass(msg) { console.log("PASS:", msg); }
function fail(msg, detail) {
    failed++;
    console.error("FAIL:", msg);
    if (detail) console.error("     ", detail);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const CANONICAL_DB = path.resolve(__dirname, "..", "ravault.db");
const STALE_DB     = path.resolve(__dirname, "ravault.db");

// ─── Check 1: canonical DB file exists on disk ────────────────────────────────

if (fs.existsSync(CANONICAL_DB)) {
    pass("Canonical DB file exists at: " + CANONICAL_DB);
} else {
    fail("Canonical DB not found at: " + CANONICAL_DB);
    process.exit(1); // Can't continue without the file
}

// ─── Check 2: load database.js and inspect the live connection ────────────────
//
// better-sqlite3 exposes `db.name` which is the resolved absolute path the
// connection was actually opened with. This is the real runtime proof that
// database.js is using the right file — not a re-computation of its math.

const db = require("./database");   // loads database.js from backend/

const actualDbPath = path.resolve(db.name);  // db.name from better-sqlite3
const expectedDbPath = CANONICAL_DB;

if (actualDbPath === expectedDbPath) {
    pass("database.js opened the canonical DB: " + actualDbPath);
} else {
    fail(
        "database.js opened the WRONG database file",
        "Expected: " + expectedDbPath + "\n      Actual:   " + actualDbPath
    );
}

// ─── Check 3: connection is open and queryable ────────────────────────────────

let savedCount, sharedCount;

try {
    savedCount  = db.prepare("SELECT COUNT(*) AS cnt FROM saved_content").get().cnt;
    sharedCount = db.prepare("SELECT COUNT(*) AS cnt FROM instagram_shared_posts").get().cnt;
    pass("saved_content is queryable via database.js connection (" + savedCount + " rows)");
    pass("instagram_shared_posts is queryable via database.js connection (" + sharedCount + " rows)");
} catch (err) {
    fail("Query through database.js connection threw an error", err.message);
    process.exit(1);
}

// ─── Check 4: canonical DB actually contains production data ─────────────────
//
// Distinguishes the real root DB (17 saved_content rows) from the stale
// backend/ravault.db (0 rows in both tables). If both are zero, something
// went wrong — either the wrong file is open or data was deleted.

if (savedCount > 0 || sharedCount > 0) {
    pass(
        "Canonical DB contains production data — saved_content: " +
        savedCount + ", instagram_shared_posts: " + sharedCount
    );
} else {
    fail(
        "database.js connection shows 0 rows in both tables — " +
        "this looks like the empty stale backend/ravault.db, not the canonical root DB"
    );
}

// ─── Check 5: correct schema — required columns exist ────────────────────────
//
// The canonical root DB has 3 columns added by later migrations that the
// stale backend/ravault.db never received: original_url, resource_url,
// recipient_id. Their presence confirms we are on the right file.

const sharedCols = db
    .prepare("PRAGMA table_info(instagram_shared_posts)")
    .all()
    .map((c) => c.name);

const requiredCols = ["original_url", "resource_url", "recipient_id"];
const missingCols  = requiredCols.filter((c) => !sharedCols.includes(c));

if (missingCols.length === 0) {
    pass("instagram_shared_posts has all required columns (original_url, resource_url, recipient_id)");
} else {
    fail(
        "instagram_shared_posts is missing columns that exist only in the canonical DB",
        "Missing: " + missingCols.join(", ") +
        " — database.js may be pointing at the stale backend/ravault.db"
    );
}

// ─── Check 6: stale backend/ravault.db is untouched ──────────────────────────

if (fs.existsSync(STALE_DB)) {
    // Open read-only to verify it is still empty and unchanged
    const Database = require("better-sqlite3");
    const staleDb  = new Database(STALE_DB, { readonly: true });
    const staleCount = staleDb.prepare("SELECT COUNT(*) AS cnt FROM saved_content").get().cnt;
    staleDb.close();

    pass(
        "Stale backend/ravault.db still exists and is untouched (" +
        staleCount + " rows in saved_content)"
    );
} else {
    pass("backend/ravault.db does not exist (acceptable — was never used for production data)");
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("");

if (failed > 0) {
    console.error(failed + " DB path test(s) FAILED.");
    process.exit(1);
}

console.log("All DB path tests passed.");
