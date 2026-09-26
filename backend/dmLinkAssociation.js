const MATCH_WINDOW_DAYS = 7;

function cleanExtractedUrl(url) {
    if (!url || typeof url !== "string") {
        return null;
    }

    const cleaned = url.replace(/[),.!?]+$/g, "").trim();

    return cleaned || null;
}

function isMetaPlatformOrCdnUrl(url) {
    if (!url || typeof url !== "string") {
        return false;
    }

    try {
        const hostname = new URL(url).hostname.toLowerCase();

        return (
            hostname === "instagram.com" ||
            hostname.endsWith(".instagram.com") ||
            hostname === "instagr.am" ||
            hostname.endsWith(".instagr.am") ||
            hostname === "cdninstagram.com" ||
            hostname.endsWith(".cdninstagram.com") ||
            hostname === "facebook.com" ||
            hostname.endsWith(".facebook.com") ||
            hostname === "fb.com" ||
            hostname.endsWith(".fb.com") ||
            hostname === "fb.me" ||
            hostname.endsWith(".fb.me") ||
            hostname === "fbsbx.com" ||
            hostname.endsWith(".fbsbx.com")
        );
    } catch (error) {
        return /(?:instagram|instagr\.am|cdninstagram|facebook|fb\.com|fb\.me|fbsbx)\.com/i.test(
            url
        );
    }
}

// Retain alias for existing callers
function isInstagramHostedUrl(url) {
    return isMetaPlatformOrCdnUrl(url);
}

function hasRealExternalUrl(url) {
    if (!url || typeof url !== "string") {
        return false;
    }

    const trimmed = url.trim();

    if (!trimmed) {
        return false;
    }

    return !isMetaPlatformOrCdnUrl(trimmed);
}

function hasActionableCta(row) {
    const keyword = String(row?.cta_keyword || "").trim();

    if (keyword) {
        return true;
    }

    const ctaType = String(
        row?.cta_type || "NO_ACTION"
    ).toUpperCase();

    if (ctaType && ctaType !== "NO_ACTION") {
        return true;
    }

    const actionType = String(
        row?.action_type || "NONE"
    ).toUpperCase();

    return (
        actionType !== "NONE" &&
        actionType !== "NO_ACTION"
    );
}

function isWithinMatchWindow(receivedAt, now, windowDays) {
    if (!receivedAt) {
        return false;
    }

    const receivedMs = Date.parse(
        String(receivedAt).replace(" ", "T")
    );

    if (Number.isNaN(receivedMs)) {
        return false;
    }

    const cutoffMs =
        now.getTime() -
        windowDays * 24 * 60 * 60 * 1000;

    return receivedMs >= cutoffMs;
}

function findMatchingSharedPost(
    db,
    {
        senderId,
        recipientId,
        now = new Date(),
        windowDays = MATCH_WINDOW_DAYS
    }
) {
    const diagnostics = {
        incomingSenderId: senderId || null,
        incomingRecipientId: recipientId || null,
        candidatesEvaluated: 0,
        candidates: [],
        matchedPostId: null,
        failureReason: null
    };

    if (!senderId && !recipientId) {
        diagnostics.failureReason = "NO_IDENTITY_PROVIDED";
        return { post: null, diagnostics };
    }

    // Inspect recent shared posts ordered by newest first
    const rows = db.prepare(`
        SELECT
            id,
            media_id,
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
        FROM instagram_shared_posts
        ORDER BY datetime(received_at) DESC, id DESC
        LIMIT 25
    `).all();

    diagnostics.candidatesEvaluated = rows.length;

    for (const row of rows) {
        const candidateInfo = {
            id: row.id,
            mediaId: row.media_id,
            postSenderId: row.sender_id,
            postRecipientId: row.recipient_id || null,
            ctaKeyword: row.cta_keyword,
            actionStatus: row.action_status,
            receivedAt: row.received_at,
            status: "INSPECTING",
            reason: null
        };

        // 1. Identity Check
        // Matches if:
        // - Direct user match: post.sender_id === incoming senderId (User shared Reel, User sent link)
        // - Conversation partner match: post.sender_id === incoming recipientId (User shared Reel, Page/Bot sent link to that User)
        const isSenderMatch = Boolean(
            senderId &&
            row.sender_id &&
            String(row.sender_id) === String(senderId)
        );

        const isRecipientMatch = Boolean(
            recipientId &&
            row.sender_id &&
            String(row.sender_id) === String(recipientId)
        );

        const isIdentityMatch = isSenderMatch || isRecipientMatch;

        if (!isIdentityMatch) {
            candidateInfo.status = "REJECTED";
            candidateInfo.reason = `SENDER_MISMATCH (post sender: ${row.sender_id}, post recipient: ${row.recipient_id || "none"} vs incoming sender: ${senderId || "none"}, recipient: ${recipientId || "none"})`;
            diagnostics.candidates.push(candidateInfo);
            continue;
        }

        // 2. Window Check
        if (!isWithinMatchWindow(row.received_at, now, windowDays)) {
            candidateInfo.status = "REJECTED";
            candidateInfo.reason = `EXPIRED_WINDOW (${row.received_at} is older than ${windowDays} days)`;
            diagnostics.candidates.push(candidateInfo);
            continue;
        }

        // 3. Actionable CTA Check
        if (!hasActionableCta(row)) {
            candidateInfo.status = "REJECTED";
            candidateInfo.reason = `NO_ACTIONABLE_CTA (cta_type=${row.cta_type}, cta_keyword=${row.cta_keyword})`;
            diagnostics.candidates.push(candidateInfo);
            continue;
        }

        // 4. Existing Resource URL Check
        if (hasRealExternalUrl(row.resource_url)) {
            candidateInfo.status = "REJECTED";
            candidateInfo.reason = `ALREADY_HAS_RESOURCE_URL (${row.resource_url})`;
            diagnostics.candidates.push(candidateInfo);
            continue;
        }

        if (hasRealExternalUrl(row.url)) {
            candidateInfo.status = "REJECTED";
            candidateInfo.reason = `ALREADY_HAS_EXTERNAL_URL (${row.url})`;
            diagnostics.candidates.push(candidateInfo);
            continue;
        }

        // All checks passed!
        candidateInfo.status = "MATCHED";
        candidateInfo.reason = `Matched identity (${isSenderMatch ? "SAME_SENDER" : "CONVERSATION_RECIPIENT_MATCH"}: post_sender=${row.sender_id})`;
        diagnostics.candidates.push(candidateInfo);
        diagnostics.matchedPostId = row.id;

        return { post: row, diagnostics, ...row };
    }

    diagnostics.failureReason = "NO_QUALIFYING_CANDIDATE";
    return { post: null, diagnostics };
}

function associateReceivedLink(
    db,
    {
        senderId,
        recipientId,
        url,
        now = new Date(),
        windowDays = MATCH_WINDOW_DAYS
    }
) {
    const cleaned = cleanExtractedUrl(url);

    if (!cleaned) {
        return {
            matched: false,
            reason: "NO_URL",
            mediaId: null,
            url: null,
            diagnostics: null
        };
    }

    if (isMetaPlatformOrCdnUrl(cleaned)) {
        return {
            matched: false,
            reason: "META_PLATFORM_OR_CDN_URL",
            mediaId: null,
            url: cleaned,
            diagnostics: null
        };
    }

    if (!senderId && !recipientId) {
        return {
            matched: false,
            reason: "NO_IDENTITY",
            mediaId: null,
            url: cleaned,
            diagnostics: {
                failureReason: "NO_IDENTITY_PROVIDED"
            }
        };
    }

    const { post, diagnostics } = findMatchingSharedPost(db, {
        senderId,
        recipientId,
        now,
        windowDays
    });

    if (!post) {
        return {
            matched: false,
            reason: "NO_MATCH",
            mediaId: null,
            url: cleaned,
            diagnostics
        };
    }

    // Preserve the original Reel URL in original_url & url; save creator link into resource_url
    db.prepare(`
        UPDATE instagram_shared_posts
        SET resource_url = ?,
            action_status = 'LINK_RECEIVED',
            original_url = COALESCE(
                original_url,
                CASE
                    WHEN url LIKE '%instagram.com%' OR url LIKE '%instagr.am%'
                    THEN url
                    ELSE NULL
                END
            )
        WHERE id = ?
    `).run(cleaned, post.id);

    return {
        matched: true,
        reason: "MATCHED",
        mediaId: post.media_id,
        url: cleaned,
        resourceUrl: cleaned,
        originalUrl:
            post.original_url ||
            (isMetaPlatformOrCdnUrl(post.url) ? post.url : null),
        sharedPostId: post.id,
        diagnostics
    };
}

module.exports = {
    MATCH_WINDOW_DAYS,
    associateReceivedLink,
    cleanExtractedUrl,
    findMatchingSharedPost,
    hasActionableCta,
    hasRealExternalUrl,
    isInstagramHostedUrl,
    isMetaPlatformOrCdnUrl
};
