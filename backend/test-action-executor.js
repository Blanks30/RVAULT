/**
 * test-action-executor.js
 *
 * Unit tests for backend/actionExecutor.js.
 * Tests DM execution (new), COMMENT execution (existing), checkActionSupport,
 * dry-run mode, missing credentials, and error paths.
 *
 * Uses mock fetch + env overrides — never calls the real Meta API.
 *
 * Run: node backend/test-action-executor.js
 */

const path = require("path");

// ── Helpers ───────────────────────────────────────────────────────────────────

let failed = 0;

function pass(name) { console.log("PASS:", name); }
function fail(name, reason) {
    failed++;
    console.error("FAIL:", name);
    console.error("     ", reason);
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg);
}

// ── Mock fetch ────────────────────────────────────────────────────────────────

let mockFetchResponse = null;

global.fetch = async (url, opts) => {
    if (!mockFetchResponse) throw new Error("fetch called but no mock set");
    const { status, body } = mockFetchResponse;
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
};

function setMockFetch(status, body) {
    mockFetchResponse = { status, body };
}

// ── Reload actionExecutor fresh with env overrides ────────────────────────────
// IMPORTANT: actionExecutor.js calls dotenv.config() at module load time,
// which re-reads the real .env file. We must set our overrides AFTER requiring
// the module so they win over whatever dotenv injected.

function loadExecutor(envOverrides = {}) {
    // 1. Clear from cache so the module re-runs its top-level code
    const key = path.resolve(__dirname, "actionExecutor.js");
    delete require.cache[key];

    // 2. Load it — this runs dotenv.config() which reads the real .env
    const mod = require("./actionExecutor");

    // 3. NOW apply our overrides (they win over the dotenv values)
    const saved = {};
    for (const [k, v] of Object.entries(envOverrides)) {
        saved[k] = process.env[k];
        process.env[k] = v;
    }

    // 4. Return a wrapper that restores env after each function call
    //    so tests don't bleed into each other
    const restore = () => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };

    return { mod, restore };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ─ checkActionSupport ─────────────────────────────────────────────────────────

test("checkActionSupport: NONE is supported", async () => {
    const { mod, restore } = loadExecutor();
    try {
        const r = mod.checkActionSupport("NONE");
        assert(r.supported === true, "NONE should be supported");
        assert(r.requiresMetaExecution === false, "NONE should not require meta");
    } finally { restore(); }
});

test("checkActionSupport: COMMENT is supported and requires meta", async () => {
    const { mod, restore } = loadExecutor();
    try {
        const r = mod.checkActionSupport("COMMENT");
        assert(r.supported === true, "COMMENT should be supported");
        assert(r.requiresMetaExecution === true, "COMMENT requires meta");
    } finally { restore(); }
});

test("checkActionSupport: DM is now supported", async () => {
    const { mod, restore } = loadExecutor();
    try {
        const r = mod.checkActionSupport("DM");
        assert(r.supported === true, "DM should be supported");
        assert(r.requiresMetaExecution === true, "DM requires meta");
    } finally { restore(); }
});

test("checkActionSupport: unknown action is not supported", async () => {
    const { mod, restore } = loadExecutor();
    try {
        const r = mod.checkActionSupport("FOLLOW_AND_DM");
        assert(r.supported === false, "FOLLOW_AND_DM should not be supported");
        assert(typeof r.reason === "string", "should include reason");
    } finally { restore(); }
});

// ─ executeInstagramDM — dry run ────────────────────────────────────────────────

test("executeInstagramDM: dry run returns DRY_RUN status without calling API", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "true",
        INSTAGRAM_ACCESS_TOKEN: "fake-token-123"
    });
    try {
        setMockFetch(200, { message_id: "should-not-be-called" });

        const r = await mod.executeInstagramDM({
            recipientId: "igsid-user-123",
            text: "Hello from RVAULT!"
        });

        assert(r.status === "DRY_RUN", "should be DRY_RUN, got: " + r.status);
        assert(r.success === true, "should succeed");
        assert(r.action === "DM", "action should be DM");
        assert(r.recipientId === "igsid-user-123", "recipientId should match");
        assert(r.input === "Hello from RVAULT!", "input should match");
        assert(r.endpoint.includes("graph.facebook.com"), "endpoint should use graph.facebook.com");
        assert(r.endpoint.includes("/me/messages"), "endpoint should be /me/messages");
    } finally { restore(); }
});

// ─ executeInstagramDM — live, success ─────────────────────────────────────────

test("executeInstagramDM: live mode sends DM and returns EXECUTED", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "false",
        INSTAGRAM_ACCESS_TOKEN: "fake-token-live"
    });
    try {
        setMockFetch(200, { recipient_id: "igsid-user-456", message_id: "mid-abc-789" });

        const r = await mod.executeInstagramDM({
            recipientId: "igsid-user-456",
            text: "Hey! Drop me the resource link 🔗"
        });

        assert(r.success === true, "should succeed");
        assert(r.status === "EXECUTED", "status should be EXECUTED, got: " + r.status);
        assert(r.action === "DM", "action should be DM");
        assert(r.messageId === "mid-abc-789", "messageId should match");
    } finally { restore(); }
});

// ─ executeInstagramDM — live, API error ───────────────────────────────────────

test("executeInstagramDM: API error returns FAILED with error details", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "false",
        INSTAGRAM_ACCESS_TOKEN: "fake-token-err"
    });
    try {
        setMockFetch(400, {
            error: {
                message: "Invalid recipient ID",
                code: 100,
                error_subcode: 2018001,
                type: "OAuthException"
            }
        });

        const r = await mod.executeInstagramDM({
            recipientId: "bad-igsid",
            text: "test message"
        });

        assert(r.success === false, "should fail");
        assert(r.status === "FAILED", "status should be FAILED");
        assert(r.errorCode === 100, "error code should be 100");
        assert(r.message.includes("Invalid recipient"), "message should include API error");
    } finally { restore(); }
});

// ─ executeInstagramDM — missing recipientId ────────────────────────────────────

test("executeInstagramDM: missing recipientId returns FAILED", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "false",
        INSTAGRAM_ACCESS_TOKEN: "fake-token"
    });
    try {
        const r = await mod.executeInstagramDM({ recipientId: null, text: "hello" });
        assert(r.success === false, "should fail");
        assert(r.status === "FAILED", "status should be FAILED");
        assert(r.message.includes("IGSID"), "message should mention IGSID");
    } finally { restore(); }
});

// ─ executeInstagramDM — missing token ─────────────────────────────────────────

test("executeInstagramDM: missing access token returns FAILED", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "false",
        INSTAGRAM_ACCESS_TOKEN: ""
    });
    try {
        const r = await mod.executeInstagramDM({
            recipientId: "igsid-123",
            text: "hello"
        });

        assert(r.success === false, "should fail without token");
        assert(r.status === "FAILED", "status should be FAILED");
    } finally { restore(); }
});

// ─ executeInstagramDM — text trimmed to 1000 chars ────────────────────────────

test("executeInstagramDM: text is trimmed to 1000 chars", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "true",
        INSTAGRAM_ACCESS_TOKEN: "fake"
    });
    try {
        const longText = "A".repeat(2000);

        const r = await mod.executeInstagramDM({
            recipientId: "igsid-123",
            text: longText
        });

        assert(r.status === "DRY_RUN", "should be dry run");
        assert(r.input.length === 1000, "text should be capped at 1000 chars, got: " + r.input.length);
    } finally { restore(); }
});

// ─ executeAction dispatches DM ────────────────────────────────────────────────

test("executeAction: dispatches DM action to executeInstagramDM (dry run)", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "true",
        INSTAGRAM_ACCESS_TOKEN: "fake"
    });
    try {
        const r = await mod.executeAction({
            action: "DM",
            input: "Here is your link!",
            recipientId: "igsid-user-789"
        });

        assert(r.status === "DRY_RUN", "should be DRY_RUN, got: " + r.status);
        assert(r.action === "DM", "action should be DM");
    } finally { restore(); }
});

// ─ executeAction: COMMENT still works ─────────────────────────────────────────

test("executeAction: COMMENT still dispatches correctly (dry run)", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "true",
        INSTAGRAM_ACCESS_TOKEN: "fake"
    });
    try {
        const r = await mod.executeAction({
            action: "COMMENT",
            input: "VIDEO",
            mediaId: "media-abc-123"
        });

        assert(r.status === "DRY_RUN", "should be DRY_RUN, got: " + r.status);
        assert(r.action === "COMMENT", "action should be COMMENT");
        assert(r.endpoint.includes("graph.instagram.com"), "COMMENT uses graph.instagram.com");
    } finally { restore(); }
});

// ─ executeAction: unsupported type ────────────────────────────────────────────

test("executeAction: FOLLOW_AND_DM returns UNSUPPORTED", async () => {
    const { mod, restore } = loadExecutor({
        ACTION_EXECUTOR_DRY_RUN: "false",
        INSTAGRAM_ACCESS_TOKEN: "fake"
    });
    try {
        const r = await mod.executeAction({ action: "FOLLOW_AND_DM", input: null });
        assert(r.status === "UNSUPPORTED", "should be UNSUPPORTED");
        assert(r.success === false, "should fail");
    } finally { restore(); }
});

// ── Run all tests ─────────────────────────────────────────────────────────────

async function runAll() {
    for (const { name, fn } of tests) {
        try {
            await fn();
            pass(name);
        } catch (err) {
            fail(name, err.message);
        }
    }

    console.log(`\n${tests.length - failed}/${tests.length} action executor tests passed.`);

    if (failed > 0) {
        console.error(failed + " test(s) failed.");
        process.exit(1);
    }
}

runAll();
