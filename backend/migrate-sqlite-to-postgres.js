"use strict";

/**
 * migrate-sqlite-to-postgres.js
 *
 * Explicitly invoked data migration tool from local SQLite (ravault.db) to PostgreSQL.
 *
 * Requirements:
 * - Preserves all IDs, timestamps, and fields exactly.
 * - Defaults to REFUSING migration if destination tables already contain data (override with --force).
 * - Executes in a single atomic transaction; rolls back completely on any failure.
 * - Resets PostgreSQL SERIAL identity sequences so future inserts succeed seamlessly.
 * - Never runs automatically on server start.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node backend/migrate-sqlite-to-postgres.js
 *   DATABASE_URL="postgresql://..." node backend/migrate-sqlite-to-postgres.js --force
 */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const configuredSqlitePath =
    process.env.SQLITE_DB_PATH || process.env.DATABASE_PATH;
const SQLITE_PATH = configuredSqlitePath
    ? path.resolve(configuredSqlitePath)
    : path.join(__dirname, "..", "ravault.db");

async function migrate({ force = false } = {}) {
    console.log("=== SQLite to PostgreSQL Data Migration ===");
    console.log(`Source SQLite database : ${SQLITE_PATH}`);

    if (!fs.existsSync(SQLITE_PATH)) {
        throw new Error(`Source SQLite file not found: ${SQLITE_PATH}`);
    }

    if (!process.env.DATABASE_URL) {
        throw new Error(
            "DATABASE_URL environment variable is required to run migration."
        );
    }

    const isLocalhost =
        process.env.DATABASE_URL.includes("localhost") ||
        process.env.DATABASE_URL.includes("127.0.0.1") ||
        process.env.DATABASE_URL.includes("sslmode=disable");

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocalhost ? false : { rejectUnauthorized: false }
    });

    const sqlite = new Database(SQLITE_PATH, { readonly: true });

    try {
        // 1. Ensure target schema exists in PostgreSQL
        const dbModule = require("./database");
        await dbModule.initDatabase();

        // 2. Check destination counts - default to refusing non-empty destination
        const destSavedCount = Number(
            (await pool.query("SELECT COUNT(*) AS c FROM saved_content")).rows[0].c
        );
        const destSharedCount = Number(
            (await pool.query("SELECT COUNT(*) AS c FROM instagram_shared_posts")).rows[0].c
        );

        if ((destSavedCount > 0 || destSharedCount > 0) && !force) {
            throw new Error(
                `Destination tables are not empty (saved_content: ${destSavedCount}, instagram_shared_posts: ${destSharedCount}). ` +
                `Refusing to migrate to prevent accidental overwrites. Pass --force if you intentionally wish to proceed.`
            );
        }

        // 3. Read source rows from SQLite
        const sourceSavedRows = sqlite
            .prepare("SELECT id, url, platform, checked, created_at FROM saved_content ORDER BY id ASC")
            .all();

        const sourceSharedRows = sqlite
            .prepare(`
                SELECT
                    id, media_id, media_type, title, url, original_url,
                    resource_url, resource_platform, sender_id, recipient_id,
                    message_id, cta_type, cta_keyword, action_type, action_input,
                    action_status, received_at
                FROM instagram_shared_posts
                ORDER BY id ASC
            `)
            .all();

        console.log(`Source rows found:`);
        console.log(`  - saved_content         : ${sourceSavedRows.length}`);
        console.log(`  - instagram_shared_posts: ${sourceSharedRows.length}`);

        // 4. Begin transaction
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            if (force && (destSavedCount > 0 || destSharedCount > 0)) {
                console.log("--force specified: clearing destination tables before reload...");
                await client.query("DELETE FROM saved_content");
                await client.query("DELETE FROM instagram_shared_posts");
            }

            // Insert saved_content rows preserving explicit IDs
            for (const row of sourceSavedRows) {
                await client.query(
                    `
                    INSERT INTO saved_content (id, url, platform, checked, created_at)
                    VALUES ($1, $2, $3, $4, $5)
                    `,
                    [
                        row.id,
                        row.url,
                        row.platform || "Unknown",
                        row.checked ? 1 : 0,
                        row.created_at
                    ]
                );
            }

            // Insert instagram_shared_posts rows preserving explicit IDs
            for (const row of sourceSharedRows) {
                await client.query(
                    `
                    INSERT INTO instagram_shared_posts (
                        id, media_id, media_type, title, url, original_url,
                        resource_url, resource_platform, sender_id, recipient_id,
                        message_id, cta_type, cta_keyword, action_type, action_input,
                        action_status, received_at
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6,
                        $7, $8, $9, $10, $11, $12,
                        $13, $14, $15, $16, $17
                    )
                    `,
                    [
                        row.id,
                        row.media_id,
                        row.media_type || "ig_post",
                        row.title,
                        row.url,
                        row.original_url,
                        row.resource_url,
                        row.resource_platform,
                        row.sender_id,
                        row.recipient_id,
                        row.message_id,
                        row.cta_type,
                        row.cta_keyword,
                        row.action_type,
                        row.action_input,
                        row.action_status,
                        row.received_at
                    ]
                );
            }

            // Reset SERIAL identity sequences so future inserts do not conflict with existing IDs
            await client.query(`
                SELECT setval(
                    pg_get_serial_sequence('saved_content', 'id'),
                    COALESCE((SELECT MAX(id) FROM saved_content), 1),
                    (SELECT MAX(id) FROM saved_content) IS NOT NULL
                );
            `);

            await client.query(`
                SELECT setval(
                    pg_get_serial_sequence('instagram_shared_posts', 'id'),
                    COALESCE((SELECT MAX(id) FROM instagram_shared_posts), 1),
                    (SELECT MAX(id) FROM instagram_shared_posts) IS NOT NULL
                );
            `);

            await client.query("COMMIT");
            console.log("Transaction committed successfully.");
        } catch (txErr) {
            await client.query("ROLLBACK");
            throw txErr;
        } finally {
            client.release();
        }

        // 5. Verify row counts on destination
        const verifySaved = Number(
            (await pool.query("SELECT COUNT(*) AS c FROM saved_content")).rows[0].c
        );
        const verifyShared = Number(
            (await pool.query("SELECT COUNT(*) AS c FROM instagram_shared_posts")).rows[0].c
        );

        console.log(`\n=== Migration Verification ===`);
        console.log(`saved_content          : Source = ${sourceSavedRows.length} | Destination = ${verifySaved}`);
        console.log(`instagram_shared_posts : Source = ${sourceSharedRows.length} | Destination = ${verifyShared}`);

        if (
            verifySaved !== sourceSavedRows.length ||
            verifyShared !== sourceSharedRows.length
        ) {
            throw new Error("Row count mismatch between source and destination!");
        }

        console.log("✨ All records verified. Migration complete!\n");
        return {
            success: true,
            savedCount: verifySaved,
            sharedCount: verifyShared
        };
    } finally {
        sqlite.close();
        try {
            const dbModule = require("./database");
            await dbModule.close();
        } catch (_) {}
        await pool.end();
    }
}

if (require.main === module) {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        console.log(`
RVAULT SQLite-to-PostgreSQL Data Migration Tool

Usage:
  DATABASE_URL="postgresql://user:pass@host:port/dbname" node backend/migrate-sqlite-to-postgres.js [options]

Options:
  --force    Overwrite / append to non-empty destination tables (default is to refuse)
  --help, -h Show this help message

Environment Variables:
  DATABASE_URL     PostgreSQL connection string (required)
  SQLITE_DB_PATH   Path to source SQLite .db file (defaults to ./ravault.db)
`);
        process.exit(0);
    }

    const force = process.argv.includes("--force");
    migrate({ force })
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("\n❌ Migration failed:", err.message);
            process.exit(1);
        });
}

module.exports = { migrate };
