require("dotenv").config();
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const { kafka } = require("./kafka");

const consumer = kafka.consumer({
    groupId: "shopsphere-order-consumer"
});

async function startConsumer() {
    try {
        await consumer.connect();
        console.log("Kafka consumer connected successfully!");

        await consumer.subscribe({
            topic: "shopsphere-orders",
            fromBeginning: true
        });

        console.log("Listening for ShopSphere order events on topic 'shopsphere-orders'...\n");

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const event = JSON.parse(message.value.toString());

                    console.log("========================================");
                    console.log(`[Kafka Event Received] Topic: ${topic} | Partition: ${partition}`);

                    switch (event.event) {
                        case "order_placed":
                            console.log(`TYPE:        STANDARD ORDER`);
                            console.log(`Order ID:    ${event.orderId}`);
                            console.log(`Customer ID: ${event.customerId}`);
                            console.log(`Total:       ₹${Number(event.total).toLocaleString("en-IN")}`);
                            console.log(`Items count: ${Array.isArray(event.items) ? event.items.length : 0}`);
                            if (Array.isArray(event.items)) {
                                event.items.forEach((item, idx) => {
                                    console.log(`  ${idx + 1}. Product #${item.id} (${item.name || "Item"}) - Qty: ${item.quantity} @ ₹${item.price}`);
                                });
                            }
                            console.log(`Timestamp:   ${event.timestamp}`);
                            break;

                        case "room_order_placed":
                            console.log(`TYPE:        SPHERESHARE GROUP ORDER`);
                            console.log(`Room Code:   ${event.roomCode} ("${event.roomName || "Shared Room"}")`);
                            console.log(`Order ID:    ${event.orderId}`);
                            console.log(`Buyer:       ${event.buyer?.name || "N/A"} <${event.buyer?.email || "N/A"}>`);
                            console.log(`Delivery:    ${event.buyer?.address || "N/A"}`);
                            console.log(`Members:     ${Array.isArray(event.members) ? event.members.join(", ") : "N/A"}`);
                            console.log(`Total:       ₹${Number(event.total).toLocaleString("en-IN")}`);
                            console.log(`Items count: ${Array.isArray(event.items) ? event.items.length : 0}`);
                            if (Array.isArray(event.items)) {
                                event.items.forEach((item, idx) => {
                                    console.log(`  ${idx + 1}. Product #${item.id} (${item.name || "Item"}) - Qty: ${item.quantity} @ ₹${item.price}`);
                                });
                            }
                            console.log(`Timestamp:   ${event.timestamp}`);
                            break;

                        default:
                            console.log(`TYPE:        UNKNOWN (${event.event || "Unspecified"})`);
                            console.log("Payload:", event);
                            break;
                    }

                    console.log("========================================\n");
                } catch (parseError) {
                    console.error("Failed to parse Kafka message JSON:", parseError.message);
                }
            }
        });
    } catch (error) {
        console.error("Consumer connection error:", error.message);
    }
}

// Graceful shutdown handling for consumer
async function handleShutdown() {
    console.log("\nDisconnecting Kafka consumer...");
    try {
        await consumer.disconnect();
        console.log("Kafka consumer disconnected.");
    } catch (err) {
        console.error("Error disconnecting Kafka consumer:", err.message);
    }
    process.exit(0);
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

startConsumer();
