const Database = require("better-sqlite3");
const {
    associateReceivedLink,
    findMatchingSharedPost,
    isInstagramHostedUrl,
    isMetaPlatformOrCdnUrl
} = require("./dmLinkAssociation");

function createTestDb() {
    const db = new Database(":memory:");

    db.exec(`
        CREATE TABLE instagram_shared_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            received_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    return db;
}

function insertPost(db, row) {
    db.prepare(`
        INSERT INTO instagram_shared_posts (
            media_id,
            media_type,
            title,
            url,
            original_url,
            resource_url,
            sender_id,
            recipient_id,
            cta_type,
            cta_keyword,
            action_type,
            action_status,
            received_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        row.media_id,
        row.media_type || "ig_reel",
        row.title !== undefined ? row.title : "Comment VIDEO for the link",
        row.url,
        row.original_url || row.url,
        row.resource_url !== undefined ? row.resource_url : null,
        row.sender_id !== undefined ? row.sender_id : null,
        row.recipient_id !== undefined ? row.recipient_id : null,
        row.cta_type !== undefined ? row.cta_type : "COMMENT",
        row.cta_keyword !== undefined ? row.cta_keyword : null,
        row.action_type !== undefined ? row.action_type : "COMMENT",
        row.action_status !== undefined ? row.action_status : "READY",
        row.received_at
    );
}

function isoDaysAgo(days) {
    return new Date(
        Date.now() - days * 24 * 60 * 60 * 1000
    )
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
}

const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

// 1. same sender => match
test("same sender => match (matches recent CTA reel from same sender)", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-1",
        url: "https://www.instagram.com/reel/ABC/",
        original_url: "https://www.instagram.com/reel/ABC/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(0)
    });

    const result = associateReceivedLink(db, {
        senderId: "sender-1",
        url: "https://github.com/example/repo"
    });

    const row = db
        .prepare(
            "SELECT url, original_url, resource_url, action_status FROM instagram_shared_posts WHERE media_id = ?"
        )
        .get("media-1");

    if (!result.matched) {
        throw new Error("expected a match for same sender");
    }

    if (result.mediaId !== "media-1") {
        throw new Error("matched the wrong media");
    }

    if (row.resource_url !== "https://github.com/example/repo") {
        throw new Error("did not store received creator URL in resource_url");
    }

    if (row.original_url !== "https://www.instagram.com/reel/ABC/") {
        throw new Error("did not preserve original Reel URL");
    }

    if (row.action_status !== "LINK_RECEIVED") {
        throw new Error("did not set action_status to LINK_RECEIVED");
    }
});

// 2. different sender => no match
test("different sender => no match (rejects candidate from another sender)", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-1",
        url: "https://www.instagram.com/reel/ABC/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(0)
    });

    const result = associateReceivedLink(db, {
        senderId: "sender-2",
        url: "https://youtu.be/abcd"
    });

    if (result.matched) {
        throw new Error("matched a different sender");
    }

    if (result.reason !== "NO_MATCH") {
        throw new Error(`expected NO_MATCH reason, got ${result.reason}`);
    }

    if (!result.diagnostics || !result.diagnostics.candidates[0].reason.includes("SENDER_MISMATCH")) {
        throw new Error("diagnostics missing SENDER_MISMATCH explanation");
    }
});

// 3. same recipient + safe recent conversation => match when supported by existing data
test("same recipient + safe recent conversation => match when bot DMs the reel-sharing user", () => {
    const db = createTestDb();

    // User "user-4589" shared a Reel to the bot "page-1059"
    insertPost(db, {
        media_id: "media-reel-1",
        url: "https://www.instagram.com/reel/CREATOR123/",
        original_url: "https://www.instagram.com/reel/CREATOR123/",
        sender_id: "user-4589",
        recipient_id: "page-1059",
        cta_type: "COMMENT",
        cta_keyword: "FREE",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(0)
    });

    // Bot "page-1059" sends automated DM with link to User "user-4589"
    const result = associateReceivedLink(db, {
        senderId: "page-1059",
        recipientId: "user-4589",
        url: "https://resource.example.com/guide.pdf"
    });

    if (!result.matched) {
        throw new Error("expected match when bot DMs the user who shared the Reel");
    }

    if (result.mediaId !== "media-reel-1") {
        throw new Error(`expected media-reel-1, got ${result.mediaId}`);
    }

    const row = db
        .prepare("SELECT resource_url, action_status FROM instagram_shared_posts WHERE media_id = ?")
        .get("media-reel-1");

    if (row.resource_url !== "https://resource.example.com/guide.pdf") {
        throw new Error("did not associate resource_url on matching recipient");
    }

    if (row.action_status !== "LINK_RECEIVED") {
        throw new Error("did not update status to LINK_RECEIVED");
    }
});

test("same recipient check rejects if DM was sent to a different user", () => {
    const db = createTestDb();

    // User A shared a Reel
    insertPost(db, {
        media_id: "media-user-a",
        url: "https://www.instagram.com/reel/AAA/",
        sender_id: "user-A",
        recipient_id: "page-1059",
        cta_type: "COMMENT",
        cta_keyword: "FREE",
        received_at: isoDaysAgo(0)
    });

    // Bot sends DM with link to User B (not User A)
    const result = associateReceivedLink(db, {
        senderId: "page-1059",
        recipientId: "user-B",
        url: "https://resource.example.com/other.pdf"
    });

    if (result.matched) {
        throw new Error("must never attach link to a different user's Reel");
    }
});

// 4. no identity => no match
test("no identity => no match (rejects if senderId and recipientId are missing)", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-1",
        url: "https://www.instagram.com/reel/ABC/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(0)
    });

    const result = associateReceivedLink(db, {
        senderId: null,
        recipientId: null,
        url: "https://youtu.be/abcd"
    });

    if (result.matched) {
        throw new Error("matched without any identity");
    }

    if (result.reason !== "NO_IDENTITY") {
        throw new Error(`expected NO_IDENTITY reason, got ${result.reason}`);
    }
});

// 5. expired/old Reel => no match
test("expired/old Reel => no match (does not match posts older than window)", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-old",
        url: "https://www.instagram.com/reel/OLD/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(10)
    });

    const result = associateReceivedLink(db, {
        senderId: "sender-1",
        url: "https://github.com/example/repo"
    });

    if (result.matched) {
        throw new Error("matched an old expired shared post");
    }

    if (result.reason !== "NO_MATCH") {
        throw new Error("expected NO_MATCH for expired candidate");
    }
});

// 6. existing resource_url => do not overwrite unless explicitly allowed
test("existing resource_url => do not overwrite (preserves existing resource_url)", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-1",
        url: "https://www.instagram.com/reel/ABC/",
        original_url: "https://www.instagram.com/reel/ABC/",
        resource_url: "https://youtu.be/already-saved",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "LINK_RECEIVED",
        received_at: isoDaysAgo(0)
    });

    const result = associateReceivedLink(db, {
        senderId: "sender-1",
        url: "https://github.com/other"
    });

    const row = db
        .prepare(
            "SELECT url, original_url, resource_url FROM instagram_shared_posts WHERE media_id = ?"
        )
        .get("media-1");

    if (result.matched) {
        throw new Error("overwrote an existing external URL");
    }

    if (row.resource_url !== "https://youtu.be/already-saved") {
        throw new Error("changed an existing external URL");
    }
});

test("skips NO_ACTION posts and uses the latest CTA post", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-cta",
        url: "https://www.instagram.com/reel/CTA/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(1)
    });

    insertPost(db, {
        media_id: "media-none",
        url: "https://www.instagram.com/reel/NONE/",
        sender_id: "sender-1",
        cta_type: "NO_ACTION",
        cta_keyword: null,
        action_type: "NONE",
        action_status: "NO_ACTION",
        received_at: isoDaysAgo(0)
    });

    const result = associateReceivedLink(db, {
        senderId: "sender-1",
        url: "https://example.com/tool"
    });

    if (!result.matched || result.mediaId !== "media-cta") {
        throw new Error("did not skip the NO_ACTION post");
    }
});

test("does not treat an Instagram or Meta CDN URL as the received resource link", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-1",
        url: "https://www.instagram.com/reel/ABC/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(0)
    });

    const resultIg = associateReceivedLink(db, {
        senderId: "sender-1",
        url: "https://www.instagram.com/reel/OTHER/"
    });

    if (resultIg.matched) {
        throw new Error("associated an Instagram URL");
    }

    const resultCdn = associateReceivedLink(db, {
        senderId: "sender-1",
        url: "https://lookaside.fbsbx.com/ig_messaging_cdn_entrance/?mid=123"
    });

    if (resultCdn.matched) {
        throw new Error("associated a Meta CDN URL");
    }
});

test("prefers the most recent qualifying shared post", () => {
    const db = createTestDb();

    insertPost(db, {
        media_id: "media-older",
        url: "https://www.instagram.com/reel/OLD/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "VIDEO",
        action_type: "COMMENT",
        action_status: "READY",
        received_at: isoDaysAgo(2)
    });

    insertPost(db, {
        media_id: "media-newer",
        url: "https://www.instagram.com/reel/NEW/",
        sender_id: "sender-1",
        cta_type: "COMMENT",
        cta_keyword: "SETUP",
        action_type: "COMMENT",
        action_status: "BLOCKED",
        received_at: isoDaysAgo(0)
    });

    const match = findMatchingSharedPost(db, {
        senderId: "sender-1"
    });

    if (!match || match.media_id !== "media-newer") {
        throw new Error("did not prefer the newest qualifying post");
    }
});

let failed = 0;

for (const { name, fn } of tests) {
    try {
        fn();
        console.log("PASS:", name);
    } catch (error) {
        failed += 1;
        console.error("FAIL:", name);
        console.error(error.message);
    }
}

if (failed > 0) {
    process.exit(1);
}

console.log("\nAll DM URL association tests passed.");
