/**
 * test-platform-detector.js
 *
 * Unit tests for backend/utils/platformDetector.js.
 * Covers all four named platforms, subdomain variants,
 * edge cases, and verifies no divergence from the
 * previously-duplicated server.js / content.js implementations.
 *
 * Run: node backend/test-platform-detector.js
 */

const { detectPlatform } = require("./backend/utils/platformDetector");

const cases = [
    // --- Instagram ---
    { url: "https://www.instagram.com/reel/DdwBC9EthmL/", expected: "Instagram", label: "instagram.com reel" },
    { url: "https://instagram.com/p/ABC123/", expected: "Instagram", label: "bare instagram.com post" },
    { url: "https://l.instagram.com/?u=https://example.com", expected: "Instagram", label: "l.instagram.com subdomain" },

    // --- YouTube ---
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", expected: "YouTube", label: "youtube.com watch" },
    { url: "https://youtu.be/dQw4w9WgXcQ", expected: "YouTube", label: "youtu.be short link" },
    { url: "https://m.youtube.com/watch?v=abc", expected: "YouTube", label: "m.youtube.com subdomain" },

    // --- TikTok ---
    { url: "https://www.tiktok.com/@user/video/123", expected: "TikTok", label: "tiktok.com video" },
    { url: "https://tiktok.com/t/ZPRxABCDE/", expected: "TikTok", label: "bare tiktok.com" },
    { url: "https://vm.tiktok.com/ZMxxxx/", expected: "TikTok", label: "vm.tiktok.com subdomain" },

    // --- Reddit ---
    { url: "https://www.reddit.com/r/programming/comments/abc/", expected: "Reddit", label: "reddit.com post" },
    { url: "https://reddit.com/r/AskReddit/", expected: "Reddit", label: "bare reddit.com" },
    { url: "https://old.reddit.com/r/programming/", expected: "Reddit", label: "old.reddit.com subdomain" },

    // --- Unknown ---
    { url: "https://github.com/example/repo", expected: "Unknown", label: "github.com" },
    { url: "https://notion.so/page-123", expected: "Unknown", label: "notion.so" },
    { url: "https://example.com/anything", expected: "Unknown", label: "generic domain" },
    { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123", expected: "Unknown", label: "fbsbx CDN URL" },

    // --- Edge cases ---
    { url: "", expected: "Unknown", label: "empty string" },
    { url: null, expected: "Unknown", label: "null input" },
    { url: undefined, expected: "Unknown", label: "undefined input" },
    { url: "not-a-url", expected: "Unknown", label: "non-URL string" },
    { url: "http://localhost:3000/saved", expected: "Unknown", label: "localhost URL" },
    {
        url: "https://www.youtube.com/watch?v=abc&utm_source=instagram&utm_medium=social",
        expected: "YouTube",
        label: "youtube.com URL with tracking params"
    },
    {
        url: "https://instagram.com/reel/ABC/?igsh=xyz",
        expected: "Instagram",
        label: "instagram.com with igsh query param"
    },
];

let failed = 0;

for (const { url, expected, label } of cases) {
    const result = detectPlatform(url);
    const pass = result === expected;

    if (pass) {
        console.log(`PASS: ${label}`);
    } else {
        failed++;
        console.error(`FAIL: ${label}`);
        console.error(`  Input:    ${JSON.stringify(url)}`);
        console.error(`  Expected: ${expected}`);
        console.error(`  Actual:   ${result}`);
    }
}

console.log(`\n${cases.length - failed}/${cases.length} platform detector tests passed.`);

if (failed > 0) {
    console.error(`${failed} test(s) failed.`);
    process.exit(1);
}
