/**
 * test-content-router.js
 *
 * Integration tests for routes/content.js:
 *   - GET /saved is NOT served by the router (only by server.js)
 *   - POST /save correctly detects platform and inserts a row
 *   - DELETE /saved/:id correctly removes a row
 *   - DELETE /saved/:id with invalid ID returns 400
 *   - DELETE /saved/:id with non-existent ID returns 404
 *   - detectPlatform in content.js now uses the shared utility (spot check)
 *
 * Uses an in-memory PostgreSQL DB via pg-mem so it tests real PostgreSQL behavior.
 *
 * Run: node backend/test-content-router.js
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

// ---- Inject the test DB into the module system ----
const dbModulePath = path.resolve(__dirname, "database.js");
require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: testDb,
    parent: null,
    children: []
};

// Now load the router (it will get testDb from the patched cache)
const contentRouter = require("./routes/content");

// ---- Minimal Express app ----
const app = express();
app.use(express.json());
app.use("/", contentRouter);

// ---- Simple HTTP test harness (no supertest dependency) ----
const http = require("http");
const server = http.createServer(app);

function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            const bodyStr = body ? JSON.stringify(body) : null;

            const options = {
                hostname: "127.0.0.1",
                port,
                path: urlPath,
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
                }
            };

            const req = http.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    server.close();
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            });

            req.on("error", (err) => { server.close(); reject(err); });
            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    });
}

// ---- Tests ----
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// 1. POST /save inserts a URL with correct platform detection
test("POST /save - saves YouTube URL with correct platform", async () => {
    const res = await request("POST", "/save", { url: "https://www.youtube.com/watch?v=test123" });
    if (res.status !== 200) throw new Error("Expected 200, got " + res.status + " body: " + JSON.stringify(res.body));
    if (res.body.platform !== "YouTube") throw new Error("Expected platform YouTube, got " + res.body.platform);
    if (!res.body.id) throw new Error("Expected an id in response");
});

// 2. POST /save inserts an Instagram URL
test("POST /save - saves Instagram URL with correct platform", async () => {
    const res = await request("POST", "/save", { url: "https://www.instagram.com/reel/TEST123/" });
    if (res.status !== 200) throw new Error("Expected 200, got " + res.status);
    if (res.body.platform !== "Instagram") throw new Error("Expected Instagram, got " + res.body.platform);
});

// 3. POST /save returns 409 for duplicate URL
test("POST /save - returns 409 for duplicate URL", async () => {
    const res = await request("POST", "/save", { url: "https://www.youtube.com/watch?v=test123" });
    if (res.status !== 409) throw new Error("Expected 409 for duplicate, got " + res.status);
});

// 4. POST /save returns 400 when URL is missing
test("POST /save - returns 400 when URL is missing", async () => {
    const res = await request("POST", "/save", {});
    if (res.status !== 400) throw new Error("Expected 400, got " + res.status);
});

// 5. POST /save saves Unknown platform for unrecognised domain
test("POST /save - saves Unknown platform for unrecognised domain", async () => {
    const res = await request("POST", "/save", { url: "https://notion.so/my-page" });
    if (res.status !== 200) throw new Error("Expected 200, got " + res.status);
    if (res.body.platform !== "Unknown") throw new Error("Expected Unknown, got " + res.body.platform);
});

// 6. DELETE /saved/:id - deletes an existing row
test("DELETE /saved/:id - deletes an existing row", async () => {
    // Insert a fresh row directly
    const insertResult = await testDb.query(
        "INSERT INTO saved_content (url, platform) VALUES ($1, $2) RETURNING id",
        ["https://www.tiktok.com/@user/video/to-delete", "TikTok"]
    );

    const id = insertResult.rows[0].id;
    const res = await request("DELETE", "/saved/" + id, null);
    if (res.status !== 200) throw new Error("Expected 200, got " + res.status + " body: " + JSON.stringify(res.body));

    // Verify it's gone from the DB
    const check = await testDb.query("SELECT id FROM saved_content WHERE id = $1", [id]);
    if (check.rows.length > 0) throw new Error("Row was not deleted from DB");
});

// 7. DELETE /saved/:id - returns 404 for non-existent ID
test("DELETE /saved/:id - returns 404 for non-existent ID", async () => {
    const res = await request("DELETE", "/saved/999999", null);
    if (res.status !== 404) throw new Error("Expected 404, got " + res.status);
});

// 8. DELETE /saved/:id - returns 400 for invalid (non-integer) ID
test("DELETE /saved/:id - returns 400 for non-integer ID", async () => {
    const res = await request("DELETE", "/saved/abc", null);
    if (res.status !== 400) throw new Error("Expected 400, got " + res.status);
});

// 9. DELETE /saved/:id - returns 400 for zero ID
test("DELETE /saved/:id - returns 400 for zero ID", async () => {
    const res = await request("DELETE", "/saved/0", null);
    if (res.status !== 400) throw new Error("Expected 400, got " + res.status);
});

// 10. GET /saved from the router should NOT be the primary handler
//     (it returns 404 from the router stub — server.js owns the real route)
test("GET /saved via router stub returns 404 (server.js owns the real route)", async () => {
    const res = await request("GET", "/saved", null);
    // The router's stub returns 404 intentionally
    if (res.status !== 404) throw new Error("Expected 404 from router stub, got " + res.status);
});

// ---- Run ----
let failed = 0;

async function runAll() {
    await testDb.query(`
        CREATE TABLE IF NOT EXISTS saved_content (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            platform TEXT NOT NULL DEFAULT 'Unknown',
            checked INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS instagram_shared_posts (
            id SERIAL PRIMARY KEY,
            media_id TEXT NOT NULL UNIQUE,
            media_type TEXT NOT NULL DEFAULT 'ig_post',
            title TEXT,
            url TEXT,
            original_url TEXT,
            resource_url TEXT,
            sender_id TEXT,
            recipient_id TEXT,
            message_id TEXT,
            cta_type TEXT,
            cta_keyword TEXT,
            action_type TEXT,
            action_input TEXT,
            action_status TEXT,
            received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log("PASS:", name);
        } catch (err) {
            failed++;
            console.error("FAIL:", name);
            console.error(" ", err.message);
        }
    }

    console.log(`\n${tests.length - failed}/${tests.length} content router tests passed.`);

    if (failed > 0) {
        console.error(failed + " test(s) failed.");
        process.exit(1);
    }
}

runAll();
