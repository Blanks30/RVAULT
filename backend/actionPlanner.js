function planAction(ctaType, ctaKeyword) {
    const type = (ctaType || "NO_ACTION").toUpperCase();
    const keyword = ctaKeyword
        ? ctaKeyword.toUpperCase()
        : null;

    switch (type) {
        case "COMMENT":
            return {
                action: "COMMENT",
                input: keyword,
                status: keyword ? "READY" : "NEEDS_INPUT"
            };

        case "DM":
            return {
                action: "DM",
                input: keyword,
                status: keyword ? "READY" : "NEEDS_INPUT"
            };

        case "FOLLOW_AND_DM":
            return {
                action: "FOLLOW_AND_DM",
                input: keyword,
                status: keyword ? "READY" : "NEEDS_INPUT"
            };

        case "LIKE":
            return {
                action: "LIKE",
                input: null,
                status: "READY"
            };

        case "BIO_LINK":
            return {
                action: "BIO_LINK",
                input: null,
                status: "READY"
            };

        case "NO_ACTION":
        default:
            return {
                action: "NONE",
                input: null,
                status: "NO_ACTION"
            };
    }
}

module.exports = {
    planAction
};