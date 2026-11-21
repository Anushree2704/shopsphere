const pool = require("../db");
const openSearchClient = require("../opensearch");

/**
 * Validates, deduplicates, and sorts cart items deterministically.
 * Sorting by product ID prevents database deadlocks during concurrent SELECT ... FOR UPDATE.
 * 
 * @param {Array} items - Array of { id, quantity } or { product_id, quantity }
 * @returns {Array} Sorted array of { id: string, quantity: number }
 */
function validateAndPrepareItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Cart items must be a non-empty array.");
    }

    const itemMap = new Map();

    for (const item of items) {
        const rawId = item.id !== undefined && item.id !== null ? item.id : item.product_id;
        const quantity = Number(item.quantity);

        if (
            rawId === undefined ||
            rawId === null ||
            !Number.isInteger(quantity) ||
            quantity <= 0
        ) {
            throw new Error("Invalid product or quantity in cart.");
        }

        const id = String(rawId);
        itemMap.set(id, (itemMap.get(id) || 0) + quantity);
    }

    return [...itemMap.entries()]
        .map(([id, quantity]) => ({ id, quantity }))
        .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Shared transactional order creation service.
 * Performs:
 * 1. Customer upsert (on conflict by email, update name & address)
 * 2. Pessimistic row locking on products (SELECT ... FOR UPDATE) and stock verification
 * 3. Total calculation
 * 4. Orders table insertion
 * 5. Order items insertion & product stock decrement
 * 
 * Must be executed within an active database transaction on `client`.
 * 
 * @param {object} client - Connected pg client inside BEGIN
 * @param {object} params - { name, email, address, items: [{ id, quantity }] }
 * @returns {Promise<object>} { order, customerId, orderItems, total }
 */
async function processOrderTransaction(client, { name, email, address, items }) {
    if (!name || !email || !address) {
        throw new Error("Please provide customer name, email and delivery address.");
    }

    const cartItems = validateAndPrepareItems(items);

    // 1. Save or retrieve customer
    const customerResult = await client.query(
        `INSERT INTO customers (name, email, address)
         VALUES ($1, $2, $3)
         ON CONFLICT (email)
         DO UPDATE SET name = EXCLUDED.name,
                       address = EXCLUDED.address
         RETURNING id`,
        [name.trim(), email.trim(), address.trim()]
    );

    const customerId = customerResult.rows[0].id;
    let total = 0;
    const orderItems = [];

    // 2. Lock products in sorted order and validate stock
    for (const item of cartItems) {
        const productResult = await client.query(
            `SELECT id, name, price, stock
             FROM products
             WHERE id = $1
             FOR UPDATE`,
            [item.id]
        );

        if (productResult.rowCount === 0) {
            throw new Error(`Product ${item.id} is not in the database.`);
        }

        const product = productResult.rows[0];

        if (product.stock < item.quantity) {
            throw new Error(
                `Insufficient stock for "${product.name || item.id}". Available: ${product.stock}, requested: ${item.quantity}.`
            );
        }

        const price = Number(product.price);
        total += price * item.quantity;

        orderItems.push({
            id: product.id,
            name: product.name,
            quantity: item.quantity,
            price
        });
    }

    // 3. Create order record
    const orderResult = await client.query(
        `INSERT INTO orders (customer_id, total, status)
         VALUES ($1, $2, 'placed')
         RETURNING id, total, status, created_at`,
        [customerId, total]
    );

    const order = orderResult.rows[0];

    // 4. Save order items and decrement product stock
    for (const item of orderItems) {
        await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, price)
             VALUES ($1, $2, $3, $4)`,
            [order.id, item.id, item.quantity, item.price]
        );

        await client.query(
            `UPDATE products
             SET stock = stock - $1
             WHERE id = $2`,
            [item.quantity, item.id]
        );
    }

    return {
        order,
        customerId,
        orderItems,
        total
    };
}

/**
 * Synchronizes updated product inventory to OpenSearch.
 * Safe to run after PostgreSQL transaction has committed.
 * Never throws an error that would undo an already completed order.
 * 
 * @param {Array<string>} productIds - Array of product IDs to sync
 */
async function syncProductsToOpenSearch(productIds) {
    if (!Array.isArray(productIds) || productIds.length === 0) return;

    try {
        const updatedProducts = await pool.query(
            `SELECT id, name, category, description, price, stock
             FROM products
             WHERE id = ANY($1::text[])`,
            [productIds.map(id => String(id))]
        );

        const body = [];
        for (const product of updatedProducts.rows) {
            body.push({
                index: {
                    _index: "shopsphere_products",
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
            const syncResult = await openSearchClient.bulk({ body });
            if (syncResult.body && syncResult.body.errors) {
                console.error("OpenSearch reported errors during stock bulk sync.");
            }
            await openSearchClient.indices.refresh({
                index: "shopsphere_products"
            });
            console.log(`OpenSearch stock synchronized for ${body.length / 2} product(s).`);
        }
    } catch (searchError) {
        console.error("OpenSearch synchronization failed:", searchError.message);
    }
}

module.exports = {
    validateAndPrepareItems,
    processOrderTransaction,
    syncProductsToOpenSearch
};
