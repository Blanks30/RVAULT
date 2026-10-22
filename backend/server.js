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
const crypto = require("crypto");
const db = require("./database");
const contentRoutes = require("./routes/content");
const { detectPlatform } = require("./utils/platformDetector");
const { detectCTA } = require("./ctaDetector");
const { planAction } = require("./actionPlanner");
const { executeAction, executeInstagramDM } = require("./actionExecutor");
const {
    associateReceivedLink,
    cleanExtractedUrl,
    isInstagramHostedUrl,
    isMetaPlatformOrCdnUrl
} = require("./dmLinkAssociation");

const app = express();

// CORS configuration with environment-based allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:5173'];  // Default to Vite dev server

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g., mobile apps, Postman, Meta webhooks)
        if (!origin) {
            return callback(null, true);
        }

        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS policy: Origin ${origin} not allowed`));
        }
    },
    credentials: true
}));

// For webhook verification, we need the raw body to compute HMAC
// Use express.raw() for webhook route, express.json() for everything else
app.use((req, res, next) => {
    if (req.path === '/webhook' && req.method === 'POST') {
        express.raw({ type: 'application/json' })(req, res, next);
    } else {
        express.json()(req, res, next);
    }
});

// ---------------------------------------------------------------------------
// API key authentication middleware
// ---------------------------------------------------------------------------
// Routes exempt from authentication:
//   GET  /          – health check ("RVAULT is running!")
//   GET  /webhook   – Meta webhook subscription verification (public handshake)
//   POST /webhook   – Meta webhook delivery (protected separately by HMAC)
//
// All other routes require:  Authorization: Bearer <API_SECRET>
//
// API_SECRET must be set in the server environment (.env).  If it is missing
// the middleware returns 503 rather than silently allowing unauthenticated
// access, so a misconfigured deployment fails loudly.
// ---------------------------------------------------------------------------
function isPublicExemption(req) {
    if (req.path === "/" && req.method === "GET") {
        return true;
    }
    if (req.path === "/webhook" && (req.method === "GET" || req.method === "POST")) {
        return true;
    }
    return false;
}

function requireApiKey(req, res, next) {
    // Exempt exactly GET /, GET /webhook, and POST /webhook
    if (isPublicExemption(req)) {
        return next();
    }

    const secret = process.env.API_SECRET;

    if (!secret) {
        console.error(
            "[AUTH] API_SECRET is not configured – all protected routes are blocked."
        );
        return res.status(503).json({
            error: "Server is not configured for authenticated access (API_SECRET missing)"
        });
    }

    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";

    // Constant-time comparison to prevent timing attacks
    let valid = false;
    try {
        const tokenBuf  = Buffer.from(token.padEnd(secret.length));
        const secretBuf = Buffer.from(secret);
        // timingSafeEqual requires same-length buffers
        if (tokenBuf.length === secretBuf.length) {
            valid = crypto.timingSafeEqual(tokenBuf, secretBuf)
                && token.length === secret.length;
        }
    } catch {
        valid = false;
    }

    if (!valid) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    next();
}

// Apply authentication globally — exemptions handled inside the middleware
app.use(requireApiKey);

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
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const rawExpectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!rawExpectedToken || typeof rawExpectedToken !== "string" || !rawExpectedToken.trim()) {
        console.error("[WEBHOOK SECURITY] META_WEBHOOK_VERIFY_TOKEN is not configured");
        return res.sendStatus(403);
    }

    const expectedToken = rawExpectedToken.trim();
    const receivedToken = typeof token === "string" ? token.trim() : "";

    let tokenValid = false;
    try {
        const receivedBuf = Buffer.from(receivedToken);
        const expectedBuf = Buffer.from(expectedToken);
        if (
            receivedBuf.length === expectedBuf.length &&
            crypto.timingSafeEqual(receivedBuf, expectedBuf)
        ) {
            tokenValid = true;
        }
    } catch {
        tokenValid = false;
    }

    if (
        mode === "subscribe" &&
        tokenValid
    ) {
        console.log("Webhook verified successfully!");
        return res.status(200).send(challenge);
    }

    console.warn(
        `Webhook verification failed! Received mode="${mode || ""}"`
    );

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

// detectPlatform is imported from ./utils/platformDetector
// (removed local copy to avoid divergence)

async function saveUrl(url) {
    const platform =
        detectPlatform(url);

    try {
        await db.query(
            `
            INSERT INTO saved_content
                (url, platform)
            VALUES ($1, $2)
            `,
            [url, platform]
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
            error.code === "23505"
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

async function saveInstagramSharedMedia({
    mediaId,
    mediaType,
    title,
    url,
    senderId,
    recipientId,
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
        await db.query(`
            INSERT INTO instagram_shared_posts (
                media_id,
                media_type,
                title,
                url,
                original_url,
                sender_id,
                recipient_id,
                message_id,
                cta_type,
                cta_keyword,
                action_type,
                action_input,
                action_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT(media_id) DO UPDATE SET
                media_type = EXCLUDED.media_type,
                title = EXCLUDED.title,
                url = COALESCE(
                    EXCLUDED.url,
                    instagram_shared_posts.url
                ),
                original_url = COALESCE(
                    EXCLUDED.original_url,
                    instagram_shared_posts.original_url,
                    instagram_shared_posts.url
                ),
                sender_id = EXCLUDED.sender_id,
                recipient_id = EXCLUDED.recipient_id,
                message_id = EXCLUDED.message_id,
                cta_type = EXCLUDED.cta_type,
                cta_keyword = EXCLUDED.cta_keyword,
                action_type = EXCLUDED.action_type,
                action_input = EXCLUDED.action_input,
                action_status = EXCLUDED.action_status
        `, [
            mediaId,
            mediaType,
            title || null,
            url || null,
            url || null,
            senderId || null,
            recipientId || null,
            messageId || null,
            ctaType || "NO_ACTION",
            ctaKeyword || null,
            actionType || "NONE",
            actionInput || null,
            actionStatus || "NO_ACTION"
        ]);

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

function getMessageSenderId(message, context) {
    return (
        context?.senderId ||
        message?.sender?.id ||
        null
    );
}

async function processInstagramAttachments(
    message,
    senderId,
    recipientId
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
            if (mediaType === "ig_reel") {
                // We cannot comment on a foreign Reel (Meta API Error 100/subcode 33).
                // Instead, send the sender a DM acknowledging their Reel and requesting
                // they share the resource link. This closes the product loop:
                // User shares Reel → RVAULT DMs them back → User sends the resource link.
                actionResult = {
                    success: true,
                    status: "RECEIVED",
                    action: actionPlan.action,
                    input: actionPlan.input || null,
                    mediaId,
                    message:
                        "Foreign Instagram Reel received. Public comment action was not executed because the shared Reel ID is not accessible to the connected account."
                };

                // Only DM the sender if we have their IGSID and Meta actions are enabled
                if (
                    isMetaExecutionEnabled() &&
                    (senderId || recipientId)
                ) {
                    const dmRecipientId = senderId || recipientId;
                    const ctaKeyword = actionPlan.input;

                    // Compose the DM: acknowledge the Reel and ask for the resource link
                    const dmText = ctaKeyword
                        ? `Hey! I saw you shared a reel with the keyword "${ctaKeyword}" 👀 Drop me the resource link and I'll save it for you! 🔗`
                        : `Hey! I received your shared reel. Drop me the resource link and I'll save it for you! 🔗`;

                    console.log(
                        "Sending DM to reel sender:",
                        dmRecipientId
                    );

                    const dmResult = await executeInstagramDM({
                        recipientId: dmRecipientId,
                        text: dmText
                    });

                    console.log(
                        "DM result:",
                        JSON.stringify(dmResult, null, 2)
                    );

                    // Update actionResult to reflect the DM attempt
                    if (dmResult.success) {
                        actionResult = {
                            ...actionResult,
                            status: "DM_SENT",
                            dmMessageId: dmResult.messageId || null,
                            message:
                                "Reel received. DM sent to sender requesting resource link."
                        };
                    } else {
                        // DM failed — keep RECEIVED status and log the reason
                        console.warn(
                            "DM to reel sender failed:",
                            dmResult.message
                        );
                    }
                }
            } else if (
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

        await saveInstagramSharedMedia({
            mediaId,
            mediaType,
            title,
            url,
            senderId:
                senderId ||
                message?.sender?.id,
            recipientId:
                recipientId ||
                message?.recipient?.id,
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
            await saveUrl(url);
        }
    }
}
async function saveInstagramReplyLink({
    mediaId,
    url,
    commentId,
    text
}) {
    if (!url) {
        return;
    }

    const cleanUrl = url.replace(/[),.!?]+$/g, "");

    await saveUrl(cleanUrl);

    if (!mediaId) {
        console.log(
            "Reply URL saved, but Instagram media ID was not provided."
        );

        console.log(
            "Matched shared post: NO"
        );

        return;
    }

    try {
        const result = await db.query(`
            UPDATE instagram_shared_posts
            SET resource_url = $1,
                action_status = CASE
                    WHEN action_status IN (
                        'DRY_RUN',
                        'EXECUTED',
                        'READY',
                        'BLOCKED'
                    )
                    THEN 'LINK_RECEIVED'
                    ELSE action_status
                END
            WHERE media_id = $2
        `, [cleanUrl, mediaId]);

        console.log(
            "Instagram reply URL received!"
        );

        console.log(
            "Media ID:",
            mediaId
        );

        console.log(
            "Comment ID:",
            commentId || "(none)"
        );

        console.log(
            "Reply text:",
            text || "(none)"
        );

        console.log(
            "Link:",
            cleanUrl
        );

        console.log(
            "Matched shared post:",
            result.rowCount > 0 ? "YES" : "NO"
        );
    } catch (error) {
        console.error(
            "Could not attach reply URL to Instagram shared post:",
            error
        );
    }
}

async function processInstagramCommentWebhook(changeValue) {
    const value = changeValue || {};
    const comment =
        value.comment ||
        value.value ||
        value;

    const text =
        comment.text ||
        value.text ||
        comment.message ||
        value.message ||
        "";

    const mediaId =
        value.media?.id ||
        value.media?.media_id ||
        value.media_id ||
        comment.media?.id ||
        comment.media?.media_id ||
        comment.media_id ||
        null;

    const commentId =
        comment.id ||
        comment.comment_id ||
        value.id ||
        value.comment_id ||
        null;

    const urls = extractUrls(text);

    console.log(
        "Instagram comment webhook received!"
    );

    console.log(
        "Comment text:",
        text || "(empty)"
    );

    console.log(
        "Media ID:",
        mediaId || "(none)"
    );

    console.log(
        "Comment ID:",
        commentId || "(none)"
    );

    console.log(
        "Extracted URL:",
        urls[0] || "(none)"
    );

    if (!urls.length) {
        console.log(
            "No URL found in Instagram comment."
        );

        console.log(
            "Matched shared post: NO"
        );

        return;
    }

    for (const url of urls) {
        await saveInstagramReplyLink({
            mediaId,
            url,
            commentId,
            text
        });
    }
}
function extractUrlsFromMessage(message) {
    if (!message) {
        return [];
    }

    const found = [];

    if (message.text && typeof message.text === "string") {
        found.push(...extractUrls(message.text));
    }

    if (
        message.quick_reply?.payload &&
        typeof message.quick_reply.payload === "string"
    ) {
        found.push(...extractUrls(message.quick_reply.payload));
    }

    if (Array.isArray(message.attachments)) {
        for (const attachment of message.attachments) {
            const payload = attachment?.payload || {};

            if (payload.url && typeof payload.url === "string") {
                found.push(...extractUrls(payload.url));
            }

            if (attachment.url && typeof attachment.url === "string") {
                found.push(...extractUrls(attachment.url));
            }

            if (payload.title && typeof payload.title === "string") {
                found.push(...extractUrls(payload.title));
            }

            if (Array.isArray(payload.buttons)) {
                for (const button of payload.buttons) {
                    if (button?.url && typeof button.url === "string") {
                        found.push(...extractUrls(button.url));
                    }
                }
            }

            if (Array.isArray(payload.elements)) {
                for (const element of payload.elements) {
                    if (element?.url && typeof element.url === "string") {
                        found.push(...extractUrls(element.url));
                    }

                    if (
                        element?.item_url &&
                        typeof element.item_url === "string"
                    ) {
                        found.push(...extractUrls(element.item_url));
                    }

                    if (
                        element?.default_action?.url &&
                        typeof element.default_action.url === "string"
                    ) {
                        found.push(...extractUrls(element.default_action.url));
                    }

                    if (Array.isArray(element?.buttons)) {
                        for (const button of element.buttons) {
                            if (
                                button?.url &&
                                typeof button.url === "string"
                            ) {
                                found.push(...extractUrls(button.url));
                            }
                        }
                    }
                }
            }
        }
    }

    return Array.from(new Set(found));
}

async function processMessage(
    message,
    context
) {
    if (!message) {
        return;
    }

    const senderId =
        getMessageSenderId(
            message,
            context
        );

    const recipientId =
        context?.recipientId ||
        message?.recipient?.id ||
        null;

    console.log(
        "Processing Instagram message..."
    );

    console.log(
        "Message sender ID:",
        senderId || "(none)"
    );

    await processInstagramAttachments(
        message,
        senderId,
        recipientId
    );

    const urls = extractUrlsFromMessage(message);

    if (urls.length > 0) {
        console.log(
            "URLs found in messaging event:",
            urls
        );

        for (const rawUrl of urls) {
            const cleanUrl = cleanExtractedUrl(rawUrl);

            if (!cleanUrl) {
                continue;
            }

            // Do not treat Instagram Reel permalinks or Meta CDN URLs as creator/resource links
            if (isMetaPlatformOrCdnUrl(cleanUrl)) {
                console.log(
                    "Skipping Meta platform or CDN URL for creator link capture:",
                    cleanUrl
                );
                continue;
            }

            // Save actual creator/resource URL into the existing saved-content system
            await saveUrl(cleanUrl);

            console.log(
                "Attempting to match received URL to recent shared Instagram post..."
            );
            console.log("Incoming DM Sender ID:", senderId || "(none)");
            console.log("Incoming DM Recipient ID:", recipientId || "(none)");

            const match =
                await associateReceivedLink(
                    db,
                    {
                        senderId,
                        recipientId,
                        url: cleanUrl
                    }
                );

            if (match.matched) {
                console.log(
                    "Matched shared post: YES"
                );

                console.log(
                    "Matched media ID:",
                    match.mediaId
                );

                console.log(
                    "Creator resource URL:",
                    match.resourceUrl || match.url
                );

                console.log(
                    "Original Reel URL:",
                    match.originalUrl || "(none)"
                );

                console.log(
                    "Action status: LINK_RECEIVED"
                );
            } else {
                console.log(
                    "Matched shared post: NO (Reason:",
                    match.reason,
                    ")"
                );
                if (match.diagnostics) {
                    console.log(
                        "Association Diagnostics:",
                        JSON.stringify(match.diagnostics, null, 2)
                    );
                }
            }
        }
    }
}

app.get("/saved", async (req, res) => {
    try {
        const savedQuery = `
            SELECT
                sc.id,
                sc.url,
                sc.platform,
                sc.created_at,
                sc.checked,
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
                COALESCE(isp.original_url, isp.url) AS original_url,
                isp.resource_url,
                isp.resource_platform,
                0 AS is_shared_only,
                NULL AS shared_post_id
            FROM saved_content sc
            LEFT JOIN instagram_shared_posts isp
                ON sc.url = isp.url
                OR (isp.original_url IS NOT NULL AND sc.url = isp.original_url)
                OR (isp.resource_url IS NOT NULL AND sc.url = isp.resource_url)
            ORDER BY sc.id DESC
        `;

        const sharedOnlyQuery = `
            SELECT
                isp.id AS shared_post_id,
                isp.media_id,
                isp.media_type,
                isp.title,
                COALESCE(isp.original_url, isp.url) AS url,
                isp.original_url,
                isp.resource_url,
                isp.resource_platform,
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
                ON (isp.url IS NOT NULL AND isp.url = sc.url)
                OR (isp.original_url IS NOT NULL AND isp.original_url = sc.url)
                OR (isp.resource_url IS NOT NULL AND isp.resource_url = sc.url)
            WHERE sc.id IS NULL
            ORDER BY isp.id DESC
        `;

        const savedResult = await db.query(savedQuery);
        const sharedOnlyResult = await db.query(sharedOnlyQuery);

        const savedRows = savedResult.rows;
        const sharedOnlyRows = sharedOnlyResult.rows;

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
    async (req, res) => {
        try {
            const result =
                await db.query(`
                    SELECT
                        id,
                        media_id,
                        media_type,
                        title,
                        url,
                        original_url,
                        resource_url,
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
                `);

            res.json(result.rows);
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
    async (req, res) => {
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

        try {
            const result =
                await db.query(
                    "DELETE FROM instagram_shared_posts WHERE id = $1",
                    [id]
                );

            if (result.rowCount === 0) {
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
        } catch (error) {
            console.error(error);
            res.status(500).json({
                error:
                    "Could not delete Instagram shared post"
            });
        }
    }
);

// Webhook signature verification middleware
function verifyWebhookSignature(req, res, next) {
    const signature = req.headers['x-hub-signature-256'];
    const appSecret = process.env.META_APP_SECRET;

    if (!appSecret) {
        console.error('[WEBHOOK SECURITY] META_APP_SECRET not configured');
        return res.status(500).json({
            error: 'Webhook signature verification is not configured'
        });
    }

    if (!signature) {
        console.warn('[WEBHOOK SECURITY] Missing X-Hub-Signature-256 header');
        return res.status(403).json({
            error: 'Missing signature header'
        });
    }

    // Compute expected signature from raw body
    const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body || "");

    const expectedHash = crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)  // req.body is Buffer from express.raw()
        .digest('hex');

    const expectedSignature = `sha256=${expectedHash}`;

    // Use constant-time comparison to prevent timing attacks
    // Both buffers must have the same byte length for timingSafeEqual
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedBuf.length) {
        console.warn('[WEBHOOK SECURITY] Invalid signature');
        return res.status(403).json({
            error: 'Invalid signature'
        });
    }

    const signatureValid = crypto.timingSafeEqual(sigBuf, expectedBuf);

    if (!signatureValid) {
        console.warn('[WEBHOOK SECURITY] Invalid signature');
        return res.status(403).json({
            error: 'Invalid signature'
        });
    }

    // Parse JSON body after verification
    try {
        req.body = JSON.parse(rawBody.toString('utf8'));
        next();
    } catch (error) {
        console.error('[WEBHOOK] Failed to parse JSON body:', error);
        return res.status(400).json({
            error: 'Invalid JSON payload'
        });
    }
}

app.post("/webhook", verifyWebhookSignature, async (req, res) => {
    const entryCount = Array.isArray(req.body?.entry) ? req.body.entry.length : 0;
    console.log(
        `[WEBHOOK] Instagram webhook event received (entries: ${entryCount})`
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
                        event.message,
                        {
                            senderId:
                                event.sender
                                    ?.id,
                            recipientId:
                                event.recipient
                                    ?.id,
                            messageId:
                                event.message
                                    ?.mid
                        }
                    );
                }
            }

            const changes =
                entry.changes || [];

            for (const change of changes) {
                if (
                    change.field ===
                    "comments"
                ) {
                    await processInstagramCommentWebhook(
                        change.value
                    );
                    continue;
                }

                if (
                    change.field !==
                    "messages"
                ) {
                    continue;
                }

                const message =
                    change.value?.message;

                await processMessage(
                    message,
                    {
                        senderId:
                            change
                                .value
                                ?.sender
                                ?.id,
                        recipientId:
                            change
                                .value
                                ?.recipient
                                ?.id,
                        messageId:
                            change
                                .value
                                ?.message
                                ?.mid
                    }
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

const PORT = process.env.PORT || 3000;

async function startServer(port = (process.env.PORT || 3000)) {
    if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
        throw new Error(
            "[DATABASE CONFIG ERROR] DATABASE_URL is required to start RVAULT in production. Refusing to run with in-memory database."
        );
    }

    if (db.isInMemory) {
        if (process.env.NODE_ENV !== "test" && process.env.ALLOW_IN_MEMORY_DB !== "true") {
            throw new Error(
                "[DATABASE CONFIG ERROR] No DATABASE_URL provided. Normal RVAULT server operation requires a persistent PostgreSQL database connection.\n" +
                "To run with an ephemeral in-memory database for testing or local simulation, set ALLOW_IN_MEMORY_DB=true."
            );
        }
        console.warn(
            "\n⚠️  [DATABASE WARNING] Running with temporary in-memory PostgreSQL (pg-mem). " +
            "Data will NOT be persisted across restarts.\n"
        );
    }

    if (typeof db.initDatabase === "function") {
        await db.initDatabase();
    }

    const listenPort = Number(port) || 3000;

    const server = app.listen(listenPort, () => {
        console.log(
            `RVAULT running at http://localhost:${listenPort}`
        );

        console.log(
            "Meta action execution:",
            isMetaExecutionEnabled()
                ? "ENABLED"
                : "DISABLED"
        );

        console.log(
            `Health check available at http://localhost:${listenPort}/`
        );

        console.log(
            `Webhook endpoint at http://localhost:${listenPort}/webhook`
        );
    });

    server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            console.error(
                `\n[PORT CONFLICT] Port ${listenPort} is already in use by another running process.`
            );
            console.error(
                `To fix this, stop the existing process using port ${listenPort} before restarting.\n`
            );
        } else {
            console.error("Server error:", error);
        }
        process.exit(1);
    });

    return server;
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error("Failed to start RVAULT server:", error);
        process.exit(1);
    });
}

module.exports = {
    app,
    requireApiKey,
    verifyWebhookSignature,
    isPublicExemption,
    startServer
};