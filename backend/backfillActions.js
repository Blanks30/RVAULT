const db = require("./database");
const { planAction } = require("./actionPlanner");

const rows = db.prepare(`
    SELECT
        id,
        cta_type,
        cta_keyword
    FROM instagram_shared_posts
`).all();

const update = db.prepare(`
    UPDATE instagram_shared_posts
    SET
        action_type = ?,
        action_input = ?,
        action_status = ?
    WHERE id = ?
`);

const updateMany = db.transaction((posts) => {
    for (const post of posts) {
        const plan = planAction(
            post.cta_type,
            post.cta_keyword
        );

        update.run(
            plan.action,
            plan.input,
            plan.status,
            post.id
        );

        console.log(
            `ID ${post.id}: ${post.cta_type || "NO_ACTION"} + ${post.cta_keyword || "-"} -> ${plan.action} + ${plan.input || "-"} + ${plan.status}`
        );
    }
});

updateMany(rows);

console.log(
    `Updated ${rows.length} Instagram shared posts.`
);