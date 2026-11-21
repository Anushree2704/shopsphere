require("dotenv").config();
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("fs");
const path = require("path");
const { Kafka, Partitioners } = require("kafkajs");

const caPath = path.join(__dirname, "certs", "ca.pem");

const kafka = new Kafka({
    clientId: "shopsphere",
    brokers: [process.env.KAFKA_BROKER],
    ssl: {
        ca: [fs.readFileSync(caPath, "utf-8")]
    },
    sasl: {
        mechanism: "plain",
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD
    },
    connectionTimeout: 10000,
    requestTimeout: 30000
});

// Configure producer with legacy partitioner to silence KafkaJS v2 partitioner warning
const producer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner
});

let isConnected = false;
let connectPromise = null;

/**
 * Connects the Kafka producer once and keeps it alive.
 * Safe to call concurrently; subsequent callers share the same connection promise.
 * Does not throw so that API startup is never blocked by Kafka outages.
 * 
 * @returns {Promise<boolean>} Whether connection succeeded
 */
async function connectProducer() {
    if (isConnected) return true;
    if (connectPromise) return connectPromise;

    connectPromise = (async () => {
        try {
            await producer.connect();
            isConnected = true;
            console.log("Connected to Aiven Kafka successfully!");
            return true;
        } catch (error) {
            isConnected = false;
            console.error("Kafka producer connection failed:", error.message);
            return false;
        } finally {
            connectPromise = null;
        }
    })();

    return connectPromise;
}

/**
 * Disconnects the Kafka producer cleanly during application shutdown.
 */
async function disconnectProducer() {
    if (!isConnected) return;
    try {
        await producer.disconnect();
        isConnected = false;
        console.log("Kafka producer disconnected cleanly.");
    } catch (error) {
        console.error("Kafka disconnect error:", error.message);
    }
}

/**
 * Publishes an event to a Kafka topic using the persistent producer.
 * Will attempt to connect if not yet connected.
 * Never throws an unhandled error so that already committed orders are not undone.
 * 
 * @param {string} topic - Kafka topic (default: "shopsphere-orders")
 * @param {string|number} key - Message key (e.g. order ID)
 * @param {object} payload - Message payload object to JSON stringify
 * @returns {Promise<boolean>} True if published successfully, false otherwise
 */
async function publishEvent(topic, key, payload) {
    const targetTopic = topic || "shopsphere-orders";

    if (!isConnected) {
        const connected = await connectProducer();
        if (!connected) {
            console.warn(`Kafka producer unavailable. Event not published for key: ${key}`);
            return false;
        }
    }

    try {
        await producer.send({
            topic: targetTopic,
            messages: [
                {
                    key: String(key),
                    value: JSON.stringify(payload)
                }
            ]
        });
        console.log(`Kafka event published to ${targetTopic} [Key: ${key}]`);
        return true;
    } catch (error) {
        console.error(`Failed to publish Kafka event [Topic: ${targetTopic}, Key: ${key}]:`, error.message);
        return false;
    }
}

module.exports = {
    kafka,
    producer,
    connectProducer,
    disconnectProducer,
    publishEvent
};
