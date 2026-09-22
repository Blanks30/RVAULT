require("dotenv").config();

const express = require("express");
const cors = require("cors");
const db = require("./database");
const contentRoutes = require("./routes/content");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("RVAULT is running!");
});

app.get("/instagram/status", (req, res) => {
    if (!process.env.INSTAGRAM_ACCESS_TOKEN) {
        return res.status(500).json({
            connected: false,
            error: "Instagram access token is missing"
        });
    }

    res.json({
        connected: true,
        message: "Instagram access token is loaded!"
    });
});

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
        mode === "subscribe" &&
        token === process.env.META_WEBHOOK_VERIFY_TOKEN
    ) {
        console.log("Webhook verified!");
        return res.status(200).send(challenge);
    }

    res.sendStatus(403);
});

function extractUrls(text) {
    if (!text || typeof text !== "string") {
        return [];
    }

    const urlRegex = /https?:\/\/[^\s<>"']+/gi;

    return text.match(urlRegex) || [];
}

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

function saveUrl(url) {
    const platform = detectPlatform(url);

    try {
        const stmt = db.prepare(
            "INSERT INTO saved_content (url, platform) VALUES (?, ?)"
        );

        stmt.run(url, platform);

        console.log("Saved URL:", url);
        console.log("Platform:", platform);
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            console.log("URL already saved:", url);
        } else {
            console.error("Could not save URL:", error);
        }
    }
}

function processMessage(message) {
    if (!message) {
        return;
    }

    const text = message.text || "";

    console.log("Message text:", text);

    const urls = extractUrls(text);

    console.log("URLs found:", urls);

    for (const url of urls) {
        saveUrl(url);
    }
}

app.post("/webhook", (req, res) => {
    console.log("Instagram webhook event received!");
    console.log(JSON.stringify(req.body, null, 2));

    try {
        const entries = req.body.entry || [];

        for (const entry of entries) {
            if (Array.isArray(entry.messaging)) {
                for (const event of entry.messaging) {
                    processMessage(event.message);
                }
            }

            const changes = entry.changes || [];

            for (const change of changes) {
                if (change.field !== "messages") {
                    continue;
                }

                const message = change.value?.message;

                processMessage(message);
            }
        }

        return res.sendStatus(200);
    } catch (error) {
        console.error("Webhook processing error:", error);
        return res.sendStatus(500);
    }
});

app.use("/", contentRoutes);

app.listen(3000, () => {
    console.log("RVAULT running at http://localhost:3000");
});