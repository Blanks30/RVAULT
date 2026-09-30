/**
 * platformDetector.js
 *
 * Single canonical implementation of URL -> platform detection.
 * Previously this function was copy-pasted identically in both
 * server.js and routes/content.js. Both now require() from here.
 *
 * Supported platforms: Instagram, YouTube, TikTok, Reddit.
 * All other URLs return "Unknown".
 */

/**
 * Detect the social platform from a URL string.
 * @param {string} url
 * @returns {"Instagram"|"YouTube"|"TikTok"|"Reddit"|"Unknown"}
 */
function detectPlatform(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();

        if (
            hostname === "instagram.com" ||
            hostname.endsWith(".instagram.com")
        ) {
            return "Instagram";
        }

        if (
            hostname === "youtube.com" ||
            hostname.endsWith(".youtube.com") ||
            hostname === "youtu.be"
        ) {
            return "YouTube";
        }

        if (
            hostname === "tiktok.com" ||
            hostname.endsWith(".tiktok.com")
        ) {
            return "TikTok";
        }

        if (
            hostname === "reddit.com" ||
            hostname.endsWith(".reddit.com")
        ) {
            return "Reddit";
        }

        return "Unknown";
    } catch {
        return "Unknown";
    }
}

module.exports = { detectPlatform };
