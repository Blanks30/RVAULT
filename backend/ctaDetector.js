function detectCTA(text) {
    if (!text || typeof text !== "string") {
        return {
            type: "NO_ACTION",
            keyword: null
        };
    }

    const normalizedText = text
        .replace(/\s+/g, " ")
        .trim();

    const lowerText = normalizedText.toLowerCase();

    // 1. FOLLOW_AND_DM
    if (
        /\bfollow\b/i.test(normalizedText) &&
        /\b(dm|message|direct message)\b/i.test(normalizedText)
    ) {
        const quotedMatch = normalizedText.match(
            /\b(?:dm|message me|send me a dm|direct message me)\s*(?:the\s+word|the\s+words|the\s+keyword|word|words|keyword)?\s*[:\-–—]?\s*["'“”‘’]([a-z0-9][a-z0-9_-]{0,29})["'“”‘’]/i
        );

        if (quotedMatch && quotedMatch[1].trim()) {
            return {
                type: "FOLLOW_AND_DM",
                keyword: quotedMatch[1].trim().toUpperCase()
            };
        }

        const keywordMatch = normalizedText.match(
            /\b(?:dm|message me|send me a dm|direct message me)\s*(?:the\s+word|the\s+words|the\s+keyword|word|words|keyword)?\s*[:\-–—]?\s*["'“”‘’]?([a-z0-9][a-z0-9_-]{0,29})["'“”‘’]?\b/i
        );

        const candidate = keywordMatch ? keywordMatch[1].trim() : null;
        const stopWords = new Set(["the", "a", "an", "word", "words", "keyword", "me", "for"]);

        return {
            type: "FOLLOW_AND_DM",
            keyword: candidate && !stopWords.has(candidate.toLowerCase())
                ? candidate.toUpperCase()
                : null
        };
    }

    // 2. COMMENT / DROP / TYPE
    if (/\b(comment|comment below|drop|type|reply)\b/i.test(normalizedText)) {
        // A. Priority: Quoted keyword after verb and optional filler phrases
        // e.g. Drop the word “Free”, Type “VIDEO” below, Comment “SETUP”
        const quotedMatch = normalizedText.match(
            /\b(?:comment|drop|type|reply)(?:\s+(?:below|down\s+below|down|here|me|us))?(?:\s+(?:the\s+word|the\s+words|the\s+keyword|word|words|keyword))?\s*[:\-–—]?\s*["'“”‘’]([a-z0-9][a-z0-9_-]{0,29})["'“”‘’]/i
        );

        if (quotedMatch && quotedMatch[1].trim()) {
            return {
                type: "COMMENT",
                keyword: quotedMatch[1].trim().toUpperCase()
            };
        }

        // B. Explicit "word/keyword" prefix without quotes
        // e.g. Drop the word Free, Comment the word Link
        const wordPrefixMatch = normalizedText.match(
            /\b(?:comment|drop|type|reply)(?:\s+(?:below|down\s+below|down|here|me|us))?\s+(?:the\s+word|the\s+words|the\s+keyword|word|words|keyword)\s*[:\-–—]?\s*["'“”‘’]?([a-z0-9][a-z0-9_-]{0,29})["'“”‘’]?/i
        );

        if (wordPrefixMatch && wordPrefixMatch[1].trim()) {
            const candidate = wordPrefixMatch[1].trim();
            const stopWords = new Set(["the", "a", "an", "word", "words", "keyword", "below", "down"]);
            if (!stopWords.has(candidate.toLowerCase())) {
                return {
                    type: "COMMENT",
                    keyword: candidate.toUpperCase()
                };
            }
        }

        // C. Standard Comment / Drop / Type + keyword
        // e.g. Comment VIDEO, Drop VIDEO for the link, Comment TEST if you want the link, Comment MIMO and I will send you the setup
        const standardMatch = normalizedText.match(
            /\b(?:comment|drop|type|reply)(?:\s+(?:below|down\s+below))?\s*[:\-–—]?\s*["'“”‘’]?([a-z0-9][a-z0-9_-]{0,29})["'“”‘’]?\b/i
        );

        if (standardMatch && standardMatch[1].trim()) {
            const candidate = standardMatch[1].trim();
            const stopWords = new Set([
                "the", "a", "an", "this", "that", "these", "those",
                "word", "words", "keyword", "keywords",
                "below", "down", "for", "to", "and", "or", "in", "it"
            ]);
            if (!stopWords.has(candidate.toLowerCase())) {
                return {
                    type: "COMMENT",
                    keyword: candidate.toUpperCase()
                };
            }
        }

        return {
            type: "COMMENT",
            keyword: null
        };
    }

    // 3. DM / MESSAGE
    if (
        /\b(dm|send me a dm|message me|direct message)\b/i.test(
            normalizedText
        )
    ) {
        const quotedMatch = normalizedText.match(
            /\b(?:dm|message me|send me a dm|direct message me)\s*(?:the\s+word|the\s+words|the\s+keyword|word|words|keyword)?\s*[:\-–—]?\s*["'“”‘’]([a-z0-9][a-z0-9_-]{0,29})["'“”‘’]/i
        );

        if (quotedMatch && quotedMatch[1].trim()) {
            return {
                type: "DM",
                keyword: quotedMatch[1].trim().toUpperCase()
            };
        }

        const keywordMatch = normalizedText.match(
            /\b(?:dm|message me|send me a dm|direct message me)\s*(?:the\s+word|the\s+words|the\s+keyword|word|words|keyword)?\s*[:\-–—]?\s*["'“”‘’]?([a-z0-9][a-z0-9_-]{0,29})["'“”‘’]?\b/i
        );

        const candidate = keywordMatch ? keywordMatch[1].trim() : null;
        const stopWords = new Set(["the", "a", "an", "word", "words", "keyword", "me", "for"]);

        return {
            type: "DM",
            keyword: candidate && !stopWords.has(candidate.toLowerCase())
                ? candidate.toUpperCase()
                : null
        };
    }

    // 4. BIO_LINK
    if (
        /\blink\s+in\s+(my\s+)?bio\b/i.test(lowerText) ||
        /\bcheck\s+(my\s+)?bio\b/i.test(lowerText)
    ) {
        return {
            type: "BIO_LINK",
            keyword: null
        };
    }

    // 5. LIKE
    if (
        /\blike\b/i.test(lowerText) &&
        (
            /\blink\b/i.test(lowerText) ||
            /\bsend\b/i.test(lowerText) ||
            /\bdm\b/i.test(lowerText)
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