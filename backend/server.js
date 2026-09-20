const express = require("express");
const contentRoutes = require("./routes/content");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("RVAULT is running!");
});

app.use("/", contentRoutes);

app.listen(3000, () => {
    console.log("RVAULT running at http://localhost:3000");
});