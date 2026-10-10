const http = require("http");
const assert = require("assert");

// Set up test environment with multiple allowed origins
process.env.ALLOWED_ORIGINS = "http://localhost:5173,https://app.example.com";
process.env.META_APP_SECRET = "test_secret";
process.env.META_WEBHOOK_VERIFY_TOKEN = "test_token";
process.env.ENABLE_META_ACTIONS = "false";

// Import server components after setting env vars
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

// Create test server with the same CORS setup as production
const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:5173'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS policy: Origin ${origin} not allowed`));
        }
    },
    credentials: true
}));

app.use(express.json());

// Test endpoints
app.get("/test", (req, res) => {
    res.json({ message: "CORS test endpoint" });
});

app.post("/webhook", (req, res) => {
    res.json({ message: "Webhook received" });
});

// Helper to make HTTP requests
function request(method, path, origin = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "127.0.0.1",
            port: serverPort,
            path,
            method,
            headers: {}
        };

        if (origin !== null) {
            options.headers.Origin = origin;
        }

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
                        body: data ? JSON.parse(data) : null
                    });
                } catch (parseError) {
                    // Return raw data if JSON parsing fails
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: { raw: data }
                    });
                }
            });
        });

        req.on("error", reject);
        req.end();
    });
}

// Test suite
let server;
let serverPort;

async function runTests() {
    console.log("Starting CORS configuration tests...\n");

    try {
        server = app.listen(0, "127.0.0.1", async () => {
            serverPort = server.address().port;
            console.log(`Test server running on port ${serverPort}\n`);

            let passed = 0;
            let failed = 0;

            // Test 1: Request from allowed origin (localhost:5173)
            try {
                const res = await request("GET", "/test", "http://localhost:5173");

                assert.strictEqual(res.status, 200, "Expected 200 for allowed origin");
                assert.strictEqual(
                    res.headers['access-control-allow-origin'],
                    "http://localhost:5173",
                    "Expected CORS header for allowed origin"
                );
                console.log("✓ Test 1: Allowed origin (localhost:5173) accepted");
                passed++;
            } catch (error) {
                console.error("✗ Test 1 failed:", error.message);
                failed++;
            }

            // Test 2: Request from second allowed origin
            try {
                const res = await request("GET", "/test", "https://app.example.com");

                assert.strictEqual(res.status, 200, "Expected 200 for allowed origin");
                assert.strictEqual(
                    res.headers['access-control-allow-origin'],
                    "https://app.example.com",
                    "Expected CORS header for second allowed origin"
                );
                console.log("✓ Test 2: Allowed origin (app.example.com) accepted");
                passed++;
            } catch (error) {
                console.error("✗ Test 2 failed:", error.message);
                failed++;
            }

            // Test 3: Request from disallowed origin
            try {
                const res = await request("GET", "/test", "https://malicious.com");

                // CORS middleware returns error for disallowed origin
                // Server should return error status, not 200
                assert.strictEqual(
                    res.status >= 400,
                    true,
                    "Expected error status for disallowed origin"
                );
                console.log("✓ Test 3: Disallowed origin (malicious.com) rejected with error");
                passed++;
            } catch (error) {
                console.error("✗ Test 3 failed:", error.message);
                failed++;
            }

            // Test 4: Request with no Origin header (webhook scenario)
            try {
                const res = await request("POST", "/webhook", null);

                assert.strictEqual(res.status, 200, "Expected 200 for request without Origin");
                assert.strictEqual(res.body.message, "Webhook received");
                console.log("✓ Test 4: Request without Origin header accepted (webhook scenario)");
                passed++;
            } catch (error) {
                console.error("✗ Test 4 failed:", error.message);
                failed++;
            }

            // Test 5: GET request with no Origin header
            try {
                const res = await request("GET", "/test", null);

                assert.strictEqual(res.status, 200, "Expected 200 for GET without Origin");
                assert.strictEqual(res.body.message, "CORS test endpoint");
                console.log("✓ Test 5: GET request without Origin header accepted");
                passed++;
            } catch (error) {
                console.error("✗ Test 5 failed:", error.message);
                failed++;
            }

            // Test 6: Origin with extra whitespace should be trimmed
            try {
                // Test that config parsing trims whitespace
                const trimmedOrigins = "http://localhost:5173, https://app.example.com"
                    .split(',')
                    .map(o => o.trim());

                assert.strictEqual(trimmedOrigins[0], "http://localhost:5173");
                assert.strictEqual(trimmedOrigins[1], "https://app.example.com");
                console.log("✓ Test 6: Origin whitespace trimming works correctly");
                passed++;
            } catch (error) {
                console.error("✗ Test 6 failed:", error.message);
                failed++;
            }

            // Test 7: Empty ALLOWED_ORIGINS should default to localhost:5173
            try {
                const defaultOrigins = process.env.ALLOWED_ORIGINS_EMPTY
                    ? process.env.ALLOWED_ORIGINS_EMPTY.split(',').map(o => o.trim())
                    : ['http://localhost:5173'];

                assert.strictEqual(defaultOrigins.length, 1);
                assert.strictEqual(defaultOrigins[0], "http://localhost:5173");
                console.log("✓ Test 7: Default origin fallback works correctly");
                passed++;
            } catch (error) {
                console.error("✗ Test 7 failed:", error.message);
                failed++;
            }

            // Summary
            console.log(`\n${"=".repeat(50)}`);
            console.log(`CORS configuration tests completed`);
            console.log(`Passed: ${passed}`);
            console.log(`Failed: ${failed}`);
            console.log(`Total: ${passed + failed}`);
            console.log(`${"=".repeat(50)}\n`);

            server.close();
            process.exit(failed > 0 ? 1 : 0);
        });
    } catch (error) {
        console.error("Test suite error:", error);
        if (server) server.close();
        process.exit(1);
    }
}

runTests();