/**
 * test-toggle-checked.js
 *
 * Tests for the PATCH /saved/:id/toggle endpoint
 * that updates the checked state of saved content items.
 *
 * Uses an in-memory SQLite DB so it never touches production data.
 *
 * Run: node backend/test-toggle-checked.js
 */

const express = require("express");
const Database = require("better-sqlite3");

// ---- Minimal in-memory DB setup ----
const testDb = new Database(":memory:");

testDb.exec(`
    CREATE TABLE saved_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL DEFAULT 'Unknown',
        checked INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// ---- Mock database module ----
const dbMock = testDb;

// Clear require cache and replace the database module
delete require.cache[require.resolve("./database")];
require.cache[require.resolve("./database")] = {
    exports: dbMock,
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

function test(description, fn) {
    testCount++;
    try {
        fn();
        passCount++;
        console.log(`✓ ${description}`);
    } catch (error) {
        failCount++;
        console.error(`✗ ${description}`);
        console.error(`  ${error.message}`);
        if (error.stack) {
            console.error(error.stack.split("\n").slice(1, 3).join("\n"));
        }
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(
            message || `Expected ${expected}, got ${actual}`
        );
    }
}

async function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const req = {
            method,
            url: path,
            body,
            headers: { "content-type": "application/json" }
        };

        const res = {
            statusCode: 200,
            _body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(data) {
                this._body = data;
                resolve(this);
            },
            sendStatus(code) {
                this.statusCode = code;
                this._body = null;
                resolve(this);
            }
        };

        // Find matching route
        const pathMatch = path.match(/^\/saved\/(\d+|[a-z]+)\/toggle$/);
        if (pathMatch && method === "PATCH") {
            req.params = { id: pathMatch[1] };
            const handler = contentRouter.stack.find(
                layer => layer.route?.path === "/saved/:id/toggle" && layer.route.methods.patch
            );
            if (handler) {
                handler.route.stack[0].handle(req, res);
            } else {
                res.status(404).json({ error: "Route not found" });
            }
        } else {
            res.status(404).json({ error: "Route not found" });
        }
    });
}

// ---- Tests ----

async function runTests() {
    console.log("\n=== Testing PATCH /saved/:id/toggle ===\n");

    // Setup: Insert test item
    const result = testDb.prepare(
        "INSERT INTO saved_content (url, platform, checked) VALUES (?, ?, ?)"
    ).run("http://test-toggle-1.com", "Unknown", 0);
    const testItemId = result.lastInsertRowid;

    test("should toggle checked from false to true", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });
        assertEqual(res.statusCode, 200, "Status should be 200");
        assertEqual(res._body.message, "Checked state updated!");
        assertEqual(res._body.id, testItemId);
        assertEqual(res._body.checked, true);

        const row = testDb.prepare("SELECT checked FROM saved_content WHERE id = ?").get(testItemId);
        assertEqual(row.checked, 1, "Database should have checked=1");
    });

    test("should toggle checked from true to false", async () => {
        testDb.prepare("UPDATE saved_content SET checked = 1 WHERE id = ?").run(testItemId);

        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: false });
        assertEqual(res.statusCode, 200, "Status should be 200");
        assertEqual(res._body.checked, false);

        const row = testDb.prepare("SELECT checked FROM saved_content WHERE id = ?").get(testItemId);
        assertEqual(row.checked, 0, "Database should have checked=0");
    });

    test("should reject invalid ID (non-integer)", async () => {
        const res = await request("PATCH", "/saved/abc/toggle", { checked: true });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "Invalid ID");
    });

    test("should reject invalid ID (zero)", async () => {
        const res = await request("PATCH", "/saved/0/toggle", { checked: true });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "Invalid ID");
    });

    test("should reject missing checked field", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, {});
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "checked must be a boolean");
    });

    test("should reject non-boolean checked value (string)", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: "true" });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "checked must be a boolean");
    });

    test("should reject non-boolean checked value (number)", async () => {
        const res = await request("PATCH", `/saved/${testItemId}/toggle`, { checked: 1 });
        assertEqual(res.statusCode, 400, "Status should be 400");
        assertEqual(res._body.error, "checked must be a boolean");
    });

    test("should return 404 for non-existent ID", async () => {
        const res = await request("PATCH", "/saved/999999/toggle", { checked: true });
        assertEqual(res.statusCode, 404, "Status should be 404");
        assertEqual(res._body.error, "Content not found");
    });

    test("should persist checked state across multiple toggles", async () => {
        testDb.prepare("UPDATE saved_content SET checked = 0 WHERE id = ?").run(testItemId);

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });
        let row = testDb.prepare("SELECT checked FROM saved_content WHERE id = ?").get(testItemId);
        assertEqual(row.checked, 1);

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: false });
        row = testDb.prepare("SELECT checked FROM saved_content WHERE id = ?").get(testItemId);
        assertEqual(row.checked, 0);

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });
        row = testDb.prepare("SELECT checked FROM saved_content WHERE id = ?").get(testItemId);
        assertEqual(row.checked, 1);
    });

    test("should not affect other saved_content rows", async () => {
        const result2 = testDb.prepare(
            "INSERT INTO saved_content (url, platform, checked) VALUES (?, ?, ?)"
        ).run("http://test-toggle-2.com", "Unknown", 0);
        const secondItemId = result2.lastInsertRowid;

        await request("PATCH", `/saved/${testItemId}/toggle`, { checked: true });

        const row = testDb.prepare("SELECT checked FROM saved_content WHERE id = ?").get(secondItemId);
        assertEqual(row.checked, 0, "Other item should remain unchecked");
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
