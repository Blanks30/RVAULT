const Database = require("better-sqlite3");

const db = new Database("ravault.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS saved_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL DEFAULT 'Unknown',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

const columns = db
    .prepare("PRAGMA table_info(saved_content)")
    .all();

const hasPlatformColumn = columns.some(
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

console.log("Database ready!");

module.exports = db;