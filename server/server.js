
require("dotenv").config();
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const roomRoutes = require("./routes/roomRoutes");
const { connectProducer, disconnectProducer } = require("./kafka");

console.log("Order routes loaded:", typeof orderRoutes);
console.log("Room routes loaded:", typeof roomRoutes);

app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/rooms", roomRoutes);

app.get("/", (req, res) => {
    res.json({ message: "Welcome to ShopSphere API!" });
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, async () => {
    console.log(`ShopSphere server running on port ${PORT}`);
    // Connect Kafka producer once at startup without blocking server if broker is slow/offline
    connectProducer().catch(err => {
        console.error("Kafka initial connection error:", err.message);
    });
});

// Graceful shutdown handling
async function handleShutdown(signal) {
    console.log(`\nReceived ${signal}. Closing ShopSphere server gracefully...`);
    server.close(async () => {
        console.log("HTTP server closed.");
        await disconnectProducer();
        process.exit(0);
    });
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
