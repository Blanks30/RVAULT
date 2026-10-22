const express = require("express");
const db = require("../database");
const { detectPlatform } = require("../utils/platformDetector");

const router = express.Router();

router.post("/save", async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            error: "URL is required"
        });
    }

    const platform = detectPlatform(url);

    try {
        const result = await db.query(
            "INSERT INTO saved_content (url, platform) VALUES ($1, $2) RETURNING id, url, platform",
            [url, platform]
        );

        res.json({
            message: "Content saved!",
            id: result.rows[0].id,
            url: url,
            platform: platform
        });
    } catch (error) {
        if (error.code === "23505") {
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

router.delete("/saved/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            error: "Invalid ID"
        });
    }

    try {
        const result = await db.query(
            "DELETE FROM saved_content WHERE id = $1",
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: "Content not found"
            });
        }

        res.json({
            message: "Content deleted!",
            id: id
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Could not delete content"
        });
    }
});

router.patch("/saved/:id/toggle", async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            error: "Invalid ID"
        });
    }

    const { checked } = req.body;

    if (typeof checked !== "boolean") {
        return res.status(400).json({
            error: "checked must be a boolean"
        });
    }

    try {
        const result = await db.query(
            "UPDATE saved_content SET checked = $1 WHERE id = $2 RETURNING id, checked",
            [checked ? 1 : 0, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: "Content not found"
            });
        }

        res.json({
            message: "Checked state updated!",
            id: id,
            checked: checked
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not update checked state"
        });
    }
});

module.exports = router;