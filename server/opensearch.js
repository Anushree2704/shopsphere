
require("dotenv").config();

const { Client } = require("@opensearch-project/opensearch");

if (!process.env.OPENSEARCH_SERVICE_URI) {
    throw new Error("OpenSearch URI missing in .env");
}

const client = new Client({
    node: process.env.OPENSEARCH_SERVICE_URI
});

module.exports = client;
