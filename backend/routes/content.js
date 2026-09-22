const express = require("express");
const db = require("../database");

const router = express.Router();

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
    } catch (error) {
        return "Unknown";
    }
}

router.post("/save", (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            error: "URL is required"
        });
    }

    const platform = detectPlatform(url);

    try {
        const stmt = db.prepare(
            "INSERT INTO saved_content (url, platform) VALUES (?, ?)"
        );

        const result = stmt.run(url, platform);

        res.json({
            message: "Content saved!",
            id: result.lastInsertRowid,
            url: url,
            platform: platform
        });
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                error: "This URL is already saved!"
            });
        }

        console.error(error);

        res.status(500).json({
            error: "Could not save content"
        });
    }
});

router.get("/saved", (req, res) => {
    const rows = db.prepare(
        "SELECT * FROM saved_content ORDER BY id DESC"
    ).all();

    res.json(rows);
});

router.delete("/saved/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            error: "Invalid ID"
        });
    }

    const stmt = db.prepare(
        "DELETE FROM saved_content WHERE id = ?"
    );

    const result = stmt.run(id);

    if (result.changes === 0) {
        return res.status(404).json({
            error: "Content not found"
        });
    }

    res.json({
        message: "Content deleted!",
        id: id
    });
});

module.exports = router;