
const client = require("./opensearch");
const pool = require("./db");

async function setupProducts() {
    try {
        const indexName = "shopsphere_products";

        const exists = await client.indices.exists({
            index: indexName
        });

        if (!exists.body) {
            await client.indices.create({
                index: indexName
            });
            console.log("Product index created!");
        }

        await client.indices.putMapping({
            index: indexName,
            body: {
                properties: {
                    name: { type: "text" },
                    category: { type: "keyword" },
                    description: { type: "text" },
                    price: { type: "float" },
                    stock: { type: "integer" }
                }
            }
        });

        const result = await pool.query(
            `SELECT id, name, category, description, price, stock
             FROM products`
        );

        const body = [];

        for (const product of result.rows) {
            body.push({
                index: {
                    _index: indexName,
                    _id: String(product.id)
                }
            });

            body.push({
                name: product.name,
                category: product.category,
                description: product.description,
                price: Number(product.price),
                stock: Number(product.stock)
            });
        }

        if (body.length > 0) {
            const indexed = await client.bulk({ body });

            if (indexed.body.errors) {
                throw new Error("Some products could not be indexed");
            }
        }

        await client.indices.refresh({ index: indexName });

        console.log(`${result.rows.length} PostgreSQL products synchronized to OpenSearch!`);

    } catch (error) {
        console.error("Synchronization error:", error.message);
    } finally {
        await pool.end();
        await client.close();
    }
}

setupProducts();
