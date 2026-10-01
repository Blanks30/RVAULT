const assert = require("assert");
const Database = require("better-sqlite3");

const db = new Database(":memory:");

db.exec(`
CREATE TABLE instagram_shared_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT UNIQUE NOT NULL
);

CREATE TABLE saved_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL
);
`);

console.log("Testing duplicate media_id...");

db.prepare(
    "INSERT INTO instagram_shared_posts (media_id) VALUES (?)"
).run("TEST_MEDIA_001");

assert.throws(() => {
    db.prepare(
        "INSERT INTO instagram_shared_posts (media_id) VALUES (?)"
    ).run("TEST_MEDIA_001");
});

console.log("PASS: duplicate media_id rejected");

console.log("Testing duplicate URL...");

db.prepare(
    "INSERT INTO saved_content (url) VALUES (?)"
).run("https://example.com/resource");

assert.throws(() => {
    db.prepare(
        "INSERT INTO saved_content (url) VALUES (?)"
    ).run("https://example.com/resource");
});

console.log("PASS: duplicate URL rejected");

console.log("Testing migration-style idempotency...");

db.exec(`
CREATE TABLE IF NOT EXISTS migration_test (
    id INTEGER PRIMARY KEY,
    value TEXT
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS migration_test (
    id INTEGER PRIMARY KEY,
    value TEXT
);
`);

console.log("PASS: repeated migration-style operation succeeded");

db.close();

console.log("\nDatabase integrity tests passed.");
