const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const pool = require("../db");
const { publishEvent } = require("../kafka");
const {
    processOrderTransaction,
    syncProductsToOpenSearch
} = require("../services/orderService");

// Helper to generate a unique readable room code
function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "SPHERE-";
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ----------------------------------------------------
// 1. CREATE A ROOM
// POST /api/rooms
// Body: { name, hostName } (or { roomName, hostName })
// ----------------------------------------------------
router.post("/", async (req, res) => {
    try {
        const rawName = req.body.name || req.body.roomName;
        const rawHost = req.body.hostName || req.body.memberName;

        if (!rawName || !rawHost || !rawName.trim() || !rawHost.trim()) {
            return res.status(400).json({
                success: false,
                message: "Room name and host name are required."
            });
        }

        const roomName = rawName.trim();
        const hostName = rawHost.trim();

        let room = null;
        let attempts = 0;

        // Generate unique code with collision retry
        while (!room && attempts < 5) {
            attempts++;
            const roomCode = generateRoomCode();

            try {
                const roomResult = await pool.query(
                    `INSERT INTO rooms (code, name, host_name, status)
                     VALUES ($1, $2, $3, 'active')
                     RETURNING id, code, name, host_name, status, created_at`,
                    [roomCode, roomName, hostName]
                );
                room = roomResult.rows[0];
            } catch (err) {
                // If unique constraint on code violated, loop and retry
                if (err.code === "23505" && attempts < 5) {
                    continue;
                }
                throw err;
            }
        }

        if (!room) {
            return res.status(500).json({
                success: false,
                message: "Failed to generate a unique room code. Please try again."
            });
        }

        // Add creator as host member
        await pool.query(
            `INSERT INTO room_members (room_id, member_name, is_host)
             VALUES ($1, $2, true)
             ON CONFLICT (room_id, member_name) DO NOTHING`,
            [room.id, hostName]
        );

        return res.status(201).json({
            success: true,
            message: "Room created successfully!",
            room: {
                id: room.id,
                code: room.code,
                name: room.name,
                hostName: room.host_name,
                status: room.status,
                createdAt: room.created_at
            }
        });

    } catch (error) {
        console.error("Create room error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create room: " + error.message
        });
    }
});

// ----------------------------------------------------
// 2. JOIN A ROOM
// POST /api/rooms/join
// Body: { code, memberName } (or { roomCode, memberName })
// ----------------------------------------------------
router.post("/join", async (req, res) => {
    let client;
    try {
        const rawCode = req.body.code || req.body.roomCode;
        const rawMember = req.body.memberName || req.body.name;

        if (!rawCode || !rawMember || !rawCode.trim() || !rawMember.trim()) {
            return res.status(400).json({
                success: false,
                message: "Room code and member name are required."
            });
        }

        const roomCode = rawCode.trim().toUpperCase();
        const memberName = rawMember.trim();

        client = await pool.connect();
        await client.query("BEGIN");

        // Lock room row to serialize concurrent joins against checkout
        const roomResult = await client.query(
            `SELECT id, code, name, host_name, status, created_at
             FROM rooms
             WHERE UPPER(code) = $1
             FOR UPDATE`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: `Room with code ${roomCode} was not found.`
            });
        }

        const room = roomResult.rows[0];

        if (room.status === "checked_out") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "This room has already been checked out and closed."
            });
        }

        if (room.status !== "active") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: `Room is not active (status: ${room.status}).`
            });
        }

        // Insert member if not already joined
        await client.query(
            `INSERT INTO room_members (room_id, member_name, is_host)
             VALUES ($1, $2, false)
             ON CONFLICT (room_id, member_name) DO NOTHING`,
            [room.id, memberName]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "Joined room successfully!",
            room: {
                id: room.id,
                code: room.code,
                name: room.name,
                hostName: room.host_name,
                status: room.status
            },
            member: {
                name: memberName
            }
        });

    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback error in join room:", rollbackError.message);
            }
        }
        console.error("Join room error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to join room: " + error.message
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// ----------------------------------------------------
// 3. GET ROOM DETAILS (Members, Items, and Votes)
// GET /api/rooms/:code
// ----------------------------------------------------
router.get("/:code", async (req, res) => {
    try {
        const roomCode = String(req.params.code).trim().toUpperCase();

        const roomResult = await pool.query(
            `SELECT id, code, name, host_name, status, order_id, created_at
             FROM rooms
             WHERE UPPER(code) = $1`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: `Room with code ${roomCode} was not found.`
            });
        }

        const room = roomResult.rows[0];

        // Fetch members
        const membersResult = await pool.query(
            `SELECT id, member_name, is_host, joined_at
             FROM room_members
             WHERE room_id = $1
             ORDER BY is_host DESC, joined_at ASC`,
            [room.id]
        );

        // Fetch items joined with product info and aggregated vote counts
        const itemsResult = await pool.query(
            `SELECT 
                ri.id,
                ri.product_id,
                ri.added_by,
                ri.quantity,
                ri.created_at,
                p.name AS product_name,
                p.category AS product_category,
                p.description AS product_description,
                p.price AS product_price,
                p.stock AS product_stock,
                COALESCE(SUM(rv.vote), 0)::int AS net_votes,
                COUNT(rv.id) FILTER (WHERE rv.vote = 1)::int AS upvotes,
                COUNT(rv.id) FILTER (WHERE rv.vote = -1)::int AS downvotes,
                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT('voter', rv.voter_name, 'vote', rv.vote)
                    ) FILTER (WHERE rv.id IS NOT NULL),
                    '[]'
                ) AS votes
             FROM room_items ri
             JOIN products p ON p.id = ri.product_id
             LEFT JOIN room_item_votes rv ON rv.room_item_id = ri.id
             WHERE ri.room_id = $1
             GROUP BY ri.id, p.id
             ORDER BY net_votes DESC, ri.created_at ASC`,
            [room.id]
        );

        const subtotal = itemsResult.rows.reduce(
            (sum, item) => sum + (Number(item.product_price) * item.quantity),
            0
        );

        return res.status(200).json({
            success: true,
            room: {
                id: room.id,
                code: room.code,
                name: room.name,
                hostName: room.host_name,
                status: room.status,
                orderId: room.order_id,
                createdAt: room.created_at,
                subtotal,
                members: membersResult.rows.map(m => ({
                    id: m.id,
                    name: m.member_name,
                    isHost: m.is_host,
                    joinedAt: m.joined_at
                })),
                items: itemsResult.rows.map(item => ({
                    id: item.id,
                    productId: item.product_id,
                    name: item.product_name,
                    category: item.product_category,
                    description: item.product_description,
                    price: Number(item.product_price),
                    stock: Number(item.product_stock),
                    quantity: item.quantity,
                    addedBy: item.added_by,
                    netVotes: item.net_votes,
                    upvotes: item.upvotes,
                    downvotes: item.downvotes,
                    votes: item.votes,
                    createdAt: item.created_at
                }))
            }
        });

    } catch (error) {
        console.error("Get room error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch room details: " + error.message
        });
    }
});

// ----------------------------------------------------
// 4. ADD ITEM TO SHARED CART (With Cumulative Stock Check)
// POST /api/rooms/:code/items
// Body: { productId, addedBy, quantity }
// ----------------------------------------------------
router.post("/:code/items", async (req, res) => {
    let client;
    try {
        const roomCode = String(req.params.code).trim().toUpperCase();
        const { productId, addedBy, quantity } = req.body;

        if (!productId || !addedBy || !String(addedBy).trim()) {
            return res.status(400).json({
                success: false,
                message: "Product ID and addedBy member name are required."
            });
        }

        const qty = Number(quantity) || 1;
        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({
                success: false,
                message: "Quantity must be a positive integer."
            });
        }

        client = await pool.connect();
        await client.query("BEGIN");

        // 1. Lock room row to serialize concurrent item additions against checkout
        const roomResult = await client.query(
            `SELECT id, status FROM rooms WHERE UPPER(code) = $1 FOR UPDATE`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Room not found."
            });
        }

        const room = roomResult.rows[0];

        if (room.status === "checked_out") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Cannot add items. Room has already been checked out."
            });
        }

        if (room.status !== "active") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: `Room is not active (status: ${room.status}).`
            });
        }

        // 2. Lock product row to serialize against other stock updates
        const productResult = await client.query(
            `SELECT id, name, price, stock FROM products WHERE id = $1 FOR UPDATE`,
            [String(productId)]
        );

        if (productResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: `Product ${productId} does not exist.`
            });
        }

        const product = productResult.rows[0];

        // 3. Check cumulative stock: existing cart quantity + newly requested quantity
        const existingItemResult = await client.query(
            `SELECT quantity FROM room_items WHERE room_id = $1 AND product_id = $2 FOR UPDATE`,
            [room.id, String(productId)]
        );

        const currentCartQty = existingItemResult.rowCount > 0 ? Number(existingItemResult.rows[0].quantity) : 0;
        const totalRequestedQty = currentCartQty + qty;

        if (product.stock < totalRequestedQty) {
            await client.query("ROLLBACK");
            const errorMessage = currentCartQty > 0
                ? `Insufficient stock for ${product.name}. Available: ${product.stock}, current in cart: ${currentCartQty}, requested additional: ${qty}.`
                : `Insufficient stock for ${product.name}. Available: ${product.stock}, requested: ${qty}.`;
            return res.status(400).json({
                success: false,
                message: errorMessage
            });
        }

        // Ensure user is in room_members
        const memberName = String(addedBy).trim();
        await client.query(
            `INSERT INTO room_members (room_id, member_name, is_host)
             VALUES ($1, $2, false)
             ON CONFLICT (room_id, member_name) DO NOTHING`,
            [room.id, memberName]
        );

        // Add or increment quantity in room_items
        const itemResult = await client.query(
            `INSERT INTO room_items (room_id, product_id, added_by, quantity)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (room_id, product_id)
             DO UPDATE SET quantity = room_items.quantity + EXCLUDED.quantity
             RETURNING id, room_id, product_id, added_by, quantity, created_at`,
            [room.id, String(productId), memberName, qty]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Added ${product.name} to shared cart!`,
            item: itemResult.rows[0]
        });

    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback error in add item:", rollbackError.message);
            }
        }
        console.error("Add item to room error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to add item to room: " + error.message
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// ----------------------------------------------------
// 5. REMOVE ITEM FROM SHARED CART
// DELETE /api/rooms/:code/items/:itemId
// ----------------------------------------------------
router.delete("/:code/items/:itemId", async (req, res) => {
    let client;
    try {
        const roomCode = String(req.params.code).trim().toUpperCase();
        const itemId = Number(req.params.itemId);

        if (!Number.isInteger(itemId) || itemId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid item ID."
            });
        }

        client = await pool.connect();
        await client.query("BEGIN");

        // Lock room row to serialize concurrent modifications against checkout
        const roomResult = await client.query(
            `SELECT id, status FROM rooms WHERE UPPER(code) = $1 FOR UPDATE`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Room not found."
            });
        }

        const room = roomResult.rows[0];

        if (room.status === "checked_out") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Cannot modify items in a checked-out room."
            });
        }

        if (room.status !== "active") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: `Room is not active (status: ${room.status}).`
            });
        }

        const deleteResult = await client.query(
            `DELETE FROM room_items
             WHERE id = $1 AND room_id = $2
             RETURNING id`,
            [itemId, room.id]
        );

        if (deleteResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Item not found in this room cart."
            });
        }

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "Item removed from shared room cart."
        });

    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback error in remove item:", rollbackError.message);
            }
        }
        console.error("Remove item error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to remove item: " + error.message
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// ----------------------------------------------------
// 6. VOTE ON SHARED ITEM (Upvote / Downvote)
// POST /api/rooms/:code/items/:itemId/vote
// Body: { voterName, vote } (vote: 1 for upvote, -1 for downvote, 0 to cancel)
// ----------------------------------------------------
router.post("/:code/items/:itemId/vote", async (req, res) => {
    let client;
    try {
        const roomCode = String(req.params.code).trim().toUpperCase();
        const itemId = Number(req.params.itemId);
        const { voterName, vote } = req.body;

        if (!Number.isInteger(itemId) || itemId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid item ID."
            });
        }

        if (!voterName || !String(voterName).trim()) {
            return res.status(400).json({
                success: false,
                message: "voterName is required."
            });
        }

        const voteValue = Number(vote);
        if (![1, -1, 0].includes(voteValue)) {
            return res.status(400).json({
                success: false,
                message: "Vote must be 1 (upvote), -1 (downvote), or 0 (cancel vote)."
            });
        }

        client = await pool.connect();
        await client.query("BEGIN");

        // Lock room row to serialize concurrent voting against checkout
        const roomResult = await client.query(
            `SELECT id, status FROM rooms WHERE UPPER(code) = $1 FOR UPDATE`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Room not found."
            });
        }

        const room = roomResult.rows[0];

        if (room.status === "checked_out") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Voting closed: room has already been checked out."
            });
        }

        if (room.status !== "active") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: `Room is not active (status: ${room.status}).`
            });
        }

        // Verify item belongs to this room
        const itemResult = await client.query(
            `SELECT id FROM room_items WHERE id = $1 AND room_id = $2`,
            [itemId, room.id]
        );

        if (itemResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Item not found in this room."
            });
        }

        const cleanVoter = String(voterName).trim();

        // Ensure voter is a room member
        await client.query(
            `INSERT INTO room_members (room_id, member_name, is_host)
             VALUES ($1, $2, false)
             ON CONFLICT (room_id, member_name) DO NOTHING`,
            [room.id, cleanVoter]
        );

        if (voteValue === 0) {
            await client.query(
                `DELETE FROM room_item_votes
                 WHERE room_item_id = $1 AND voter_name = $2`,
                [itemId, cleanVoter]
            );
        } else {
            await client.query(
                `INSERT INTO room_item_votes (room_item_id, voter_name, vote)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (room_item_id, voter_name)
                 DO UPDATE SET vote = EXCLUDED.vote`,
                [itemId, cleanVoter, voteValue]
            );
        }

        // Fetch updated vote totals
        const tallyResult = await client.query(
            `SELECT 
                COALESCE(SUM(vote), 0)::int AS net_votes,
                COUNT(id) FILTER (WHERE vote = 1)::int AS upvotes,
                COUNT(id) FILTER (WHERE vote = -1)::int AS downvotes
             FROM room_item_votes
             WHERE room_item_id = $1`,
            [itemId]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: voteValue === 0 ? "Vote removed" : "Vote recorded",
            tally: tallyResult.rows[0]
        });

    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback error in vote:", rollbackError.message);
            }
        }
        console.error("Voting error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to record vote: " + error.message
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// ----------------------------------------------------
// 7. ATOMIC GROUP CHECKOUT
// POST /api/rooms/:code/checkout
// Body: { name, email, address }
// ----------------------------------------------------
router.post("/:code/checkout", async (req, res) => {
    const roomCode = String(req.params.code).trim().toUpperCase();
    const { name, email, address } = req.body;

    if (!name || !email || !address || !name.trim() || !email.trim() || !address.trim()) {
        return res.status(400).json({
            success: false,
            message: "Please provide customer name, email and delivery address."
        });
    }

    let client;
    let transactionStarted = false;
    let committed = false;

    try {
        client = await pool.connect();
        await client.query("BEGIN");
        transactionStarted = true;

        // 1. Lock room record to prevent concurrent checkouts
        const roomResult = await client.query(
            `SELECT id, code, name, host_name, status, order_id
             FROM rooms
             WHERE UPPER(code) = $1
             FOR UPDATE`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            throw new Error(`Room with code ${roomCode} was not found.`);
        }

        const room = roomResult.rows[0];

        if (room.status === "checked_out") {
            throw new Error(
                `Room ${room.code} has already been checked out. Associated Order ID: ${room.order_id}.`
            );
        }

        if (room.status !== "active") {
            throw new Error(`Room ${room.code} is not active (status: ${room.status}).`);
        }

        // 2. Fetch room items
        const roomItemsResult = await client.query(
            `SELECT id, product_id, quantity, added_by
             FROM room_items
             WHERE room_id = $1`,
            [room.id]
        );

        if (roomItemsResult.rowCount === 0) {
            throw new Error("Cannot checkout: Shared room cart is empty.");
        }

        const rawItems = roomItemsResult.rows.map(item => ({
            id: item.product_id,
            quantity: item.quantity
        }));

        // 3. Process common order creation & stock deduction using the shared service
        const { order, customerId, orderItems, total } = await processOrderTransaction(
            client,
            { name, email, address, items: rawItems }
        );

        // 4. Update room status to 'checked_out' and link order
        await client.query(
            `UPDATE rooms
             SET status = 'checked_out',
                 order_id = $1
             WHERE id = $2`,
            [order.id, room.id]
        );

        // 5. Fetch room members for event reporting
        const membersResult = await client.query(
            `SELECT member_name FROM room_members WHERE room_id = $1 ORDER BY is_host DESC`,
            [room.id]
        );
        const members = membersResult.rows.map(m => m.member_name);

        // 6. Commit transaction
        await client.query("COMMIT");
        committed = true;

        console.log(`SphereShare group order placed! Room: ${room.code}, Order ID: ${order.id}`);

        // 7. Immediately release client so external OpenSearch / Kafka calls don't hold pool connections
        client.release();
        client = null;

        // 8. Synchronize updated stock to OpenSearch only after successful DB commit
        await syncProductsToOpenSearch(orderItems.map(item => String(item.id)));

        // 9. Publish group order event to Kafka topic 'shopsphere-orders' using persistent producer
        const eventPublished = await publishEvent("shopsphere-orders", order.id, {
            event: "room_order_placed",
            orderId: order.id,
            roomCode: room.code,
            roomName: room.name,
            customerId,
            buyer: {
                name: name.trim(),
                email: email.trim(),
                address: address.trim()
            },
            members,
            items: orderItems,
            total,
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: "SphereShare group order placed successfully!",
            roomCode: room.code,
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

        console.error("Group checkout error:", error.message);
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
