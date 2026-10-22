"use strict";

const db = require("./database");
const { planAction } = require("./actionPlanner");

async function backfillActions() {
    const result = await db.query(`
        SELECT
            id,
            cta_type,
            cta_keyword
        FROM instagram_shared_posts
    `);
    const rows = result.rows;

    const client = await db.getClient();
    try {
        await client.query("BEGIN");

        for (const post of rows) {
            const plan = planAction(
                post.cta_type,
                post.cta_keyword
            );

            await client.query(
                `
                UPDATE instagram_shared_posts
                SET
                    action_type = $1,
                    action_input = $2,
                    action_status = $3
                WHERE id = $4
                `,
                [
                    plan.action,
                    plan.input,
                    plan.status,
                    post.id
                ]
            );

            console.log(
                `ID ${post.id}: ${post.cta_type || "NO_ACTION"} + ${post.cta_keyword || "-"} -> ${plan.action} + ${plan.input || "-"} + ${plan.status}`
            );
        }

        await client.query("COMMIT");
        console.log(`Updated ${rows.length} Instagram shared posts.`);
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Backfill failed, rolled back:", err);
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    backfillActions()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { backfillActions };