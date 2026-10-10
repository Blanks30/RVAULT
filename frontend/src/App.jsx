import { useEffect, useState } from "react";

// API base URL: use environment variable in production, localhost in development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// API token helpers
// The API_SECRET is stored in localStorage (key: rvault_api_token).
// It is entered once by the user via a setup prompt and never baked into
// the bundle.  On 401 responses the token is cleared and the prompt re-shows.
// ---------------------------------------------------------------------------
const TOKEN_KEY = "rvault_api_token";

function getStoredToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
function storeToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ }
}
function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

/** Build fetch options that always include the Authorization header. */
function authFetch(url, options = {}) {
    const token = getStoredToken();
    return fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
    });
}

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
    const [selectedCheckedFilter, setSelectedCheckedFilter] = useState("All");
    const [sortBy, setSortBy] = useState("newest");
    const [showAddForm, setShowAddForm] = useState(false);
    const [newUrl, setNewUrl] = useState("");
    const [addingResource, setAddingResource] = useState(false);
    const [addError, setAddError] = useState(null);
    const [togglingId, setTogglingId] = useState(null);

    // Token setup prompt state
    const [tokenPrompt, setTokenPrompt] = useState(!getStoredToken());
    const [tokenInput, setTokenInput] = useState("");

    function handleTokenSave(e) {
        e.preventDefault();
        const trimmed = tokenInput.trim();
        if (!trimmed) return;
        storeToken(trimmed);
        setTokenInput("");
        setTokenPrompt(false);
        fetchSavedContent();
    }

    function handleClearToken() {
        clearToken();
        setTokenPrompt(true);
    }

    const fetchSavedContent = async () => {
        try {
            setLoading(true);
            setError("");

            const response = await authFetch(`${API_BASE_URL}/saved`);

            if (response.status === 401) {
                clearToken();
                setTokenPrompt(true);
                setLoading(false);
                return;
            }
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
                endpoint = `${API_BASE_URL}/instagram/shared-posts/${item.shared_post_id}`;
            } else {
                endpoint = `${API_BASE_URL}/saved/${item.id}`;
            }

            const response = await authFetch(endpoint, { method: "DELETE" });
            if (response.status === 401) {
                clearToken();
                setTokenPrompt(true);
                setDeletingId(null);
                return;
            }

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

    const toggleChecked = async (item) => {
        // Shared-only items don't have checked state (no saved_content row)
        if (item.is_shared_only) {
            return;
        }

        const newCheckedState = !item.checked;

        try {
            setTogglingId(item.id);

            const response = await authFetch(`${API_BASE_URL}/saved/${item.id}/toggle`, {
                method: "PATCH",
                body: JSON.stringify({ checked: newCheckedState })
            });
            if (response.status === 401) {
                clearToken();
                setTokenPrompt(true);
                setTogglingId(null);
                return;
            }

            if (!response.ok) {
                throw new Error("Failed to toggle checked state");
            }

            setSavedContent((currentContent) =>
                currentContent.map((c) =>
                    c.id === item.id ? { ...c, checked: newCheckedState ? 1 : 0 } : c
                )
            );
        } catch (err) {
            console.error(err);
            setError("Could not update checked state.");
        } finally {
            setTogglingId(null);
        }
    };

    const handleAddResource = async (e) => {
        e.preventDefault();
        if (!newUrl.trim()) return;

        setAddingResource(true);
        setAddError(null);

        try {
            const response = await authFetch(`${API_BASE_URL}/save`, {
                method: "POST",
                body: JSON.stringify({ url: newUrl.trim() })
            });
            if (response.status === 401) {
                clearToken();
                setTokenPrompt(true);
                setAddingResource(false);
                return;
            }

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

        const matchesChecked =
            selectedCheckedFilter === "All" ||
            (selectedCheckedFilter === "Unchecked" && !item.checked) ||
            (selectedCheckedFilter === "Checked" && item.checked);

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

        return matchesPlatform && matchesStatus && matchesChecked && matchesSearch;
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

    // Count unchecked items (excluding shared-only items)
    const uncheckedCount = savedContent.filter(
        (item) => !item.is_shared_only && !item.checked
    ).length;

    const getCheckedFilterCount = (filter) => {
        if (filter === "All") {
            return savedContent.length;
        }
        if (filter === "Unchecked") {
            return savedContent.filter((item) => !item.is_shared_only && !item.checked).length;
        }
        if (filter === "Checked") {
            return savedContent.filter((item) => !item.is_shared_only && item.checked).length;
        }
        return 0;
    };

    // Show token setup prompt before rendering main app
    if (tokenPrompt) {
        return (
            <div className="app">
                <div className="token-setup-overlay">
                    <div className="token-setup-modal">
                        <h2>RVAULT — Enter API Token</h2>
                        <p>
                            Enter the <strong>API_SECRET</strong> configured on the backend.
                            It will be stored in your browser&apos;s local storage and sent
                            on every request.
                        </p>
                        <form onSubmit={handleTokenSave}>
                            <input
                                id="rvault-token-input"
                                type="password"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder="Paste your API token here"
                                autoFocus
                                required
                            />
                            <button type="submit">Save Token &amp; Continue</button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

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
                    <button
                            id="rvault-clear-token"
                            onClick={handleClearToken}
                            style={{ fontSize: "0.75rem", opacity: 0.7 }}
                        >
                            Clear Token
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

                    <div className="stat-card">
                        <span>Unchecked Items</span>
                        <strong>{uncheckedCount}</strong>
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

                    <div className="platform-filters">
                        {["All", "Unchecked", "Checked"].map((filter) => (
                            <button
                                key={filter}
                                className={`filter-button ${
                                    selectedCheckedFilter === filter
                                        ? "active"
                                        : ""
                                }`}
                                onClick={() =>
                                    setSelectedCheckedFilter(filter)
                                }
                            >
                                {filter}
                                <span>
                                    {getCheckedFilterCount(filter)}
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
                                        {!item.is_shared_only && (
                                            <label className="checkbox-label checkbox-top">
                                                <input
                                                    type="checkbox"
                                                    checked={!!item.checked}
                                                    onChange={() => toggleChecked(item)}
                                                    disabled={togglingId === item.id}
                                                />
                                                <span>{item.checked ? "Checked" : "Unchecked"}</span>
                                            </label>
                                        )}

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
