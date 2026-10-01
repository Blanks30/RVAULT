const path = require("path");
const Database = require("better-sqlite3");

// Anchor to the project root (one level above this backend/ directory)
// so the same ravault.db is used regardless of the working directory
// Node is started from. Previously `new Database("ravault.db")` was
// CWD-relative, which created a second empty file when started from
// backend/ instead of the project root.
const DB_PATH = path.join(__dirname, "..", "ravault.db");

const db = new Database(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS saved_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL DEFAULT 'Unknown',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

const savedContentColumns = db
    .prepare("PRAGMA table_info(saved_content)")
    .all();

const hasPlatformColumn = savedContentColumns.some(
    (column) => column.name === "platform"
);

if (!hasPlatformColumn) {
    db.exec(`
        ALTER TABLE saved_content
        ADD COLUMN platform TEXT NOT NULL DEFAULT 'Unknown'
    `);

    console.log("Added platform column to saved_content!");
}

db.exec(`
    UPDATE saved_content
    SET platform = 'Instagram'
    WHERE url LIKE '%instagram.com%'
      AND platform = 'Unknown'
`);

db.exec(`
    UPDATE saved_content
    SET platform = 'YouTube'
    WHERE (
        url LIKE '%youtube.com%'
        OR url LIKE '%youtu.be%'
    )
    AND platform = 'Unknown'
`);

db.exec(`
    UPDATE saved_content
    SET platform = 'TikTok'
    WHERE url LIKE '%tiktok.com%'
      AND platform = 'Unknown'
`);

db.exec(`
    UPDATE saved_content
    SET platform = 'Reddit'
    WHERE url LIKE '%reddit.com%'
      AND platform = 'Unknown'
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS instagram_shared_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

const sharedPostColumns = db
    .prepare("PRAGMA table_info(instagram_shared_posts)")
    .all();

const hasMediaTypeColumn = sharedPostColumns.some(
    (column) => column.name === "media_type"
);

const hasUrlColumn = sharedPostColumns.some(
    (column) => column.name === "url"
);

const hasCtaTypeColumn = sharedPostColumns.some(
    (column) => column.name === "cta_type"
);

const hasCtaKeywordColumn = sharedPostColumns.some(
    (column) => column.name === "cta_keyword"
);

const hasActionTypeColumn = sharedPostColumns.some(
    (column) => column.name === "action_type"
);

const hasActionInputColumn = sharedPostColumns.some(
    (column) => column.name === "action_input"
);

const hasActionStatusColumn = sharedPostColumns.some(
    (column) => column.name === "action_status"
);

if (!hasMediaTypeColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN media_type TEXT NOT NULL DEFAULT 'ig_post'
    `);

    console.log(
        "Added media_type column to instagram_shared_posts!"
    );
}

if (!hasUrlColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN url TEXT
    `);

    console.log(
        "Added url column to instagram_shared_posts!"
    );
}

if (!hasCtaTypeColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN cta_type TEXT
    `);

    console.log(
        "Added cta_type column to instagram_shared_posts!"
    );
}

if (!hasCtaKeywordColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN cta_keyword TEXT
    `);

    console.log(
        "Added cta_keyword column to instagram_shared_posts!"
    );
}

if (!hasActionTypeColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN action_type TEXT
    `);

    console.log(
        "Added action_type column to instagram_shared_posts!"
    );
}

if (!hasActionInputColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN action_input TEXT
    `);

    console.log(
        "Added action_input column to instagram_shared_posts!"
    );
}

if (!hasActionStatusColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN action_status TEXT
    `);

    console.log(
        "Added action_status column to instagram_shared_posts!"
    );
}

const hasOriginalUrlColumn = sharedPostColumns.some(
    (column) => column.name === "original_url"
);

const hasResourceUrlColumn = sharedPostColumns.some(
    (column) => column.name === "resource_url"
);

if (!hasOriginalUrlColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN original_url TEXT
    `);

    console.log(
        "Added original_url column to instagram_shared_posts!"
    );
}

if (!hasResourceUrlColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN resource_url TEXT
    `);

    console.log(
        "Added resource_url column to instagram_shared_posts!"
    );
}

const hasRecipientIdColumn = sharedPostColumns.some(
    (column) => column.name === "recipient_id"
);

if (!hasRecipientIdColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN recipient_id TEXT
    `);

    console.log(
        "Added recipient_id column to instagram_shared_posts!"
    );
}

db.exec(`
    UPDATE instagram_shared_posts
    SET resource_url = NULL,
        action_status = CASE WHEN action_status = 'LINK_RECEIVED' THEN 'READY' ELSE action_status END
    WHERE resource_url LIKE '%fbsbx.com%'
       OR resource_url LIKE '%cdninstagram.com%'
       OR resource_url LIKE '%instagram.com%'
`);

db.exec(`
    UPDATE instagram_shared_posts
    SET original_url = url
    WHERE original_url IS NULL
      AND url IS NOT NULL
      AND (url LIKE '%instagram.com%' OR url LIKE '%instagr.am%')
`);

db.exec(`
    UPDATE instagram_shared_posts
    SET resource_url = url
    WHERE resource_url IS NULL
      AND url IS NOT NULL
      AND url NOT LIKE '%instagram.com%'
      AND url NOT LIKE '%instagr.am%'
      AND url NOT LIKE '%fbsbx.com%'
      AND url NOT LIKE '%cdninstagram.com%'
`);

const hasResourcePlatformColumn = sharedPostColumns.some(
    (column) => column.name === "resource_platform"
);

if (!hasResourcePlatformColumn) {
    db.exec(`
        ALTER TABLE instagram_shared_posts
        ADD COLUMN resource_platform TEXT
    `);

    console.log(
        "Added resource_platform column to instagram_shared_posts!"
    );
}

// Detect and backfill platform for existing resource URLs
const { detectPlatform } = require("./utils/platformDetector");

const rowsToUpdate = db
    .prepare(
        "SELECT id, resource_url FROM instagram_shared_posts WHERE resource_url IS NOT NULL AND resource_platform IS NULL"
    )
    .all();

if (rowsToUpdate.length > 0) {
    const updateStmt = db.prepare(
        "UPDATE instagram_shared_posts SET resource_platform = ? WHERE id = ?"
    );

    for (const row of rowsToUpdate) {
        const platform = detectPlatform(row.resource_url);
        updateStmt.run(platform, row.id);
    }

    console.log(
        `Backfilled resource_platform for ${rowsToUpdate.length} existing resource(s)!`
    );
}

console.log("Database ready!");

module.exports = db;