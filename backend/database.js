"use strict";

const { Pool } = require("pg");
const { detectPlatform } = require("./utils/platformDetector");

let pool;
let isInMemory = false;

const isProduction = process.env.NODE_ENV === "production";

if (process.env.DATABASE_URL) {
    const isLocalhost =
        process.env.DATABASE_URL.includes("localhost") ||
        process.env.DATABASE_URL.includes("127.0.0.1") ||
        process.env.DATABASE_URL.includes("sslmode=disable");

    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocalhost ? false : { rejectUnauthorized: false }
    });
} else if (isProduction) {
    throw new Error(
        "[DATABASE CONFIG ERROR] DATABASE_URL environment variable is required in production mode. " +
        "Refusing to run with ephemeral in-memory database."
    );
} else {
    // In test or offline development environments without DATABASE_URL,
    // provide an in-memory PostgreSQL instance using pg-mem so callers get full PostgreSQL compatibility.
    const { newDb } = require("pg-mem");
    const memDb = newDb();
    const pgAdapter = memDb.adapters.createPg();
    pool = new pgAdapter.Pool();
    isInMemory = true;
}

/**
 * Execute a parameterized PostgreSQL query.
 * @param {string} text - SQL query text with $1, $2, ... placeholders
 * @param {Array} [params] - Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
    return pool.query(text, params);
}

/**
 * Acquire a dedicated client from the pool (for transactions).
 * Remember to release the client when done: client.release()
 */
async function getClient() {
    return pool.connect();
}

/**
 * Close the connection pool.
 */
async function close() {
    return pool.end();
}

/**
 * Idempotently initializes database tables, columns, and platform backfills.
 */
async function initDatabase() {
    await query(`
        CREATE TABLE IF NOT EXISTS saved_content (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            platform TEXT NOT NULL DEFAULT 'Unknown',
            checked INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await query(`
        ALTER TABLE saved_content
        ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'Unknown';
    `);

    await query(`
        ALTER TABLE saved_content
        ADD COLUMN IF NOT EXISTS checked INTEGER NOT NULL DEFAULT 0;
    `);

    await query(`
        UPDATE saved_content
        SET platform = 'Instagram'
        WHERE url LIKE '%instagram.com%'
          AND platform = 'Unknown';
    `);

    await query(`
        UPDATE saved_content
        SET platform = 'YouTube'
        WHERE (
            url LIKE '%youtube.com%'
            OR url LIKE '%youtu.be%'
        )
        AND platform = 'Unknown';
    `);

    await query(`
        UPDATE saved_content
        SET platform = 'TikTok'
        WHERE url LIKE '%tiktok.com%'
          AND platform = 'Unknown';
    `);

    await query(`
        UPDATE saved_content
        SET platform = 'Reddit'
        WHERE url LIKE '%reddit.com%'
          AND platform = 'Unknown';
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS instagram_shared_posts (
            id SERIAL PRIMARY KEY,
            media_id TEXT NOT NULL UNIQUE,
            media_type TEXT NOT NULL DEFAULT 'ig_post',
            title TEXT,
            url TEXT,
            sender_id TEXT,
            message_id TEXT,
            cta_type TEXT,
            cta_keyword TEXT,
            action_type TEXT,
            action_input TEXT,
            action_status TEXT,
            received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const columnDefinitions = [
        { name: "media_type", ddl: "ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'ig_post'" },
        { name: "url", ddl: "ADD COLUMN IF NOT EXISTS url TEXT" },
        { name: "cta_type", ddl: "ADD COLUMN IF NOT EXISTS cta_type TEXT" },
        { name: "cta_keyword", ddl: "ADD COLUMN IF NOT EXISTS cta_keyword TEXT" },
        { name: "action_type", ddl: "ADD COLUMN IF NOT EXISTS action_type TEXT" },
        { name: "action_input", ddl: "ADD COLUMN IF NOT EXISTS action_input TEXT" },
        { name: "action_status", ddl: "ADD COLUMN IF NOT EXISTS action_status TEXT" },
        { name: "original_url", ddl: "ADD COLUMN IF NOT EXISTS original_url TEXT" },
        { name: "resource_url", ddl: "ADD COLUMN IF NOT EXISTS resource_url TEXT" },
        { name: "recipient_id", ddl: "ADD COLUMN IF NOT EXISTS recipient_id TEXT" },
        { name: "resource_platform", ddl: "ADD COLUMN IF NOT EXISTS resource_platform TEXT" }
    ];

    for (const col of columnDefinitions) {
        await query(`ALTER TABLE instagram_shared_posts ${col.ddl};`);
    }

    await query(`
        UPDATE instagram_shared_posts
        SET resource_url = NULL,
            action_status = CASE WHEN action_status = 'LINK_RECEIVED' THEN 'READY' ELSE action_status END
        WHERE resource_url LIKE '%fbsbx.com%'
           OR resource_url LIKE '%cdninstagram.com%'
           OR resource_url LIKE '%instagram.com%';
    `);

    await query(`
        UPDATE instagram_shared_posts
        SET original_url = url
        WHERE original_url IS NULL
          AND url IS NOT NULL
          AND (url LIKE '%instagram.com%' OR url LIKE '%instagr.am%');
    `);

    await query(`
        UPDATE instagram_shared_posts
        SET resource_url = url
        WHERE resource_url IS NULL
          AND url IS NOT NULL
          AND url NOT LIKE '%instagram.com%'
          AND url NOT LIKE '%instagr.am%'
          AND url NOT LIKE '%fbsbx.com%'
          AND url NOT LIKE '%cdninstagram.com%';
    `);

    // Detect and backfill platform for existing resource URLs
    const rowsToUpdateResult = await query(
        "SELECT id, resource_url FROM instagram_shared_posts WHERE resource_url IS NOT NULL AND resource_platform IS NULL;"
    );

    if (rowsToUpdateResult.rows.length > 0) {
        for (const row of rowsToUpdateResult.rows) {
            const platform = detectPlatform(row.resource_url);
            await query(
                "UPDATE instagram_shared_posts SET resource_platform = $1 WHERE id = $2;",
                [platform, row.id]
            );
        }
    }

    console.log("Database ready!");
}

module.exports = {
    query,
    getClient,
    initDatabase,
    close,
    pool,
    isInMemory
};