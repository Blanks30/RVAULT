require("dotenv").config();

const META_API_VERSION = "v26.0";
const META_GRAPH_URL = "https://graph.instagram.com";

function getAccessToken() {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!token) {
        throw new Error(
            "INSTAGRAM_ACCESS_TOKEN is missing from .env"
        );
    }

    return token.trim();
}

function checkActionSupport(actionType) {
    const action = (actionType || "NONE").toUpperCase();

    const supportedActions = new Set([
        "NONE",
        "COMMENT"
    ]);

    if (supportedActions.has(action)) {
        return {
            supported: true,
            action,
            requiresMetaExecution: action === "COMMENT"
        };
    }

    return {
        supported: false,
        action,
        reason:
            "This action is not implemented in RVAULT."
    };
}

async function executeInstagramComment({
    mediaId,
    comment
}) {
    if (!mediaId) {
        return {
            success: false,
            status: "FAILED",
            action: "COMMENT",
            message: "Instagram media ID is missing."
        };
    }

    if (!comment) {
        return {
            success: false,
            status: "FAILED",
            action: "COMMENT",
            mediaId,
            message: "Comment text is missing."
        };
    }

    let accessToken;

    try {
        accessToken = getAccessToken();
    } catch (error) {
        return {
            success: false,
            status: "FAILED",
            action: "COMMENT",
            mediaId,
            message: error.message
        };
    }

    const endpoint =
        `${META_GRAPH_URL}/${META_API_VERSION}/${encodeURIComponent(mediaId)}/comments`;

    try {
        const body = new URLSearchParams();

        body.append("message", comment);
        body.append("access_token", accessToken);

        const response = await fetch(
            endpoint,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                body
            }
        );

        const data = await response.json();

        if (!response.ok || data.error) {
            console.error(
                "Meta COMMENT API error:",
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

            return {
                success: false,
                status: "FAILED",
                action: "COMMENT",
                mediaId,
                input: comment,
                message:
                    data?.error?.message ||
                    "Instagram comment request failed.",
                errorCode:
                    data?.error?.code || null,
                errorSubcode:
                    data?.error?.error_subcode || null,
                metaResponse: data
            };
        }

        return {
            success: true,
            status: "EXECUTED",
            action: "COMMENT",
            mediaId,
            input: comment,
            commentId: data.id || null,
            message:
                "Comment posted successfully to Instagram."
        };
    } catch (error) {
        console.error(
            "Instagram COMMENT request failed:",
            error
        );

        return {
            success: false,
            status: "FAILED",
            action: "COMMENT",
            mediaId,
            input: comment,
            message: error.message
        };
    }
}

async function executeAction(actionPlan) {
    const actionType = (
        actionPlan?.action || "NONE"
    ).toUpperCase();

    const support = checkActionSupport(
        actionType
    );

    if (!support.supported) {
        return {
            success: false,
            status: "UNSUPPORTED",
            action: actionType,
            input:
                actionPlan?.input || null,
            mediaId:
                actionPlan?.mediaId || null,
            message: support.reason
        };
    }

    if (actionType === "NONE") {
        return {
            success: true,
            status: "NO_ACTION",
            action: "NONE",
            input: null,
            mediaId: null,
            message:
                "No action required."
        };
    }

    if (actionType === "COMMENT") {
        return executeInstagramComment({
            mediaId:
                actionPlan?.mediaId,
            comment:
                actionPlan?.input
        });
    }

    return {
        success: false,
        status: "NOT_IMPLEMENTED",
        action: actionType,
        input:
            actionPlan?.input || null,
        mediaId:
            actionPlan?.mediaId || null,
        message:
            "Action is not implemented."
    };
}

module.exports = {
    checkActionSupport,
    executeAction,
    executeInstagramComment
};