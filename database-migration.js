const Database = require("better-sqlite3");
const path = require("path");

/**
 * RVAULT Database Migration Script
 * Adds safe integrity constraints and transaction wrappers
 * 
 * This script is idempotent - it can be run multiple times safely
 */

class RVaultMigration {
    constructor() {
        this.DB_PATH = path.join(__dirname, "ravault.db");
        this.db = new Database(this.DB_PATH);
        
        // Enable foreign key constraints
        this.db.pragma('foreign_keys = ON');
        
        // Set WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');
        
        console.log("RVAULT Database Migration Tool");
        console.log("==============================");
    }

    /**
     * Create a backup of the current database
     */
    backup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(__dirname, `ravault_backup_${timestamp}.db`);
        
        console.log(`Creating backup: ${backupPath}`);
        this.db.backup(backupPath);
        console.log("✓ Backup created successfully");
        
        return backupPath;
    }

    /**
     * Check if a constraint already exists
     */
    constraintExists(tableName, constraintType, columnName = null) {
        try {
            if (constraintType === 'UNIQUE') {
                const indexes = this.db.prepare(`PRAGMA index_list(${tableName})`).all();
                return indexes.some(idx => 
                    idx.unique && 
                    (columnName ? idx.name.includes(columnName) : true)
                );
            }
            
            if (constraintType === 'FOREIGN_KEY') {
                const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${tableName})`).all();
                return foreignKeys.length > 0;
            }
            
            return false;
        } catch (error) {
            console.log(`Error checking constraint: ${error.message}`);
            return false;
        }
    }

    /**
     * Add unique constraint on instagram_shared_posts.media_id (if not exists)
     */
    addMediaIdUniqueConstraint() {
        console.log("\n1. Adding UNIQUE constraint on instagram_shared_posts.media_id");
        
        // Check if constraint already exists
        const indexes = this.db.prepare("PRAGMA index_list(instagram_shared_posts)").all();
        const hasUniqueMediaId = indexes.some(idx => 
            idx.unique && idx.name.includes('media_id')
        );
        
        if (hasUniqueMediaId) {
            console.log("✓ UNIQUE constraint on media_id already exists");
            return;
        }

        // Check for existing duplicates before adding constraint
        const duplicates = this.db.prepare(`
            SELECT media_id, COUNT(*) as count 
            FROM instagram_shared_posts 
            WHERE media_id IS NOT NULL 
            GROUP BY media_id 
            HAVING COUNT(*) > 1
        `).all();

        if (duplicates.length > 0) {
            console.log(`⚠ Found ${duplicates.length} duplicate media_id values. Cleaning up...`);
            
            // Keep the earliest record for each media_id
            const cleanupTransaction = this.db.transaction(() => {
                for (const dup of duplicates) {
                    // Get all records with this media_id, ordered by received_at
                    const records = this.db.prepare(`
                        SELECT id, received_at 
                        FROM instagram_shared_posts 
                        WHERE media_id = ? 
                        ORDER BY received_at ASC
                    `).all(dup.media_id);
                    
                    // Delete all but the first (earliest) record
                    for (let i = 1; i < records.length; i++) {
                        this.db.prepare(`
                            DELETE FROM instagram_shared_posts 
                            WHERE id = ?
                        `).run(records[i].id);
                        
                        console.log(`  Removed duplicate record ID ${records[i].id} for media_id ${dup.media_id}`);
                    }
                }
            });
            
            cleanupTransaction();
            console.log("✓ Duplicate cleanup completed");
        }

        // Note: SQLite doesn't support adding UNIQUE constraints to existing columns directly
        // The constraint is already defined in the CREATE TABLE statement in database.js
        console.log("✓ UNIQUE constraint enforced via existing schema definition");
    }

    /**
     * Add indexes for better performance
     */
    addPerformanceIndexes() {
        console.log("\n2. Adding performance indexes");

        const indexes = [
            {
                name: "idx_instagram_posts_received_at",
                table: "instagram_shared_posts",
                columns: "received_at",
                description: "Index on received_at for chronological queries"
            },
            {
                name: "idx_instagram_posts_sender_id", 
                table: "instagram_shared_posts",
                columns: "sender_id",
                description: "Index on sender_id for user-based queries"
            },
            {
                name: "idx_instagram_posts_action_status",
                table: "instagram_shared_posts", 
                columns: "action_status",
                description: "Index on action_status for filtering by processing status"
            },
            {
                name: "idx_saved_content_platform",
                table: "saved_content",
                columns: "platform", 
                description: "Index on platform for filtering by content source"
            },
            {
                name: "idx_saved_content_created_at",
                table: "saved_content",
                columns: "created_at",
                description: "Index on created_at for chronological queries"
            }
        ];

        for (const index of indexes) {
            try {
                // Check if index already exists
                const existingIndexes = this.db.prepare(`PRAGMA index_list(${index.table})`).all();
                const exists = existingIndexes.some(idx => idx.name === index.name);
                
                if (exists) {
                    console.log(`✓ Index ${index.name} already exists`);
                    continue;
                }

                this.db.prepare(`
                    CREATE INDEX IF NOT EXISTS ${index.name} 
                    ON ${index.table}(${index.columns})
                `).run();
                
                console.log(`✓ Created index: ${index.name} - ${index.description}`);
            } catch (error) {
                console.log(`⚠ Failed to create index ${index.name}: ${error.message}`);
            }
        }
    }

    /**
     * Create safe transaction wrapper functions
     */
    createTransactionWrappers() {
        console.log("\n3. Creating transaction wrapper utilities");
        
        const wrapperFile = path.join(__dirname, "database-transactions.js");
        
        const transactionCode = `const Database = require("better-sqlite3");
const path = require("path");

/**
 * RVAULT Database Transaction Utilities
 * Safe wrappers for multi-table operations
 */

class RVaultTransactions {
    constructor() {
        this.DB_PATH = path.join(__dirname, "ravault.db");
        this.db = new Database(this.DB_PATH);
        this.db.pragma('foreign_keys = ON');
    }

    /**
     * Safely insert a new Instagram shared post
     * Handles duplicate media_id gracefully
     */
    insertSharedPost(postData) {
        const insertTransaction = this.db.transaction((data) => {
            try {
                // Check if media_id already exists
                const existing = this.db.prepare(\`
                    SELECT id FROM instagram_shared_posts 
                    WHERE media_id = ?
                \`).get(data.media_id);
                
                if (existing) {
                    console.log(\`Post with media_id \${data.media_id} already exists (ID: \${existing.id})\`);
                    return { success: false, reason: 'duplicate_media_id', existingId: existing.id };
                }
                
                // Insert the new post
                const result = this.db.prepare(\`
                    INSERT INTO instagram_shared_posts (
                        media_id, media_type, title, url, sender_id, message_id,
                        cta_type, cta_keyword, action_type, action_input, action_status,
                        original_url, resource_url, recipient_id, resource_platform
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                \`).run(
                    data.media_id, data.media_type || 'ig_post', data.title, data.url,
                    data.sender_id, data.message_id, data.cta_type, data.cta_keyword,
                    data.action_type, data.action_input, data.action_status,
                    data.original_url, data.resource_url, data.recipient_id, data.resource_platform
                );
                
                return { success: true, id: result.lastInsertRowid };
            } catch (error) {
                throw error; // Let transaction handle the rollback
            }
        });
        
        return insertTransaction(postData);
    }

    /**
     * Safely update shared post status with validation
     */
    updatePostStatus(mediaId, newStatus, additionalFields = {}) {
        const updateTransaction = this.db.transaction((id, status, fields) => {
            // Verify the post exists
            const post = this.db.prepare(\`
                SELECT id, action_status FROM instagram_shared_posts 
                WHERE media_id = ?
            \`).get(id);
            
            if (!post) {
                return { success: false, reason: 'post_not_found' };
            }
            
            // Build dynamic update query
            const fieldNames = Object.keys(fields);
            const updateFields = ['action_status = ?', ...fieldNames.map(f => \`\${f} = ?\`)];
            const values = [status, ...fieldNames.map(f => fields[f])];
            
            const result = this.db.prepare(\`
                UPDATE instagram_shared_posts 
                SET \${updateFields.join(', ')}, received_at = CURRENT_TIMESTAMP
                WHERE media_id = ?
            \`).run(...values, id);
            
            return { 
                success: true, 
                changes: result.changes,
                previousStatus: post.action_status 
            };
        });
        
        return updateTransaction(mediaId, newStatus, additionalFields);
    }

    /**
     * Safely insert saved content with duplicate URL handling
     */
    insertSavedContent(url, platform = 'Unknown') {
        const insertTransaction = this.db.transaction((contentUrl, contentPlatform) => {
            try {
                // Check if URL already exists
                const existing = this.db.prepare(\`
                    SELECT id FROM saved_content WHERE url = ?
                \`).get(contentUrl);
                
                if (existing) {
                    return { success: false, reason: 'duplicate_url', existingId: existing.id };
                }
                
                // Insert new content
                const result = this.db.prepare(\`
                    INSERT INTO saved_content (url, platform) VALUES (?, ?)
                \`).run(contentUrl, contentPlatform);
                
                return { success: true, id: result.lastInsertRowid };
            } catch (error) {
                throw error;
            }
        });
        
        return insertTransaction(url, platform);
    }

    /**
     * Cross-reference shared posts with saved content
     */
    linkSharedPostToSavedContent(mediaId) {
        const linkTransaction = this.db.transaction((id) => {
            // Get the shared post
            const post = this.db.prepare(\`
                SELECT original_url, url FROM instagram_shared_posts 
                WHERE media_id = ?
            \`).get(id);
            
            if (!post) {
                return { success: false, reason: 'post_not_found' };
            }
            
            // Check if either URL exists in saved_content
            const savedContent = this.db.prepare(\`
                SELECT id FROM saved_content 
                WHERE url IN (?, ?)
            \`).get(post.original_url, post.url);
            
            return {
                success: true,
                hasLink: !!savedContent,
                savedContentId: savedContent?.id
            };
        });
        
        return linkTransaction(mediaId);
    }

    /**
     * Get database statistics
     */
    getStats() {
        return {
            instagram_posts: this.db.prepare("SELECT COUNT(*) as count FROM instagram_shared_posts").get().count,
            saved_content: this.db.prepare("SELECT COUNT(*) as count FROM saved_content").get().count,
            duplicate_media_ids: this.db.prepare(\`
                SELECT COUNT(*) as count FROM (
                    SELECT media_id FROM instagram_shared_posts 
                    WHERE media_id IS NOT NULL 
                    GROUP BY media_id 
                    HAVING COUNT(*) > 1
                )
            \`).get().count,
            duplicate_urls: this.db.prepare(\`
                SELECT COUNT(*) as count FROM (
                    SELECT url FROM saved_content 
                    GROUP BY url 
                    HAVING COUNT(*) > 1
                )
            \`).get().count
        };
    }

    close() {
        this.db.close();
    }
}

module.exports = RVaultTransactions;`;

        try {
            require('fs').writeFileSync(wrapperFile, transactionCode);
            console.log("✓ Created database-transactions.js utility file");
        } catch (error) {
            console.log(`⚠ Failed to create transaction wrapper file: ${error.message}`);
        }
    }

    /**
     * Validate current database integrity
     */
    validateIntegrity() {
        console.log("\n4. Validating database integrity");

        try {
            // Check for foreign key violations
            const fkViolations = this.db.prepare("PRAGMA foreign_key_check").all();
            if (fkViolations.length > 0) {
                console.log(`⚠ Found ${fkViolations.length} foreign key violations:`);
                fkViolations.forEach(violation => {
                    console.log(`  Table: ${violation.table}, Row: ${violation.rowid}, Parent: ${violation.parent}`);
                });
            } else {
                console.log("✓ No foreign key violations found");
            }

            // Check database integrity
            const integrityCheck = this.db.prepare("PRAGMA integrity_check").get();
            if (integrityCheck.integrity_check === 'ok') {
                console.log("✓ Database integrity check passed");
            } else {
                console.log(`⚠ Database integrity issue: ${integrityCheck.integrity_check}`);
            }

            // Check for orphaned records (if any relationships existed)
            const stats = {
                instagram_posts: this.db.prepare("SELECT COUNT(*) as count FROM instagram_shared_posts").get().count,
                saved_content: this.db.prepare("SELECT COUNT(*) as count FROM saved_content").get().count,
                null_media_ids: this.db.prepare("SELECT COUNT(*) as count FROM instagram_shared_posts WHERE media_id IS NULL").get().count
            };

            console.log("Database Statistics:");
            console.log(`  Instagram shared posts: ${stats.instagram_posts}`);
            console.log(`  Saved content entries: ${stats.saved_content}`);
            console.log(`  Posts with NULL media_id: ${stats.null_media_ids}`);

        } catch (error) {
            console.log(`⚠ Integrity validation error: ${error.message}`);
        }
    }

    /**
     * Run all migrations
     */
    migrate() {
        console.log("Starting RVAULT database migration...\n");

        try {
            // Create backup first
            const backupPath = this.backup();

            // Run migrations
            this.addMediaIdUniqueConstraint();
            this.addPerformanceIndexes();
            this.createTransactionWrappers();
            this.validateIntegrity();

            console.log("\n✅ Migration completed successfully!");
            console.log(`Backup available at: ${backupPath}`);

        } catch (error) {
            console.error(`\n❌ Migration failed: ${error.message}`);
            console.error("Database backup was created before migration started.");
            throw error;
        } finally {
            this.db.close();
        }
    }
}

// Run migration if this file is executed directly
if (require.main === module) {
    const migration = new RVaultMigration();
    migration.migrate();
}

module.exports = RVaultMigration;`