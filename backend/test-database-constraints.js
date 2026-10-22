"use strict";

const assert = require("assert");
const { newDb } = require("pg-mem");

async function runTests() {
    const memDb = newDb();
    const pgAdapter = memDb.adapters.createPg();
    const client = new pgAdapter.Client();
    await client.connect();

    await client.query(`
        CREATE TABLE instagram_shared_posts (
            id SERIAL PRIMARY KEY,
            media_id TEXT UNIQUE NOT NULL
        );

        CREATE TABLE saved_content (
            id SERIAL PRIMARY KEY,
            url TEXT UNIQUE NOT NULL
        );
    `);

    console.log("Testing duplicate media_id...");

    await client.query(
        "INSERT INTO instagram_shared_posts (media_id) VALUES ($1)",
        ["TEST_MEDIA_001"]
    );

    let caughtMediaDuplicate = false;
    try {
        await client.query(
            "INSERT INTO instagram_shared_posts (media_id) VALUES ($1)",
            ["TEST_MEDIA_001"]
        );
    } catch (err) {
        caughtMediaDuplicate = true;
        assert.strictEqual(err.code, "23505", "PostgreSQL duplicate error code should be 23505");
    }

    assert(caughtMediaDuplicate, "Duplicate media_id was not rejected");
    console.log("PASS: duplicate media_id rejected (error code 23505)");

    console.log("Testing duplicate URL...");

    await client.query(
        "INSERT INTO saved_content (url) VALUES ($1)",
        ["https://example.com/resource"]
    );

    let caughtUrlDuplicate = false;
    try {
        await client.query(
            "INSERT INTO saved_content (url) VALUES ($1)",
            ["https://example.com/resource"]
        );
    } catch (err) {
        caughtUrlDuplicate = true;
        assert.strictEqual(err.code, "23505", "PostgreSQL duplicate error code should be 23505");
    }

    assert(caughtUrlDuplicate, "Duplicate URL was not rejected");
    console.log("PASS: duplicate URL rejected (error code 23505)");

    console.log("Testing migration-style idempotency...");

    await client.query(`
        ALTER TABLE saved_content ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'Unknown';
    `);

    await client.query(`
        ALTER TABLE saved_content ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'Unknown';
    `);

    console.log("PASS: repeated migration-style operation succeeded");

    await client.end();
    console.log("\nDatabase integrity tests passed.");
}

runTests().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
