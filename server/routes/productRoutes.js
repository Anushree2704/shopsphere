
const express = require("express");
const router = express.Router();
const client = require("../opensearch");

// Search products
router.get("/search", async (req, res) => {
    try {
        const { q, category } = req.query;

        const filters = [];

        if (category) {
            filters.push({
                term: {
                    category: category
                }
            });
        }

        const searchQuery = {
            bool: {
                must: q && q.trim()
                    ? [{
                        multi_match: {
                            query: q.trim(),
                            fields: ["name^3", "description"],
                            type: "best_fields",
                            fuzziness: "AUTO"
                        }
                    }]
                    : [{ match_all: {} }],
                filter: filters
            }
        };

        const result = await client.search({
            index: "shopsphere_products",
            body: {
                query: searchQuery,
                size: 100
            }
        });

        const products = result.body.hits.hits.map(item => ({
            id: item._id,
            ...item._source
        }));

        res.json({
            success: true,
            count: products.length,
            products
        });

    } catch (error) {
        console.error("Search error:", error);

        res.status(500).json({
            success: false,
            message: "Product search failed"
        });
    }
});

module.exports = router;
