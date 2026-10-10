/**
 * test-auth-middleware.js
 *
 * Tests for the requireApiKey Bearer-token authentication middleware added to
 * server.js.  Spins up a minimal Express app that replicates the production
 * middleware stack (CORS → body parser → requireApiKey) and verifies:
 *
 *   - Requests without an Authorization header → 401
 *   - Requests with a wrong token              → 401
 *   - Requests with the correct token          → pass-through (200 / route logic)
 *   - GET  /          (health check)           → always allowed (no token needed)
 *   - GET  /webhook   (Meta handshake)         → always allowed (no token needed)
 *   - POST /webhook   (Meta delivery)          → always allowed (protected by HMAC instead)
 *   - Missing API_SECRET on server             → 503 (fail loudly, not silently open)
 *
 * Uses in-memory SQLite so it never touches production data.
 *
 * Run: node backend/test-auth-middleware.js
 */

"use strict";

const http     = require("http");
const crypto   = require("crypto");
const express  = require("express");
const cors     = require("cors");
const Database = require("better-sqlite3");

// ---------------------------------------------------------------------------
// In-memory DB (mirrors the minimal schema needed by content routes)
// ---------------------------------------------------------------------------
const testDb = new Database(":memory:");
testDb.exec(`
    CREATE TABLE saved_content (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        url      TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL DEFAULT 'Unknown',
        checked  INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE instagram_shared_posts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id    TEXT NOT NULL UNIQUE,
        media_type  TEXT NOT NULL DEFAULT 'ig_post',
        title       TEXT,
        url         TEXT,
        original_url TEXT,
        resource_url TEXT,
        resource_platform TEXT,
        sender_id   TEXT,
        recipient_id TEXT,
        message_id  TEXT,
        cta_type    TEXT,
        cta_keyword TEXT,
        action_type TEXT,
        action_input TEXT,
        action_status TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Inject testDb so content routes and server pick it up
const dbPath = require("path").resolve(__dirname, "database.js");
require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: testDb, parent: null, children: []
};

const { requireApiKey } = require("./server");
const contentRouter = require("./routes/content");

// ---------------------------------------------------------------------------
// Factory: build an Express app with the production requireApiKey logic.
// Pass apiSecret=null to simulate a misconfigured server.
// ---------------------------------------------------------------------------
function buildApp(apiSecret) {
    const app = express();

    app.use(cors());

    // Same body-parser split as production
    app.use((req, res, next) => {
        if (req.path === "/webhook" && req.method === "POST") {
            express.raw({ type: "application/json" })(req, res, next);
        } else {
            express.json()(req, res, next);
        }
    });

    // Mount production requireApiKey with dynamic API_SECRET configuration
    app.use((req, res, next) => {
        const origSecret = process.env.API_SECRET;
        if (apiSecret === null) {
            delete process.env.API_SECRET;
        } else {
            process.env.API_SECRET = apiSecret;
        }
        try {
            return requireApiKey(req, res, next);
        } finally {
            if (origSecret !== undefined) {
                process.env.API_SECRET = origSecret;
            } else {
                delete process.env.API_SECRET;
            }
        }
    });

    // Minimal route stubs that mirror the real server
    app.get("/", (_req, res) => res.send("RVAULT is running!"));
    app.post("/", (_req, res) => res.status(200).json({ message: "root POST ok" }));
    app.delete("/", (_req, res) => res.status(200).json({ message: "root DELETE ok" }));

    app.get("/webhook", (req, res) => {
        if (req.query["hub.mode"] === "subscribe") {
            return res.status(200).send(req.query["hub.challenge"] || "ok");
        }
        res.sendStatus(403);
    });

    app.post("/webhook", (req, res) =>
        res.status(200).json({ message: "webhook received" })
    );

    app.delete("/webhook", (_req, res) =>
        res.status(200).json({ message: "webhook DELETE ok" })
    );

    app.put("/webhook", (_req, res) =>
        res.status(200).json({ message: "webhook PUT ok" })
    );

    // The real GET /saved lives in server.js; replicate minimally
    app.get("/saved", (_req, res) => {
        const rows = testDb.prepare(
            "SELECT id, url, platform, checked, created_at FROM saved_content ORDER BY id DESC"
        ).all();
        res.json(rows);
    });

    app.get("/instagram/shared-posts", (_req, res) => {
        const rows = testDb.prepare(
            "SELECT id, media_id FROM instagram_shared_posts ORDER BY id DESC"
        ).all();
        res.json(rows);
    });

    app.delete("/instagram/shared-posts/:id", (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid ID" });
        const result = testDb.prepare("DELETE FROM instagram_shared_posts WHERE id = ?").run(id);
        if (result.changes === 0) return res.status(404).json({ error: "Not found" });
        res.json({ message: "deleted", id });
    });

    app.use("/", contentRouter);

    return app;
}

// ---------------------------------------------------------------------------
// HTTP test helper
// ---------------------------------------------------------------------------
function makeRequest(server, method, path, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const port = server.address().port;
        const bodyStr = body != null ? JSON.stringify(body) : null;

        const opts = {
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers,
                ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
            }
        };

        const req = http.request(opts, (res) => {
            let data = "";
            res.on("data", c => { data += c; });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on("error", reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
const TEST_SECRET = "super_secret_token_for_testing_only";

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    try {
        await fn();
        console.log("  ✓", name);
        passed++;
    } catch (err) {
        console.error("  ✗", name);
        console.error("    →", err.message);
        failed++;
        failures.push({ name, message: err.message });
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label || "assertEqual"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

async function runAll() {
    console.log("\n=== RVAULT Auth Middleware Tests ===\n");

    // ── Group 1: Exempt routes (no token needed) ─────────────────────────
    console.log("── Exempt routes (no Authorization required) ──");
    {
        const app = buildApp(TEST_SECRET);
        const server = app.listen(0, "127.0.0.1");
        await new Promise(r => server.once("listening", r));

        await test("GET / returns 200 without token", async () => {
            const r = await makeRequest(server, "GET", "/");
            assertEqual(r.status, 200, "status");
        });

        await test("GET /webhook (subscribe mode) returns 200 without token", async () => {
            const r = await makeRequest(server, "GET", "/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=x");
            assertEqual(r.status, 200, "status");
            assert(r.body === "abc" || r.body?.toString() === "abc", "challenge echoed");
        });

        await test("POST /webhook returns 200 without token (HMAC-protected separately)", async () => {
            const r = await makeRequest(server, "POST", "/webhook", {
                body: { object: "instagram", entry: [] }
            });
            assertEqual(r.status, 200, "status");
        });

        await new Promise(r => server.close(r));
    }

    // ── Group 2: Missing token ───────────────────────────────────────────
    console.log("\n── Missing Authorization header → 401 ──");
    {
        const app = buildApp(TEST_SECRET);
        const server = app.listen(0, "127.0.0.1");
        await new Promise(r => server.once("listening", r));

        const protectedRoutes = [
            ["POST",   "/"],
            ["DELETE", "/"],
            ["DELETE", "/webhook"],
            ["PUT",    "/webhook"],
            ["GET",    "/saved"],
            ["POST",   "/save"],
            ["DELETE", "/saved/1"],
            ["PATCH",  "/saved/1/toggle"],
            ["GET",    "/instagram/shared-posts"],
            ["DELETE", "/instagram/shared-posts/1"],
        ];

        for (const [method, path] of protectedRoutes) {
            await test(`${method} ${path} → 401 without token`, async () => {
                const r = await makeRequest(server, method, path, {
                    body: method === "POST" ? { url: "https://example.com" }
                        : method === "PATCH" ? { checked: true }
                        : null
                });
                assertEqual(r.status, 401, "status");
                assertEqual(r.body?.error, "Unauthorized", "error message");
            });
        }

        await new Promise(r => server.close(r));
    }

    // ── Group 3: Wrong token ─────────────────────────────────────────────
    console.log("\n── Invalid token → 401 ──");
    {
        const app = buildApp(TEST_SECRET);
        const server = app.listen(0, "127.0.0.1");
        await new Promise(r => server.once("listening", r));

        await test("GET /saved with wrong token → 401", async () => {
            const r = await makeRequest(server, "GET", "/saved", {
                headers: { Authorization: "Bearer wrong_token" }
            });
            assertEqual(r.status, 401, "status");
        });

        await test("GET /saved with malformed header (no Bearer prefix) → 401", async () => {
            const r = await makeRequest(server, "GET", "/saved", {
                headers: { Authorization: TEST_SECRET }  // missing 'Bearer ' prefix
            });
            assertEqual(r.status, 401, "status");
        });

        await test("GET /saved with empty Bearer token → 401", async () => {
            const r = await makeRequest(server, "GET", "/saved", {
                headers: { Authorization: "Bearer " }
            });
            assertEqual(r.status, 401, "status");
        });

        await test("GET /saved with near-match token (extra char) → 401", async () => {
            const r = await makeRequest(server, "GET", "/saved", {
                headers: { Authorization: `Bearer ${TEST_SECRET}x` }
            });
            assertEqual(r.status, 401, "status");
        });

        await new Promise(r => server.close(r));
    }

    // ── Group 4: Valid token ─────────────────────────────────────────────
    console.log("\n── Valid token → route allowed ──");
    {
        const app = buildApp(TEST_SECRET);
        const server = app.listen(0, "127.0.0.1");
        await new Promise(r => server.once("listening", r));

        const authHeader = { Authorization: `Bearer ${TEST_SECRET}` };

        await test("POST / with correct token → 200", async () => {
            const r = await makeRequest(server, "POST", "/", { headers: authHeader });
            assertEqual(r.status, 200, "status");
        });

        await test("DELETE /webhook with correct token → 200", async () => {
            const r = await makeRequest(server, "DELETE", "/webhook", { headers: authHeader });
            assertEqual(r.status, 200, "status");
        });

        await test("GET /saved with correct token → 200", async () => {
            const r = await makeRequest(server, "GET", "/saved", { headers: authHeader });
            assertEqual(r.status, 200, "status");
            assert(Array.isArray(r.body), "response is array");
        });

        await test("POST /save with correct token → 200 or 409", async () => {
            const r = await makeRequest(server, "POST", "/save", {
                headers: authHeader,
                body: { url: "https://www.youtube.com/watch?v=auth-test-1" }
            });
            assert(r.status === 200 || r.status === 409, `Expected 200 or 409, got ${r.status}`);
        });

        await test("GET /instagram/shared-posts with correct token → 200", async () => {
            const r = await makeRequest(server, "GET", "/instagram/shared-posts", { headers: authHeader });
            assertEqual(r.status, 200, "status");
        });

        await test("DELETE /saved/:id with correct token on missing ID → 404 (not 401)", async () => {
            const r = await makeRequest(server, "DELETE", "/saved/999999", { headers: authHeader });
            assertEqual(r.status, 404, "status");
        });

        await test("PATCH /saved/:id/toggle with correct token, invalid body → 400 (not 401)", async () => {
            const r = await makeRequest(server, "PATCH", "/saved/1/toggle", {
                headers: authHeader,
                body: {}  // missing checked field → router returns 400
            });
            assertEqual(r.status, 400, "status");
        });

        await new Promise(r => server.close(r));
    }

    // ── Group 5: Missing API_SECRET on server ────────────────────────────
    console.log("\n── Missing API_SECRET → 503 on all protected routes ──");
    {
        const app = buildApp(null);   // null = no secret configured
        const server = app.listen(0, "127.0.0.1");
        await new Promise(r => server.once("listening", r));

        await test("GET /saved → 503 when API_SECRET is not set", async () => {
            const r = await makeRequest(server, "GET", "/saved");
            assertEqual(r.status, 503, "status");
        });

        await test("POST / → 503 when API_SECRET is not set", async () => {
            const r = await makeRequest(server, "POST", "/");
            assertEqual(r.status, 503, "status");
        });

        await test("GET /  → still 200 even when API_SECRET missing (exempt)", async () => {
            const r = await makeRequest(server, "GET", "/");
            assertEqual(r.status, 200, "status");
        });

        await test("POST /webhook → still 200 when API_SECRET missing (exempt)", async () => {
            const r = await makeRequest(server, "POST", "/webhook", {
                body: {}
            });
            assertEqual(r.status, 200, "status");
        });

        await new Promise(r => server.close(r));
    }

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Auth middleware tests completed`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${passed + failed}`);
    console.log("=".repeat(50));

    if (failed > 0) {
        console.error("\nFailed tests:");
        failures.forEach(f => console.error(`  ✗ ${f.name}: ${f.message}`));
        process.exit(1);
    }

    process.exit(0);
}

runAll().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
