
const pool = require("./db");

async function seedProducts() {
    try {
        await pool.query(
            `INSERT INTO products
             (id, name, category, description, price, stock)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id)
             DO UPDATE SET
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                description = EXCLUDED.description,
                price = EXCLUDED.price`,
            [
                "1",
                "Samsung Galaxy Smartphone",
                "Electronics",
                "Latest smartphone with excellent camera",
                25000,
                10
            ]
        );

        console.log("Samsung product added to PostgreSQL!");
        console.log("Initial stock: 10");

    } catch (error) {
        console.error("Product insertion failed:", error.message);
    } finally {
        await pool.end();
    }
}

seedProducts();
