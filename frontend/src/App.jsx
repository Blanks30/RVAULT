import { useEffect, useState } from "react";

// Human-readable labels and colour classes for action_status values
const STATUS_META = {
    LINK_RECEIVED: { label: "Link Received", cls: "status-link-received" },
    EXECUTED:      { label: "Executed",      cls: "status-executed"      },
    DRY_RUN:       { label: "Dry Run",       cls: "status-dry-run"       },
    DM_SENT:       { label: "DM Sent",       cls: "status-dm-sent"       },
    READY:         { label: "Ready",         cls: "status-ready"         },
    RECEIVED:      { label: "Received",      cls: "status-received"      },
    BLOCKED:       { label: "Blocked",       cls: "status-blocked"       },
    FAILED:        { label: "Failed",        cls: "status-failed"        },
    NEEDS_INPUT:   { label: "Needs Input",   cls: "status-needs-input"   },
    NO_ACTION:     { label: "No Action",     cls: "status-no-action"     },
};

function ActionStatusBadge({ status }) {
    if (!status || status === "NO_ACTION") return null;
    const meta = STATUS_META[status] || { label: status, cls: "status-unknown" };
    return <span className={`action-status-badge ${meta.cls}`}>{meta.label}</span>;
}

function ResourceLink({ url }) {
    if (!url) return null;

    // Derive a short human-readable label from the URL
    let displayLabel = url;
    try {
        const u = new URL(url);
        displayLabel = u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
        if (displayLabel.length > 55) displayLabel = displayLabel.slice(0, 52) + "…";
    } catch {
        if (url.length > 55) displayLabel = url.slice(0, 52) + "…";
    }

    return (
        <div className="resource-link-box">
            <span className="resource-link-label">Resource Link</span>
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="resource-link-url"
                title={url}
            >
                {displayLabel}
            </a>
        </div>
    );
}

function App() {
    const [savedContent, setSavedContent] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [deletingId, setDeletingId] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedPlatform, setSelectedPlatform] = useState("All");
    const [selectedStatus, setSelectedStatus] = useState("All");
    const [sortBy, setSortBy] = useState("newest");
    const [showAddForm, setShowAddForm] = useState(false);
    const [newUrl, setNewUrl] = useState("");
    const [addingResource, setAddingResource] = useState(false);
    const [addError, setAddError] = useState(null);

    const fetchSavedContent = async () => {
        try {
            setLoading(true);
            setError("");

            const response = await fetch("http://localhost:3000/saved");

            if (!response.ok) {
                throw new Error("Failed to fetch saved content");
            }

            const data = await response.json();

            // Deduplicate by id (backend LEFT JOIN can create duplicates)
            const seen = new Map();
            const deduped = [];
            for (const item of data) {
                if (!seen.has(item.id)) {
                    seen.set(item.id, true);
                    deduped.push(item);
                }
            }

            setSavedContent(deduped);
        } catch (err) {
            console.error(err);
            setError("Could not connect to RVAULT backend.");
        } finally {
            setLoading(false);
        }
    };

    const deleteContent = async (item) => {
        const confirmed = window.confirm(
            "Are you sure you want to delete this saved content?"
        );

        if (!confirmed) {
            return;
        }

        try {
            setDeletingId(item.id);

            // Shared-only items (id = "shared-N") have no saved_content row.
            // They must be deleted via /instagram/shared-posts/:shared_post_id.
            // Regular items use /saved/:id.
            let endpoint;
            if (item.is_shared_only && item.shared_post_id) {
                endpoint = `http://localhost:3000/instagram/shared-posts/${item.shared_post_id}`;
            } else {
                endpoint = `http://localhost:3000/saved/${item.id}`;
            }

            const response = await fetch(endpoint, { method: "DELETE" });

            if (!response.ok) {
                throw new Error("Failed to delete content");
            }

            setSavedContent((currentContent) =>
                currentContent.filter((c) => c.id !== item.id)
            );
        } catch (err) {
            console.error(err);
            setError("Could not delete the content.");
        } finally {
            setDeletingId(null);
        }
    };

    const handleAddResource = async (e) => {
        e.preventDefault();
        if (!newUrl.trim()) return;

        setAddingResource(true);
        setAddError(null);

        try {
            const response = await fetch("http://localhost:3000/api/content/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: newUrl.trim() })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Failed to save resource");
            }

            setNewUrl("");
            setShowAddForm(false);
            await fetchSavedContent();
        } catch (err) {
            console.error(err);
            setAddError(err.message);
        } finally {
            setAddingResource(false);
        }
    };

    useEffect(() => {
        fetchSavedContent();
    }, []);

    const platforms = [
        "All",
        "Instagram",
        "YouTube",
        "TikTok",
        "Reddit",
        "Unknown"
    ];

    // Extract unique status values from savedContent
    const statuses = ["All", ...Array.from(
        new Set(
            savedContent
                .map((item) => item.action_status)
                .filter(Boolean)
        )
    ).sort()];

    const getPlatformCount = (platform) => {
        if (platform === "All") {
            return savedContent.length;
        }

        return savedContent.filter(
            (item) => (item.platform || "Unknown") === platform
        ).length;
    };

    const getStatusCount = (status) => {
        if (status === "All") {
            return savedContent.length;
        }

        return savedContent.filter(
            (item) => item.action_status === status
        ).length;
    };

    const filteredContent = savedContent.filter((item) => {
        const platform = item.platform || "Unknown";

        const matchesPlatform =
            selectedPlatform === "All" ||
            platform === selectedPlatform;

        const matchesStatus =
            selectedStatus === "All" ||
            (item.action_status && item.action_status.trim() === selectedStatus.trim());

        const searchableText = [
            item.url,
            item.resource_url,
            item.title,
            item.media_id,
            item.cta_type,
            item.cta_keyword
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        const matchesSearch = searchableText.includes(
            searchTerm.toLowerCase()
        );

        return matchesPlatform && matchesStatus && matchesSearch;
    });

    // Sort filtered content
    const sortedContent = [...filteredContent].sort((a, b) => {
        if (sortBy === "newest") {
            const dateA = new Date(a.created_at || a.received_at || 0).getTime();
            const dateB = new Date(b.created_at || b.received_at || 0).getTime();
            return dateB - dateA;
        }
        if (sortBy === "oldest") {
            const dateA = new Date(a.created_at || a.received_at || 0).getTime();
            const dateB = new Date(b.created_at || b.received_at || 0).getTime();
            return dateA - dateB;
        }
        if (sortBy === "status") {
            const statusA = a.action_status || "";
            const statusB = b.action_status || "";
            return statusA.localeCompare(statusB);
        }
        if (sortBy === "platform") {
            const platformA = a.platform || "Unknown";
            const platformB = b.platform || "Unknown";
            return platformA.localeCompare(platformB);
        }
        return 0;
    });

    const instagramCount = savedContent.filter(
        (item) => item.platform === "Instagram"
    ).length;

    // Count items that have a resource link attached
    const resourceCount = savedContent.filter(
        (item) => item.resource_url
    ).length;

    return (
        <div className="app">
            <header className="header">
                <div>
                    <h1>RVAULT</h1>
                    <p>Your saved social-media content</p>
                </div>

                <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setShowAddForm(!showAddForm)}>
                        {showAddForm ? "Cancel" : "+ Add Resource"}
                    </button>
                    <button onClick={fetchSavedContent}>
                        Refresh
                    </button>
                </div>
            </header>

            {showAddForm && (
                <div className="add-resource-form">
                    <h3>Add Resource</h3>
                    <form onSubmit={handleAddResource}>
                        <input
                            type="url"
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            placeholder="Enter resource URL (YouTube, GitHub, etc.)"
                            required
                            disabled={addingResource}
                        />
                        {addError && <div className="form-error">{addError}</div>}
                        <button type="submit" disabled={addingResource}>
                            {addingResource ? "Saving..." : "Save Resource"}
                        </button>
                    </form>
                </div>
            )}

            <main>
                <section className="stats">
                    <div className="stat-card">
                        <span>Total Saved</span>
                        <strong>{savedContent.length}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Instagram</span>
                        <strong>{instagramCount}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Resources Captured</span>
                        <strong>{resourceCount}</strong>
                    </div>
                </section>

                <section className="content-section">
                    <div className="section-header">
                        <div>
                            <h2>Saved Content</h2>

                            <span>
                                {sortedContent.length} of{" "}
                                {savedContent.length} items
                            </span>
                        </div>

                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search saved content..."
                                value={searchTerm}
                                onChange={(event) =>
                                    setSearchTerm(event.target.value)
                                }
                            />
                            <select
                                className="sort-select"
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                            >
                                <option value="newest">Newest</option>
                                <option value="oldest">Oldest</option>
                                <option value="status">Status</option>
                                <option value="platform">Platform</option>
                            </select>
                        </div>
                    </div>

                    <div className="platform-filters">
                        {platforms.map((platform) => (
                            <button
                                key={platform}
                                className={`filter-button ${
                                    selectedPlatform === platform
                                        ? "active"
                                        : ""
                                }`}
                                onClick={() =>
                                    setSelectedPlatform(platform)
                                }
                            >
                                {platform}
                                <span>
                                    {getPlatformCount(platform)}
                                </span>
                            </button>
                        ))}
                    </div>

                    <div className="platform-filters">
                        {statuses.map((status) => (
                            <button
                                key={status}
                                className={`filter-button ${
                                    selectedStatus === status
                                        ? "active"
                                        : ""
                                }`}
                                onClick={() =>
                                    setSelectedStatus(status)
                                }
                            >
                                {STATUS_META[status]?.label || status}
                                <span>
                                    {getStatusCount(status)}
                                </span>
                            </button>
                        ))}
                    </div>

                    {loading && (
                        <div className="message">
                            Loading saved content...
                        </div>
                    )}

                    {error && (
                        <div className="message error">
                            {error}
                        </div>
                    )}

                    {!loading &&
                        !error &&
                        savedContent.length === 0 && (
                            <div className="message">
                                No saved content yet.
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        savedContent.length > 0 &&
                        sortedContent.length === 0 && (
                            <div className="message">
                                No content matches your filters.
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        sortedContent.length > 0 && (
                            <div className="content-grid">
                                {sortedContent.map((item) => (
                                    <article
                                        className={`content-card${item.resource_url ? " has-resource" : ""}`}
                                        key={item.id}
                                    >
                                        <div className="card-top">
                                            <span className="platform">
                                                {item.platform ||
                                                    "Unknown"}
                                            </span>

                                            <span className="date">
                                                {new Date(
                                                    item.created_at
                                                ).toLocaleString()}
                                            </span>
                                        </div>

                                        <h3>
                                            {item.title ||
                                                `Saved ${
                                                    item.platform ||
                                                    "Social"
                                                } Content`}
                                        </h3>

                                        <div className="card-badges">
                                            {item.media_type ===
                                                "ig_reel" && (
                                                <span className="content-type">
                                                    Instagram Reel
                                                </span>
                                            )}

                                            {item.media_type ===
                                                "ig_post" && (
                                                <span className="content-type">
                                                    Instagram Post
                                                </span>
                                            )}

                                            <ActionStatusBadge
                                                status={item.action_status}
                                            />
                                        </div>

                                        {item.cta_type &&
                                            item.cta_type !==
                                                "NO_ACTION" && (
                                            <div className="cta-box">
                                                <div>
                                                    <strong>
                                                        CTA
                                                    </strong>
                                                    <span>
                                                        {
                                                            item.cta_type
                                                        }
                                                    </span>
                                                </div>

                                                {item.cta_keyword && (
                                                    <div>
                                                        <strong>
                                                            Keyword
                                                        </strong>
                                                        <span>
                                                            {
                                                                item.cta_keyword
                                                            }
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Resource Link — the captured creator URL */}
                                        <ResourceLink url={item.resource_url} />

                                        {/* Source URL — the original Instagram post/reel */}
                                        <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="source-url"
                                        >
                                            {item.url}
                                        </a>

                                        <div className="card-footer">
                                            <span>
                                                ID #{item.id}
                                            </span>

                                            <button
                                                className="delete-button"
                                                onClick={() =>
                                                    deleteContent(item)
                                                }
                                                disabled={
                                                    deletingId ===
                                                    item.id
                                                }
                                            >
                                                {deletingId ===
                                                item.id
                                                    ? "Deleting..."
                                                    : "Delete"}
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                </section>
            </main>
        </div>
    );
}

export default App;
