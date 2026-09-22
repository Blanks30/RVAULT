import { useEffect, useState } from "react";

function App() {
    const [savedContent, setSavedContent] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [deletingId, setDeletingId] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");

    const fetchSavedContent = async () => {
        try {
            setLoading(true);
            setError("");

            const response = await fetch("http://localhost:3000/saved");

            if (!response.ok) {
                throw new Error("Failed to fetch saved content");
            }

            const data = await response.json();

            setSavedContent(data);
        } catch (err) {
            console.error(err);
            setError("Could not connect to RVAULT backend.");
        } finally {
            setLoading(false);
        }
    };

    const deleteContent = async (id) => {
        const confirmed = window.confirm(
            "Are you sure you want to delete this saved content?"
        );

        if (!confirmed) {
            return;
        }

        try {
            setDeletingId(id);

            const response = await fetch(
                `http://localhost:3000/saved/${id}`,
                {
                    method: "DELETE"
                }
            );

            if (!response.ok) {
                throw new Error("Failed to delete content");
            }

            setSavedContent((currentContent) =>
                currentContent.filter((item) => item.id !== id)
            );
        } catch (err) {
            console.error(err);
            setError("Could not delete the content.");
        } finally {
            setDeletingId(null);
        }
    };

    useEffect(() => {
        fetchSavedContent();
    }, []);

    const filteredContent = savedContent.filter((item) =>
        item.url.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const instagramCount = savedContent.filter(
        (item) => item.platform === "Instagram"
    ).length;

    return (
        <div className="app">
            <header className="header">
                <div>
                    <h1>RVAULT</h1>
                    <p>Your saved social-media content</p>
                </div>

                <button onClick={fetchSavedContent}>
                    Refresh
                </button>
            </header>

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
                </section>

                <section className="content-section">
                    <div className="section-header">
                        <div>
                            <h2>Saved Content</h2>

                            <span>
                                {filteredContent.length} of{" "}
                                {savedContent.length} items
                            </span>
                        </div>

                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search saved URLs..."
                            value={searchTerm}
                            onChange={(event) =>
                                setSearchTerm(event.target.value)
                            }
                        />
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
                        filteredContent.length === 0 && (
                            <div className="message">
                                No content matches your search.
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        filteredContent.length > 0 && (
                            <div className="content-grid">
                                {filteredContent.map((item) => (
                                    <article
                                        className="content-card"
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
                                            Saved {item.platform ||
                                                "Social"} Content
                                        </h3>

                                        <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
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
                                                    deleteContent(
                                                        item.id
                                                    )
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
