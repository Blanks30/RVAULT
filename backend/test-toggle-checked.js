/**
 * test-toggle-checked.js
 *
 * Tests for the PATCH /saved/:id/toggle endpoint
 * that updates the checked state of saved content items.
 *
 * Uses an in-memory PostgreSQL DB via pg-mem.
 *
 * Run: node backend/test-toggle-checked.js
 */

const express = require("express");
const { newDb } = require("pg-mem");
const path = require("path");

// ---- Minimal in-memory PostgreSQL DB setup ----
const memDb = newDb();
const pgAdapter = memDb.adapters.createPg();
const pool = new pgAdapter.Pool();

const testDb = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    initDatabase: async () => {},
    close: () => pool.end(),
    pool
};

// Clear require cache and replace the database module
delete require.cache[require.resolve("./database")];
require.cache[require.resolve("./database")] = {
    exports: testDb,
    id: require.resolve("./database")
};

// Now require the router (it will use the mocked db)
const contentRouter = require("./routes/content");

// ---- Test app setup ----
const app = express();
app.use(express.json());
app.use("/", contentRouter);

// ---- Test utilities ----
let testCount = 0;
let passCount = 0;
let failCount = 0;

async function test(description, fn) {
    testCount++;
    try {
        await fn();
        passCount++;
        console.log(`✓ ${description}`);
    } catch (error) {
        failCount++;
        console.error(`✗ ${description}`);
        console.error(`  ${error.message}`);
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(
            `${message || "Assertion failed"}: expected ${expected}, got ${actual}`
        );
    }
}

// ---- Simple HTTP client using Node's http module ----
const http = require("http");

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            const payload = body ? JSON.stringify(body) : null;

            const options = {
                hostname: "127.0.0.1",
                port: port,
                path: path,
                method: method,
                headers: {
                    "Content-Type": "application/json",
                    ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
                }
            };

            const req = http.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    server.close();
                    try {
                        res._body = JSON.parse(data);
                    } catch {
                        res._body = data;
                    }
                    resolve(res);
                });
            });

            req.on("error", (err) => {
                server.close();
                reject(err);
            });

            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    });
}

// ---- Tests ----

async function runTests() {
    console.log("\n=== Testing PATCH /saved/:id/toggle ===\n");

    await testDb.query(`
        CREATE TABLE saved_content (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            platform TEXT NOT NULL DEFAULT 'Unknown',
            checked INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Setup: Insert test item
    const insertRes = await testDb.query(
        "INSERT INTO saved_content (url, platform, checked) VALUES ($1, $2, $3) RETURNING id",
        ["http://test-toggle-1.com", "Unknown", 0]
    );
    const testItemId = insertRes.rows[0].id;

    await test("should toggle checked from false to true", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });
        assertEqual(res.statusCode, 200, "Status should be 200");
        assertEqual(res._body.message, "Checked state updated!");
        assertEqual(res._body.id, testItemId);
        assertEqual(res._body.checked, true);

        const checkRes = await testDb.query("SELECT checked FROM saved_content WHERE id = $1", [testItemId]);
        assertEqual(checkRes.rows[0].checked, 1, "Database should have checked=1");
    });

    await test("should toggle checked from true to false", async () => {
        await testDb.query("UPDATE saved_content SET checked = 1 WHERE id = $1", [testItemId]);

        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: false });
        assertEqual(res.statusCode, 200, "Status should be 200");
        assertEqual(res._body.checked, false);

        const checkRes = await testDb.query("SELECT checked FROM saved_content WHERE id = $1", [testItemId]);
        assertEqual(checkRes.rows[0].checked, 0, "Database should have checked=0");
    });

    await test("should reject invalid ID (non-integer)", async () => {
        const res = await request("PATCH", "/saved/abc/toggle", { checked: true });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "Invalid ID");
    });

    await test("should reject invalid ID (zero)", async () => {
        const res = await request("PATCH", "/saved/0/toggle", { checked: true });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "Invalid ID");
    });

    await test("should reject missing checked field", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, {});
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "checked must be a boolean");
    });

    await test("should reject non-boolean checked value (string)", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: "true" });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "checked must be a boolean");
    });

    await test("should reject non-boolean checked value (number)", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: 1 });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "checked must be a boolean");
    });

    await test("should return 404 for non-existent ID", async () => {
        const res = await request("PATCH", "/saved/999999/toggle", { checked: true });
        assertEqual(res.statusCode, 404, "Status should be 404");
        assertEqual(res._body.error, "Content not found");
    });

    await test("should persist checked state across multiple toggles", async () => {
        await testDb.query("UPDATE saved_content SET checked = 0 WHERE id = $1", [testItemId]);

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });
        let checkRes = await testDb.query("SELECT checked FROM saved_content WHERE id = $1", [testItemId]);
        assertEqual(checkRes.rows[0].checked, 1);

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: false });
        checkRes = await testDb.query("SELECT checked FROM saved_content WHERE id = $1", [testItemId]);
        assertEqual(checkRes.rows[0].checked, 0);

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });
        checkRes = await testDb.query("SELECT checked FROM saved_content WHERE id = $1", [testItemId]);
        assertEqual(checkRes.rows[0].checked, 1);
    });

    await test("should not affect other saved_content rows", async () => {
        const res2 = await testDb.query(
            "INSERT INTO saved_content (url, platform, checked) VALUES ($1, $2, $3) RETURNING id",
            ["http://test-toggle-2.com", "Unknown", 0]
        );
        const secondItemId = res2.rows[0].id;

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });

        const checkRes = await testDb.query("SELECT checked FROM saved_content WHERE id = $1", [secondItemId]);
        assertEqual(checkRes.rows[0].checked, 0, "Other item should remain unchecked");
    });

    // Summary
    console.log(`\n=== Test Summary ===`);
    console.log(`Total: ${testCount}`);
    console.log(`✓ Passed: ${passCount}`);
    console.log(`✗ Failed: ${failCount}`);

    if (failCount === 0) {
        console.log("\n✨ All tests passed!\n");
        process.exit(0);
    } else {
        console.error("\n❌ Some tests failed!\n");
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Fatal error running tests:", err);
    process.exit(1);
});
