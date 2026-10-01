const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "ravault.db");
const db = new Database(DB_PATH);

console.log("=== RVAULT DATABASE SCHEMA INSPECTION ===\n");

// 1. Get all table schemas
console.log("1. TABLE SCHEMAS:");
console.log("================");

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const table of tables) {
    console.log(`\nTable: ${table.name}`);
    console.log("Schema:");
    const schema = db.prepare(`PRAGMA table_info(${table.name})`).all();
    schema.forEach(col => {
        const nullable = col.notnull ? "NOT NULL" : "NULL";
        const pk = col.pk ? " PRIMARY KEY" : "";
        const defaultVal = col.dflt_value ? ` DEFAULT ${col.dflt_value}` : "";
        console.log(`  ${col.name}: ${col.type}${pk} ${nullable}${defaultVal}`);
    });
    
    // Check for indexes
    const indexes = db.prepare(`PRAGMA index_list(${table.name})`).all();
    if (indexes.length > 0) {
        console.log("Indexes:");
        indexes.forEach(idx => {
            const indexInfo = db.prepare(`PRAGMA index_info(${idx.name})`).all();
            const columns = indexInfo.map(i => i.name).join(", ");
            const unique = idx.unique ? "UNIQUE " : "";
            console.log(`  ${unique}INDEX ${idx.name} ON ${table.name}(${columns})`);
        });
    }
    
    // Get foreign keys
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${table.name})`).all();
    if (foreignKeys.length > 0) {
        console.log("Foreign Keys:");
        foreignKeys.forEach(fk => {
            console.log(`  ${fk.from} REFERENCES ${fk.table}(${fk.to})`);
        });
    }
}

// 2. Check for duplicate media_id values in instagram_shared_posts
console.log("\n\n2. DATA INTEGRITY ANALYSIS:");
console.log("===========================");

try {
    // Count total rows
    const totalRows = db.prepare("SELECT COUNT(*) as count FROM instagram_shared_posts").get();
    console.log(`Total instagram_shared_posts records: ${totalRows.count}`);
    
    // Check for duplicate media_id values
    const duplicates = db.prepare(`
        SELECT media_id, COUNT(*) as count 
        FROM instagram_shared_posts 
        WHERE media_id IS NOT NULL 
        GROUP BY media_id 
        HAVING COUNT(*) > 1
        ORDER BY count DESC
    `).all();
    
    if (duplicates.length > 0) {
        console.log(`\nDUPLICATE MEDIA_IDs found: ${duplicates.length} unique values with duplicates`);
        duplicates.forEach(dup => {
            console.log(`  media_id: ${dup.media_id} appears ${dup.count} times`);
        });
        
        // Show details of first few duplicates
        console.log("\nSample duplicate records:");
        for (let i = 0; i < Math.min(3, duplicates.length); i++) {
            const records = db.prepare(`
                SELECT id, media_id, received_at, sender_id, title 
                FROM instagram_shared_posts 
                WHERE media_id = ?
                ORDER BY received_at
            `).all(duplicates[i].media_id);
            
            console.log(`\n  Records for media_id '${duplicates[i].media_id}':`);
            records.forEach(rec => {
                console.log(`    ID: ${rec.id}, received: ${rec.received_at}, sender: ${rec.sender_id}, title: ${rec.title?.substring(0, 50) || 'NULL'}...`);
            });
        }
    } else {
        console.log("\nNo duplicate media_id values found.");
    }
    
    // Check for NULL media_id values
    const nullMediaIds = db.prepare("SELECT COUNT(*) as count FROM instagram_shared_posts WHERE media_id IS NULL").get();
    if (nullMediaIds.count > 0) {
        console.log(`\nNULL media_id values: ${nullMediaIds.count} records`);
    }
    
    // Check saved_content table
    const savedContentRows = db.prepare("SELECT COUNT(*) as count FROM saved_content").get();
    console.log(`\nTotal saved_content records: ${savedContentRows.count}`);
    
    // Check for duplicate URLs in saved_content
    const urlDuplicates = db.prepare(`
        SELECT url, COUNT(*) as count 
        FROM saved_content 
        GROUP BY url 
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 10
    `).all();
    
    if (urlDuplicates.length > 0) {
        console.log(`\nDUPLICATE URLs in saved_content: ${urlDuplicates.length} unique URLs with duplicates`);
        urlDuplicates.forEach(dup => {
            console.log(`  url: ${dup.url.substring(0, 80)}... appears ${dup.count} times`);
        });
    } else {
        console.log("\nNo duplicate URLs found in saved_content.");
    }
    
} catch (error) {
    console.error("Error analyzing data:", error.message);
}

console.log("\n=== END OF INSPECTION ===");

db.close();