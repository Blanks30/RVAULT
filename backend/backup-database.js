"use strict";

/**
 * backup-database.js
 *
 * Creates a timestamped SQLite backup of ravault.db using the
 * better-sqlite3 online backup API (safe for a live database).
 *
 * Usage:
 *   node backend/backup-database.js
 *   npm run backup          (from project root)
 *
 * Behaviour:
 *   1. Writes a new backup to backups/ravault-<ISO-timestamp>.db
 *   2. Verifies the backup with PRAGMA integrity_check and confirms
 *      the saved_content table is present.
 *   3. Keeps at most MAX_BACKUPS (7) verified backups; older ones
 *      are deleted only after the new backup passes verification.
 *   4. Never modifies or deletes the active database (ravault.db).
 */

const path = require("path");
const fs   = require("fs");
const Database = require("better-sqlite3");

// ── Paths ────────────────────────────────────────────────────────────────────
const PROJECT_ROOT    = path.join(__dirname, "..");
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, "ravault.db");
const configuredPath  = process.env.SQLITE_DB_PATH || process.env.DATABASE_PATH;
const DB_PATH         = configuredPath
    ? path.resolve(configuredPath)
    : DEFAULT_DB_PATH;
const BACKUPS_DIR     = path.join(PROJECT_ROOT, "backups");

// ── Config ───────────────────────────────────────────────────────────────────
const MAX_BACKUPS = 7;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return an ISO-8601 timestamp safe for filenames (colons replaced). */
function safeTimestamp() {
    return new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
}

/** Verify a SQLite file: integrity_check + saved_content table presence. */
function verifyBackup(backupPath) {
    const bdb = new Database(backupPath, { readonly: true });
    try {
        const rows = bdb.prepare("PRAGMA integrity_check").all();
        const ok   = rows.length === 1 && rows[0].integrity_check === "ok";
        if (!ok) {
            throw new Error(
                `integrity_check failed: ${JSON.stringify(rows)}`
            );
        }

        const tables = bdb
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='saved_content'"
            )
            .all();

        if (tables.length === 0) {
            throw new Error("saved_content table not found in backup");
        }

        return { ok: true };
    } finally {
        bdb.close();
    }
}

/** Return backup files sorted oldest-first. */
function listBackups() {
    if (!fs.existsSync(BACKUPS_DIR)) return [];

    return fs
        .readdirSync(BACKUPS_DIR)
        .filter((f) => f.startsWith("ravault-") && f.endsWith(".db"))
        .sort() // ISO timestamps sort lexicographically == chronologically
        .map((f) => path.join(BACKUPS_DIR, f));
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async function main() {
    // 1. Guard – source database must exist
    if (!fs.existsSync(DB_PATH)) {
        console.error(`[backup] ERROR: source database not found: ${DB_PATH}`);
        process.exit(1);
    }

    // 2. Ensure backups directory exists
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });

    // 3. Determine backup destination
    const timestamp  = safeTimestamp();
    const backupFile = path.join(BACKUPS_DIR, `ravault-${timestamp}.db`);

    console.log(`[backup] Source  : ${DB_PATH}`);
    console.log(`[backup] Target  : ${backupFile}`);

    // 4. Open the live database READ-ONLY and run the online backup API.
    //    better-sqlite3's .backup() returns a Promise; it pages the copy
    //    without locking writers for more than a few milliseconds at a time.
    const sourceDb = new Database(DB_PATH, { readonly: true });
    try {
        await sourceDb.backup(backupFile);
        console.log(`[backup] Backup written successfully.`);
    } finally {
        sourceDb.close();
    }

    // 5. Verify the new backup; clean up the file if verification fails
    //    so a corrupt/partial backup never counts toward the rotation limit.
    console.log(`[backup] Verifying backup...`);
    try {
        verifyBackup(backupFile);
    } catch (verifyErr) {
        try { fs.unlinkSync(backupFile); } catch (_) { /* best-effort */ }
        throw verifyErr; // re-throw so the outer .catch() exits with code 1
    }
    console.log(`[backup] integrity_check passed`);
    console.log(`[backup] saved_content table present`);

    // 6. Rotate – delete oldest backups beyond MAX_BACKUPS
    //    (only after the new backup has been verified above)
    const allBackups = listBackups(); // includes the one just created
    const excess     = allBackups.length - MAX_BACKUPS;

    if (excess > 0) {
        const toDelete = allBackups.slice(0, excess);
        for (const old of toDelete) {
            fs.unlinkSync(old);
            console.log(`[backup] Removed old backup: ${path.basename(old)}`);
        }
    }

    const remaining = listBackups();
    console.log(
        `[backup] Done. ${remaining.length} backup(s) retained (max ${MAX_BACKUPS}).`
    );
})().catch((err) => {
    console.error("[backup] FATAL:", err.message);
    process.exit(1);
});
