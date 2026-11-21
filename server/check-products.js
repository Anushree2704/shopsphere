
const pool = require("./db");

async function checkProducts() {
    try {
        const result = await pool.query(
            "SELECT * FROM products ORDER BY id"
        );

        console.log("Products currently in PostgreSQL:");
        console.table(result.rows);
        console.log("Total products:", result.rowCount);

    } catch (error) {
        console.error("Error:", error.message);
    } finally {
        await pool.end();
    }
}

checkProducts();
