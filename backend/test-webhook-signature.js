/**
 * test-webhook-signature.js
 *
 * Focused tests for Meta Instagram webhook endpoints in backend/server.js:
 * 1. Webhook subscription verification (GET /webhook)
 *    - Valid verification token and subscribe mode echoes challenge
 *    - Hardcoded fallback RVAULT_VERIFY_2026 is rejected
 *    - Missing META_WEBHOOK_VERIFY_TOKEN in environment fails closed (403)
 *    - Tokens are never logged to console on failure or success
 * 2. Webhook payload privacy (POST /webhook)
 *    - Full webhook payload JSON is not logged to console
 * 3. Webhook HMAC-SHA256 signature verification (POST /webhook)
 *    - Valid signature accepted
 *    - Invalid signature rejected (403)
 *    - Missing X-Hub-Signature-256 header rejected (403)
 *    - Wrong secret rejected (403)
 *    - Tampered payload rejected (403)
 *    - Invalid JSON rejected after signature verification (400)
 *    - Empty payload with valid signature accepted (200)
 *    - Missing META_APP_SECRET fails with 500
 *
 * All asynchronous operations, servers, and tests are explicitly awaited.
 * Exercises the production implementation in backend/server.js directly.
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const assert = require("assert");
const path = require("path");
const Database = require("better-sqlite3");

// Inject in-memory SQLite database before requiring server so tests never touch production DB
const testDb = new Database(":memory:");
testDb.exec(`
    CREATE TABLE saved_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL DEFAULT 'Unknown',
        checked INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE instagram_shared_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL DEFAULT 'ig_post',
        title TEXT,
        url TEXT,
        original_url TEXT,
        resource_url TEXT,
        resource_platform TEXT,
        sender_id TEXT,
        recipient_id TEXT,
        message_id TEXT,
        cta_type TEXT,
        cta_keyword TEXT,
        action_type TEXT,
        action_input TEXT,
        action_status TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

const dbPath = path.resolve(__dirname, "database.js");
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: testDb,
    parent: null,
    children: []
};

// Set test environment configuration
const TEST_APP_SECRET = "test_meta_app_secret_12345";
const TEST_VERIFY_TOKEN = "test_meta_verify_token_secure_99";
process.env.META_APP_SECRET = TEST_APP_SECRET;
process.env.META_WEBHOOK_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
process.env.ENABLE_META_ACTIONS = "false";

// Import production implementation from server.js
const { app, verifyWebhookSignature } = require("./server");

// Helper to compute valid HMAC-SHA256 signature
function computeSignature(payload, secret) {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    const hash = crypto
        .createHmac("sha256", secret)
        .update(raw)
        .digest("hex");
    return `sha256=${hash}`;
}

// Helper to make HTTP requests
function makeRequest(server, method, path, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const port = server.address().port;
        const bodyStr = body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : null;

        const options = {
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers,
                ...(bodyStr != null ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
            }
        };

        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data ? JSON.parse(data) : null,
                        rawText: data
                    });
                } catch {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: null,
                        rawText: data
                    });
                }
            });
        });

        req.on("error", reject);

        if (bodyStr != null) {
            req.write(bodyStr);
        }

        req.end();
    });
}

// Test runner state
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

async function runTests() {
    console.log("\n=== Meta Webhook Verification & HMAC Tests ===\n");

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    console.log(`Production app listening on ephemeral port ${server.address().port}\n`);

    try {
        // ── Group 1: Subscription Verification (GET /webhook) ───────────────
        console.log("── GET /webhook Verification Handshake ──");

        await test("Valid verify token and subscribe mode echoes challenge with 200", async () => {
            const challenge = "test_challenge_123456";
            const res = await makeRequest(
                server,
                "GET",
                `/webhook?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=${challenge}`
            );
            assert.strictEqual(res.status, 200, "Expected 200 status");
            assert.strictEqual(res.rawText, challenge, "Expected challenge to be echoed back");
        });

        await test("Hardcoded fallback token RVAULT_VERIFY_2026 is rejected (403)", async () => {
            const res = await makeRequest(
                server,
                "GET",
                "/webhook?hub.mode=subscribe&hub.verify_token=RVAULT_VERIFY_2026&hub.challenge=test_challenge"
            );
            assert.strictEqual(res.status, 403, "Expected 403 status for deprecated fallback token");
        });

        await test("Wrong verification token rejected (403)", async () => {
            const res = await makeRequest(
                server,
                "GET",
                "/webhook?hub.mode=subscribe&hub.verify_token=completely_wrong_token&hub.challenge=test_challenge"
            );
            assert.strictEqual(res.status, 403, "Expected 403 status for invalid token");
        });

        await test("Missing verification token rejected (403)", async () => {
            const res = await makeRequest(
                server,
                "GET",
                "/webhook?hub.mode=subscribe&hub.challenge=test_challenge"
            );
            assert.strictEqual(res.status, 403, "Expected 403 status when verify_token is missing");
        });

        await test("Non-subscribe mode rejected (403)", async () => {
            const res = await makeRequest(
                server,
                "GET",
                `/webhook?hub.mode=unsubscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=test_challenge`
            );
            assert.strictEqual(res.status, 403, "Expected 403 status when mode is not subscribe");
        });

        await test("Missing META_WEBHOOK_VERIFY_TOKEN env var fails closed (403)", async () => {
            const originalToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
            delete process.env.META_WEBHOOK_VERIFY_TOKEN;
            try {
                const res = await makeRequest(
                    server,
                    "GET",
                    `/webhook?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=test_challenge`
                );
                assert.strictEqual(res.status, 403, "Expected 403 when verify token is not configured");
            } finally {
                process.env.META_WEBHOOK_VERIFY_TOKEN = originalToken;
            }
        });

        // ── Group 2: Webhook Privacy & Token Leak Prevention ───────────────
        console.log("\n── Webhook Privacy & Token Redaction ──");

        await test("Never log received or expected verification tokens on failure", async () => {
            const secretProbe = "SECRET_PROBE_TOKEN_XYZ_987";
            const originalWarn = console.warn;
            const originalLog = console.log;
            const originalError = console.error;
            let capturedLogs = "";

            const capture = (...args) => {
                capturedLogs += " " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
            };

            console.warn = capture;
            console.log = capture;
            console.error = capture;

            try {
                await makeRequest(
                    server,
                    "GET",
                    `/webhook?hub.mode=subscribe&hub.verify_token=${secretProbe}&hub.challenge=test_challenge`
                );
            } finally {
                console.warn = originalWarn;
                console.log = originalLog;
                console.error = originalError;
            }

            assert(
                !capturedLogs.includes(secretProbe),
                "Received verification token must NOT be logged to console"
            );
            assert(
                !capturedLogs.includes(TEST_VERIFY_TOKEN),
                "Expected verification token must NOT be logged to console"
            );
        });

        await test("Never log full Instagram webhook payload on POST /webhook", async () => {
            const secretMessage = "SUPER_SECRET_PRIVATE_DM_CONTENT_12345";
            const payload = {
                object: "instagram",
                entry: [
                    {
                        id: "ig_account_test",
                        time: Date.now(),
                        messaging: [
                            {
                                sender: { id: "user_secret_id_99" },
                                recipient: { id: "page_secret_id_88" },
                                message: { mid: "mid.test.1", text: secretMessage }
                            }
                        ]
                    }
                ]
            };
            const payloadStr = JSON.stringify(payload);
            const signature = computeSignature(payloadStr, TEST_APP_SECRET);

            const originalLog = console.log;
            let capturedLogs = "";

            console.log = (...args) => {
                capturedLogs += " " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
            };

            try {
                const res = await makeRequest(server, "POST", "/webhook", {
                    headers: { "X-Hub-Signature-256": signature },
                    body: payloadStr
                });
                assert.strictEqual(res.status, 200, "Expected 200 status for valid webhook payload");
            } finally {
                console.log = originalLog;
            }

            assert(
                !capturedLogs.includes(secretMessage),
                "Complete Instagram webhook payload text must NOT be logged to console"
            );
        });

        // ── Group 3: HMAC-SHA256 Signature Verification (POST /webhook) ────
        console.log("\n── POST /webhook HMAC-SHA256 Verification ──");

        await test("Valid X-Hub-Signature-256 accepted (200)", async () => {
            const payload = JSON.stringify({
                object: "instagram",
                entry: [{ id: "test_entry_1" }]
            });
            const validSignature = computeSignature(payload, TEST_APP_SECRET);

            const res = await makeRequest(server, "POST", "/webhook", {
                headers: { "X-Hub-Signature-256": validSignature },
                body: payload
            });

            assert.strictEqual(res.status, 200, "Expected 200 for valid signature");
        });

        await test("Invalid signature rejected (403)", async () => {
            const payload = JSON.stringify({
                object: "instagram",
                entry: []
            });
            // Same format (sha256= + 64 hex chars) but invalid hash
            const invalidSignature = "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

            const res = await makeRequest(server, "POST", "/webhook", {
                headers: { "X-Hub-Signature-256": invalidSignature },
                body: payload
            });

            assert.strictEqual(res.status, 403, "Expected 403 for invalid signature");
            assert.strictEqual(res.body?.error, "Invalid signature");
        });

        await test("Missing X-Hub-Signature-256 header rejected (403)", async () => {
            const payload = JSON.stringify({
                object: "instagram",
                entry: []
            });

            const res = await makeRequest(server, "POST", "/webhook", {
                body: payload
            });

            assert.strictEqual(res.status, 403, "Expected 403 for missing signature");
            assert.strictEqual(res.body?.error, "Missing signature header");
        });

        await test("Signature computed with wrong secret rejected (403)", async () => {
            const payload = JSON.stringify({
                object: "instagram",
                entry: []
            });
            const wrongSignature = computeSignature(payload, "completely_wrong_secret");

            const res = await makeRequest(server, "POST", "/webhook", {
                headers: { "X-Hub-Signature-256": wrongSignature },
                body: payload
            });

            assert.strictEqual(res.status, 403, "Expected 403 for signature with wrong secret");
            assert.strictEqual(res.body?.error, "Invalid signature");
        });

        await test("Tampered payload with original signature rejected (403)", async () => {
            const originalPayload = JSON.stringify({ object: "instagram", id: 1 });
            const validSignature = computeSignature(originalPayload, TEST_APP_SECRET);

            const tamperedPayload = JSON.stringify({ object: "instagram", id: 2 });

            const res = await makeRequest(server, "POST", "/webhook", {
                headers: { "X-Hub-Signature-256": validSignature },
                body: tamperedPayload
            });

            assert.strictEqual(res.status, 403, "Expected 403 for tampered payload");
            assert.strictEqual(res.body?.error, "Invalid signature");
        });

        await test("Invalid JSON payload with valid signature rejected after verification (400)", async () => {
            const invalidJson = "{ malformed: json, missing quotes }";
            const validSignature = computeSignature(invalidJson, TEST_APP_SECRET);

            const res = await makeRequest(server, "POST", "/webhook", {
                headers: { "X-Hub-Signature-256": validSignature },
                body: invalidJson
            });

            assert.strictEqual(res.status, 400, "Expected 400 for invalid JSON");
            assert.strictEqual(res.body?.error, "Invalid JSON payload");
        });

        await test("Empty payload with valid signature accepted (200)", async () => {
            const payload = JSON.stringify({});
            const validSignature = computeSignature(payload, TEST_APP_SECRET);

            const res = await makeRequest(server, "POST", "/webhook", {
                headers: { "X-Hub-Signature-256": validSignature },
                body: payload
            });

            assert.strictEqual(res.status, 200, "Expected 200 for valid empty payload");
        });

        await test("Mismatched signature length handled safely without timingSafeEqual crash (403)", async () => {
            const payload = JSON.stringify({ object: "instagram" });
            const shortSignature = "sha256=short";

            const res = await makeRequest(server, "POST", "/webhook", {
                headers: { "X-Hub-Signature-256": shortSignature },
                body: payload
            });

            assert.strictEqual(res.status, 403, "Expected 403 for short signature");
            assert.strictEqual(res.body?.error, "Invalid signature");
        });

        await test("Missing META_APP_SECRET in environment fails with 500", async () => {
            const originalSecret = process.env.META_APP_SECRET;
            delete process.env.META_APP_SECRET;

            try {
                const payload = JSON.stringify({ object: "instagram" });
                const signature = computeSignature(payload, TEST_APP_SECRET);

                const res = await makeRequest(server, "POST", "/webhook", {
                    headers: { "X-Hub-Signature-256": signature },
                    body: payload
                });

                assert.strictEqual(res.status, 500, "Expected 500 when META_APP_SECRET is missing");
                assert.strictEqual(
                    res.body?.error,
                    "Webhook signature verification is not configured"
                );
            } finally {
                process.env.META_APP_SECRET = originalSecret;
            }
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Webhook tests completed`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${passed + failed}`);
    console.log("=".repeat(50));

    if (failed > 0) {
        console.error("\nFailed tests:");
        failures.forEach((f) => console.error(`  ✗ ${f.name}: ${f.message}`));
        return false;
    }

    return true;
}

runTests()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((err) => {
        console.error("Fatal test runner error:", err);
        process.exit(1);
    });
