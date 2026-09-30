const express = require("express");
const db = require("../database");
const { detectPlatform } = require("../utils/platformDetector");

const router = express.Router();

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
    // NOTE: This route is intentionally NOT defined here.
    // GET /saved is defined in server.js with the full query that includes
    // CTA fields, shared-only rows, is_shared_only, and shared_post_id.
    // That definition is registered before this router is mounted, so it
    // always wins. Defining it here was dead code and has been removed.
    //
    // If you need to change the GET /saved behaviour, edit server.js.
    res.status(404).json({ error: "Not implemented here — see server.js GET /saved" });
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