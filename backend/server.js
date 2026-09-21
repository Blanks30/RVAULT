require("dotenv").config();

const express = require("express");
const contentRoutes = require("./routes/content");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("RVAULT is running!");
});

app.get("/instagram/status", (req, res) => {
    if (!process.env.INSTAGRAM_ACCESS_TOKEN) {
        return res.status(500).json({
            connected: false,
            error: "Instagram access token is missing"
        });
    }

    res.json({
        connected: true,
        message: "Instagram access token is loaded!"
    });
});

app.use("/", contentRoutes);

app.listen(3000, () => {
    console.log("RVAULT running at http://localhost:3000");
});