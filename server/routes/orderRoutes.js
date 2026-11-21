const express = require("express");
const router = express.Router();
const pool = require("../db");
const { publishEvent } = require("../kafka");
const {
    processOrderTransaction,
    syncProductsToOpenSearch
} = require("../services/orderService");

// Place an order (Standard individual checkout)
router.post("/", async (req, res) => {
    const { name, email, address, items } = req.body;

    if (
        !name ||
        !email ||
        !address ||
        !Array.isArray(items) ||
        items.length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Please provide customer details and cart items."
        });
    }

    let client;
    let transactionStarted = false;
    let committed = false;

    try {
        client = await pool.connect();
        await client.query("BEGIN");
        transactionStarted = true;

        // Process order creation & stock deduction using the shared service
        const { order, customerId, orderItems, total } = await processOrderTransaction(
            client,
            { name, email, address, items }
        );

        // Commit PostgreSQL transaction
        await client.query("COMMIT");
        committed = true;

        console.log("Order saved in PostgreSQL:", order.id);

        // Release DB connection immediately so OpenSearch/Kafka don't hold pool connections
        client.release();
        client = null;

        // Synchronize updated stock to OpenSearch only after successful DB commit
        await syncProductsToOpenSearch(orderItems.map(item => String(item.id)));

        // Publish order event to Kafka using persistent producer
        const eventPublished = await publishEvent("shopsphere-orders", order.id, {
            event: "order_placed",
            orderId: order.id,
            customerId,
            items: orderItems,
            total,
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: "Order placed successfully!",
            order,
            eventPublished
        });

    } catch (error) {
        if (client && transactionStarted && !committed) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback error:", rollbackError.message);
            }
        }

        console.error("Order error:", error.message);

        return res.status(400).json({
            success: false,
            message: error.message
        });

    } finally {
        if (client) {
            client.release();
        }
    }
});

module.exports = router;
