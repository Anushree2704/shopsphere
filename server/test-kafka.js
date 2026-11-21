
const { producer } = require("./kafka");

async function testKafka() {
    try {
        await producer.connect();

        console.log("Connected to Aiven Kafka!");

        await producer.send({
            topic: "shopsphere-orders",
            messages: [
                {
                    key: "test-order-1",
                    value: JSON.stringify({
                        event: "order_placed",
                        orderId: "TEST-001",
                        product: "Samsung Galaxy Smartphone",
                        quantity: 2,
                        timestamp: new Date().toISOString()
                    })
                }
            ]
        });

        console.log("Test order event published successfully!");

    } catch (error) {
        console.error("Kafka test failed:", error.message);
    } finally {
        await producer.disconnect();
    }
}

testKafka();
