function detectCTA(text) {
    if (!text || typeof text !== "string") {
        return {
            type: "NO_ACTION",
            keyword: null
        };
    }

    const normalizedText = text
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    if (
        /\bfollow\b/.test(normalizedText) &&
        /\b(dm|message|direct message)\b/.test(normalizedText)
    ) {
        const keywordMatch = normalizedText.match(
            /\b(?:dm|message me|send me a dm)\s+["']?([a-z0-9_-]{2,30})["']?\b/i
        );

        return {
            type: "FOLLOW_AND_DM",
            keyword: keywordMatch
                ? keywordMatch[1].toUpperCase()
                : null
        };
    }

    if (
        /\b(comment|comment below|drop|type)\b/.test(normalizedText)
    ) {
        const keywordMatch = normalizedText.match(
            /\b(?:comment|type|drop)\s+["']?([a-z0-9_-]{2,30})["']?\b/i
        );

        return {
            type: "COMMENT",
            keyword: keywordMatch
                ? keywordMatch[1].toUpperCase()
                : null
        };
    }

    if (
        /\b(dm|send me a dm|message me|direct message)\b/.test(
            normalizedText
        )
    ) {
        const keywordMatch = normalizedText.match(
            /\b(?:dm|message me|send me a dm)\s+["']?([a-z0-9_-]{2,30})["']?\b/i
        );

        return {
            type: "DM",
            keyword: keywordMatch
                ? keywordMatch[1].toUpperCase()
                : null
        };
    }

    if (
        /\blink\s+in\s+(my\s+)?bio\b/.test(normalizedText) ||
        /\bcheck\s+(my\s+)?bio\b/.test(normalizedText)
    ) {
        return {
            type: "BIO_LINK",
            keyword: null
        };
    }

    if (
        /\blike\b/.test(normalizedText) &&
        (
            /\blink\b/.test(normalizedText) ||
            /\bsend\b/.test(normalizedText) ||
            /\bdm\b/.test(normalizedText)
        )
    ) {
        return {
            type: "LIKE",
            keyword: null
        };
    }

    return {
        type: "NO_ACTION",
        keyword: null
    };
}

module.exports = {
    detectCTA
};