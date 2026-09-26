const path = require("path");

require("dotenv").config({
    path: path.resolve(
        __dirname,
        "..",
        ".env"
    )
});

const express = require("express");
const cors = require("cors");
const db = require("./database");
const contentRoutes = require("./routes/content");
const { detectCTA } = require("./ctaDetector");
const { planAction } = require("./actionPlanner");
const { executeAction } = require("./actionExecutor");

const app = express();

app.use(cors());
app.use(express.json());

function isMetaExecutionEnabled() {
    return (
        String(
            process.env.ENABLE_META_ACTIONS || "false"
        ).toLowerCase() === "true"
    );
}

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
        metaActionsEnabled:
            isMetaExecutionEnabled(),
        message:
            "Instagram access token is loaded!"
    });
});

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token =
        req.query["hub.verify_token"];
    const challenge =
        req.query["hub.challenge"];

    if (
        mode === "subscribe" &&
        token ===
            process.env.META_WEBHOOK_VERIFY_TOKEN
    ) {
        console.log(
            "Webhook verified!"
        );

        return res
            .status(200)
            .send(challenge);
    }

    res.sendStatus(403);
});

function extractUrls(text) {
    if (
        !text ||
        typeof text !== "string"
    ) {
        return [];
    }

    const urlRegex =
        /https?:\/\/[^\s<>"']+/gi;

    return (
        text.match(urlRegex) || []
    );
}

function detectPlatform(url) {
    try {
        const hostname =
            new URL(url)
                .hostname
                .toLowerCase();

        if (
            hostname ===
                "instagram.com" ||
            hostname.endsWith(
                ".instagram.com"
            )
        ) {
            return "Instagram";
        }

        if (
            hostname ===
                "youtube.com" ||
            hostname.endsWith(
                ".youtube.com"
            ) ||
            hostname === "youtu.be"
        ) {
            return "YouTube";
        }

        if (
            hostname ===
                "tiktok.com" ||
            hostname.endsWith(
                ".tiktok.com"
            )
        ) {
            return "TikTok";
        }

        if (
            hostname ===
                "reddit.com" ||
            hostname.endsWith(
                ".reddit.com"
            )
        ) {
            return "Reddit";
        }

        return "Unknown";
    } catch (error) {
        return "Unknown";
    }
}

function saveUrl(url) {
    const platform =
        detectPlatform(url);

    try {
        const stmt = db.prepare(
            `
            INSERT INTO saved_content
                (url, platform)
            VALUES (?, ?)
            `
        );

        stmt.run(
            url,
            platform
        );

        console.log(
            "Saved URL:",
            url
        );

        console.log(
            "Platform:",
            platform
        );
    } catch (error) {
        if (
            error.code ===
            "SQLITE_CONSTRAINT_UNIQUE"
        ) {
            console.log(
                "URL already saved:",
                url
            );
        } else {
            console.error(
                "Could not save URL:",
                error
            );
        }
    }
}

function saveInstagramSharedMedia({
    mediaId,
    mediaType,
    title,
    url,
    senderId,
    messageId,
    ctaType,
    ctaKeyword,
    actionType,
    actionInput,
    actionStatus
}) {
    if (!mediaId) {
        console.log(
            "Instagram media ID is missing."
        );

        return;
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO instagram_shared_posts (
                media_id,
                media_type,
                title,
                url,
                sender_id,
                message_id,
                cta_type,
                cta_keyword,
                action_type,
                action_input,
                action_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(media_id) DO UPDATE SET
                media_type = excluded.media_type,
                title = excluded.title,
                url = COALESCE(
                    excluded.url,
                    instagram_shared_posts.url
                ),
                sender_id = excluded.sender_id,
                message_id = excluded.message_id,
                cta_type = excluded.cta_type,
                cta_keyword = excluded.cta_keyword,
                action_type = excluded.action_type,
                action_input = excluded.action_input,
                action_status = excluded.action_status
        `);

        stmt.run(
            mediaId,
            mediaType,
            title || null,
            url || null,
            senderId || null,
            messageId || null,
            ctaType || "NO_ACTION",
            ctaKeyword || null,
            actionType || "NONE",
            actionInput || null,
            actionStatus ||
                "NO_ACTION"
        );

        console.log(
            "Instagram shared media saved!"
        );

        console.log(
            "Media type:",
            mediaType
        );

        console.log(
            "Media ID:",
            mediaId
        );

        console.log(
            "CTA type:",
            ctaType || "NO_ACTION"
        );

        console.log(
            "CTA keyword:",
            ctaKeyword || "(none)"
        );

        console.log(
            "Action:",
            actionType || "NONE"
        );

        console.log(
            "Action input:",
            actionInput || "(none)"
        );

        console.log(
            "Action status:",
            actionStatus || "NO_ACTION"
        );

        console.log(
            "Instagram URL:",
            url || "(not provided)"
        );
    } catch (error) {
        console.error(
            "Could not save Instagram shared media:",
            error
        );
    }
}

async function processInstagramAttachments(
    message
) {
    const attachments =
        message?.attachments;

    if (!Array.isArray(attachments)) {
        return;
    }

    for (const attachment of attachments) {
        const attachmentType =
            attachment?.type;

        if (
            attachmentType !==
                "ig_post" &&
            attachmentType !==
                "ig_reel"
        ) {
            continue;
        }

        const payload =
            attachment.payload || {};

        let mediaId = null;
        let mediaType =
            attachmentType;
        let title =
            payload.title || null;
        let url = null;

        if (
            attachmentType ===
            "ig_reel"
        ) {
            mediaId =
                payload.reel_video_id;

            url =
                payload.url ||
                payload.permalink ||
                null;
        }

        if (
            attachmentType ===
            "ig_post"
        ) {
            mediaId =
                payload.ig_post_media_id;

            url =
                payload.url ||
                payload.permalink ||
                null;
        }

        const cta =
            detectCTA(title);

        const actionPlan =
            planAction(
                cta.type,
                cta.keyword
            );

        console.log(
            "Instagram shared media detected!"
        );

        console.log(
            "Type:",
            mediaType
        );

        console.log(
            "Media ID:",
            mediaId
        );

        console.log(
            "CTA type:",
            cta.type
        );

        console.log(
            "CTA keyword:",
            cta.keyword || "(none)"
        );

        console.log(
            "Planned action:",
            actionPlan.action
        );

        console.log(
            "Action input:",
            actionPlan.input || "(none)"
        );

        console.log(
            "Action plan status:",
            actionPlan.status
        );

        console.log(
            "Title:",
            title || "(no title)"
        );

        console.log(
            "Instagram URL:",
            url || "(not provided)"
        );

        let actionResult = {
            success: true,
            status: actionPlan.status,
            action:
                actionPlan.action,
            input:
                actionPlan.input ||
                null,
            mediaId,
            message:
                "Action was not executed."
        };

        if (
            actionPlan.status ===
            "READY"
        ) {
            if (
                !isMetaExecutionEnabled()
            ) {
                actionResult = {
                    success: true,
                    status: "BLOCKED",
                    action:
                        actionPlan.action,
                    input:
                        actionPlan.input ||
                        null,
                    mediaId,
                    message:
                        "Meta action execution is disabled. Set ENABLE_META_ACTIONS=true after testing."
                };
            } else {
                actionResult =
                    await executeAction({
                        ...actionPlan,
                        mediaId
                    });
            }
        }

        console.log(
            "Action execution result:"
        );

        console.log(
            JSON.stringify(
                actionResult,
                null,
                2
            )
        );

        saveInstagramSharedMedia({
            mediaId,
            mediaType,
            title,
            url,
            senderId:
                message?.sender?.id,
            messageId:
                message?.mid,
            ctaType:
                cta.type,
            ctaKeyword:
                cta.keyword,
            actionType:
                actionResult.action ||
                actionPlan.action,
            actionInput:
                actionResult.input ||
                actionPlan.input ||
                null,
            actionStatus:
                actionResult.status ||
                actionPlan.status
        });

        if (url) {
            saveUrl(url);
        }
    }
}

async function processMessage(
    message
) {
    if (!message) {
        return;
    }

    console.log(
        "Processing Instagram message..."
    );

    const text =
        message.text || "";

    if (text) {
        console.log(
            "Message text:",
            text
        );

        const urls =
            extractUrls(text);

        console.log(
            "URLs found:",
            urls
        );

        for (const url of urls) {
            saveUrl(url);
        }
    }

    await processInstagramAttachments(
        message
    );
}

app.get("/saved", (req, res) => {
    try {
        const savedRows =
            db.prepare(`
                SELECT
                    sc.id,
                    sc.url,
                    sc.platform,
                    sc.created_at,
                    isp.media_id,
                    isp.media_type,
                    isp.title,
                    isp.cta_type,
                    isp.cta_keyword,
                    isp.action_type,
                    isp.action_input,
                    isp.action_status,
                    isp.sender_id,
                    isp.message_id,
                    isp.received_at,
                    0 AS is_shared_only,
                    NULL AS shared_post_id
                FROM saved_content sc
                LEFT JOIN instagram_shared_posts isp
                    ON sc.url = isp.url
                ORDER BY sc.id DESC
            `).all();

        const sharedOnlyRows =
            db.prepare(`
                SELECT
                    isp.id AS shared_post_id,
                    isp.media_id,
                    isp.media_type,
                    isp.title,
                    isp.url,
                    isp.cta_type,
                    isp.cta_keyword,
                    isp.action_type,
                    isp.action_input,
                    isp.action_status,
                    isp.sender_id,
                    isp.message_id,
                    isp.received_at
                FROM instagram_shared_posts isp
                LEFT JOIN saved_content sc
                    ON isp.url IS NOT NULL
                    AND isp.url = sc.url
                WHERE sc.id IS NULL
                ORDER BY isp.id DESC
            `).all();

        const formattedSharedRows =
            sharedOnlyRows.map(
                (row) => ({
                    id:
                        `shared-${row.shared_post_id}`,
                    url: row.url,
                    platform:
                        "Instagram",
                    created_at:
                        row.received_at,
                    media_id:
                        row.media_id,
                    media_type:
                        row.media_type,
                    title:
                        row.title,
                    cta_type:
                        row.cta_type,
                    cta_keyword:
                        row.cta_keyword,
                    action_type:
                        row.action_type,
                    action_input:
                        row.action_input,
                    action_status:
                        row.action_status,
                    sender_id:
                        row.sender_id,
                    message_id:
                        row.message_id,
                    received_at:
                        row.received_at,
                    is_shared_only: 1,
                    shared_post_id:
                        row.shared_post_id
                })
            );

        res.json([
            ...savedRows,
            ...formattedSharedRows
        ]);
    } catch (error) {
        console.error(
            "Could not fetch saved content:",
            error
        );

        res.status(500).json({
            error:
                "Could not fetch saved content"
        });
    }
});

app.get(
    "/instagram/shared-posts",
    (req, res) => {
        try {
            const rows =
                db.prepare(`
                    SELECT
                        id,
                        media_id,
                        media_type,
                        title,
                        url,
                        sender_id,
                        message_id,
                        cta_type,
                        cta_keyword,
                        action_type,
                        action_input,
                        action_status,
                        received_at
                    FROM instagram_shared_posts
                    ORDER BY id DESC
                `).all();

            res.json(rows);
        } catch (error) {
            console.error(
                "Could not fetch Instagram shared posts:",
                error
            );

            res.status(500).json({
                error:
                    "Could not fetch Instagram shared posts"
            });
        }
    }
);

app.delete(
    "/instagram/shared-posts/:id",
    (req, res) => {
        const id =
            Number(req.params.id);

        if (
            !Number.isInteger(id) ||
            id <= 0
        ) {
            return res.status(400).json({
                error:
                    "Invalid shared post ID"
            });
        }

        const stmt =
            db.prepare(
                "DELETE FROM instagram_shared_posts WHERE id = ?"
            );

        const result =
            stmt.run(id);

        if (result.changes === 0) {
            return res.status(404).json({
                error:
                    "Instagram shared post not found"
            });
        }

        res.json({
            message:
                "Instagram shared post deleted!",
            id
        });
    }
);

app.post("/webhook", async (req, res) => {
    console.log(
        "Instagram webhook event received!"
    );

    console.log(
        JSON.stringify(
            req.body,
            null,
            2
        )
    );

    try {
        const entries =
            req.body.entry || [];

        for (const entry of entries) {
            if (
                Array.isArray(
                    entry.messaging
                )
            ) {
                for (
                    const event of
                        entry.messaging
                ) {
                    await processMessage(
                        event.message
                    );
                }
            }

            const changes =
                entry.changes || [];

            for (const change of changes) {
                if (
                    change.field !==
                    "messages"
                ) {
                    continue;
                }

                const message =
                    change.value?.message;

                await processMessage(
                    message
                );
            }
        }

        return res.sendStatus(200);
    } catch (error) {
        console.error(
            "Webhook processing error:",
            error
        );

        return res.sendStatus(500);
    }
});

app.use(
    "/",
    contentRoutes
);

app.listen(3000, () => {
    console.log(
        "RVAULT running at http://localhost:3000"
    );

    console.log(
        "Meta action execution:",
        isMetaExecutionEnabled()
            ? "ENABLED"
            : "DISABLED"
    );
});