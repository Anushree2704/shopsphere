
const pool = require("./db");

async function testOrder() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Find Samsung and lock its stock record
        const product = await client.query(
            "SELECT * FROM products WHERE id = $1 FOR UPDATE",
            ["1"]
        );

        if (product.rowCount === 0) {
            throw new Error("Samsung product not found!");
        }

        const quantity = 2;

        if (product.rows[0].stock < quantity) {
            throw new Error("Insufficient stock!");
        }

        // Create a test customer
        const customer = await client.query(
            `INSERT INTO customers (name, email, address)
             VALUES ($1, $2, $3)
             ON CONFLICT (email)
             DO UPDATE SET name = EXCLUDED.name,
                           address = EXCLUDED.address
             RETURNING id`,
            ["Demo Customer", "demo@shopsphere.test", "Mysuru, Karnataka"]
        );

        // Create order
        const order = await client.query(
            `INSERT INTO orders (customer_id, total)
             VALUES ($1, $2)
             RETURNING id, total, status`,
            [customer.rows[0].id, Number(product.rows[0].price) * quantity]
        );

        // Save order item
        await client.query(
            `INSERT INTO order_items
             (order_id, product_id, quantity, price)
             VALUES ($1, $2, $3, $4)`,
            [order.rows[0].id, "1", quantity, product.rows[0].price]
        );

        // Reduce stock
        await client.query(
            "UPDATE products SET stock = stock - $1 WHERE id = $2",
            [quantity, "1"]
        );

        await client.query("COMMIT");

        console.log("Test order placed successfully!");
        console.log("Order details:", order.rows[0]);
        console.log("Quantity purchased:", quantity);
        console.log("Remaining stock:", product.rows[0].stock - quantity);

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Order test failed:", error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

testOrder();
