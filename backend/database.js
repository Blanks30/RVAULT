const Database = require("better-sqlite3");

const db = new Database("ravault.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS saved_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

console.log("Database ready!");

module.exports = db;