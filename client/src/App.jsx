
import { useEffect, useState } from "react";
import {
  Search,
  ShoppingCart,
  User,
  Store,
  Trash2,
  Plus,
  Minus,
  X,
  CreditCard,
  Package,
  Users
} from "lucide-react";
import "./App.css";
import "./SphereShare.css";
import SphereShareModal from "./components/SphereShareModal";
import SphereShareDrawer from "./components/SphereShareDrawer";
import SphereShareCheckout from "./components/SphereShareCheckout";

const API = "http://localhost:5000/api/products";
const ORDERS_API = "http://localhost:5000/api/orders";
const ROOMS_API = "http://localhost:5000/api/rooms";

const categories = ["All", "Electronics", "Fashion", "Footwear"];

function App() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderInfo, setOrderInfo] = useState(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [kafkaPublished, setKafkaPublished] = useState(false);

  // SphereShare collaborative shopping state
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [showSharedCart, setShowSharedCart] = useState(false);
  const [showGroupCheckout, setShowGroupCheckout] = useState(false);
  const [activeRoom, setActiveRoom] = useState(null);
  const [activeMember, setActiveMember] = useState("");
  const [sharedItemCount, setSharedItemCount] = useState(0);
  const [checkoutRoomData, setCheckoutRoomData] = useState(null);
  const [addingProductId, setAddingProductId] = useState(null);
  const [toastMessage, setToastMessage] = useState("");

  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
    address: ""
  });

  // SphereShare room join/leave handlers
  function handleRoomJoined(roomData, memberName) {
    setActiveRoom(roomData);
    setActiveMember(memberName);
    setShowRoomModal(false);
    if (Array.isArray(roomData.items)) {
      setSharedItemCount(roomData.items.length);
    }
    console.log("Joined SphereShare room:", roomData.code, "as", memberName);
  }

  function handleLeaveRoom() {
    setActiveRoom(null);
    setActiveMember("");
    setShowSharedCart(false);
    setShowGroupCheckout(false);
    setCheckoutRoomData(null);
    setSharedItemCount(0);
  }

  function handleProceedToGroupCheckout(roomData) {
    setCheckoutRoomData(roomData || activeRoom);
    setShowSharedCart(false);
    setShowGroupCheckout(true);
  }

  function handleGroupCheckoutSuccess(result) {
    console.log("SphereShare group order completed:", result.order?.id);
    setActiveRoom((prev) =>
      prev
        ? {
            ...prev,
            status: "checked_out",
            orderId: result.order?.id
          }
        : null
    );
    setSharedItemCount(0);
    setToastMessage(`Group Order #${result.order?.id} placed successfully!`);
    setTimeout(() => setToastMessage(""), 4000);
  }

  // Add product to SphereShare shared cart
  async function handleAddToSphereShare(product) {
    if (!activeRoom || !activeMember) {
      setShowRoomModal(true);
      return;
    }

    setAddingProductId(product.id);

    try {
      const response = await fetch(
        `${ROOMS_API}/${encodeURIComponent(activeRoom.code)}/items`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            productId: product.id,
            addedBy: activeMember,
            quantity: 1
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to add product to shared cart.");
      }

      setToastMessage(`Added "${product.name}" to SphereShare!`);
      setTimeout(() => setToastMessage(""), 3000);
    } catch (err) {
      console.error("Add to shared cart error:", err);
      setToastMessage(`Error: ${err.message || "Could not add to shared cart."}`);
      setTimeout(() => setToastMessage(""), 4000);
    } finally {
      setAddingProductId(null);
    }
  }

  // Fetch products
  async function fetchProducts(keyword = "", selectedCategory = "All") {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      if (keyword.trim()) {
        params.set("q", keyword.trim());
      }

      if (selectedCategory !== "All") {
        params.set("category", selectedCategory);
      }

      const response = await fetch(`${API}/search?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Unable to load products");
      }

      const data = await response.json();

      setProducts(data.products || []);
    } catch (err) {
      console.error("Product fetching error:", err);
      setError("Cannot connect to ShopSphere server. Check your backend.");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProducts();
  }, []);

  // Search products
  function handleSearch(e) {
    e.preventDefault();
    fetchProducts(search, category);
  }

  // Category filtering
  function handleCategory(selected) {
    setCategory(selected);
    fetchProducts(search, selected);
  }

  // Product images
 
function imageFor(product) {
  const name = (product.name || "").toLowerCase();
  const category = (product.category || "").toLowerCase();

  // Headphones - check BEFORE generic electronics
  if (
    name.includes("headphone") ||
    name.includes("earphone") ||
    name.includes("earbud") ||
    name.includes("airpod")
  ) {
    return "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600";
  }

  // Smartphones
  if (
    name.includes("samsung") ||
    name.includes("iphone") ||
    name.includes("smartphone") ||
    name.includes("mobile") ||
    name.includes("phone")
  ) {
    return "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600";
  }

  // Watches
  if (name.includes("watch")) {
    return "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600";
  }

  // Fashion
  if (
    name.includes("shirt") ||
    name.includes("t-shirt") ||
    name.includes("dress") ||
    category === "fashion"
  ) {
    return "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600";
  }

  // Footwear
  if (
    name.includes("shoe") ||
    name.includes("sneaker") ||
    category === "footwear"
  ) {
    return "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600";
  }

  // Other electronics
  if (category === "electronics") {
    return "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=600";
  }

  return "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=600";
}

    // Clothing
    
    

  // Add product to cart
  function addToCart(product) {
    setCart((previous) => {
      const existing = previous.find(
        (item) => String(item.id) === String(product.id)
      );

      if (existing) {
        return previous.map((item) =>
          String(item.id) === String(product.id)
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...previous, { ...product, quantity: 1 }];
    });
  }

  // Increase quantity
  function increaseQuantity(id) {
    setCart((previous) =>
      previous.map((item) =>
        String(item.id) === String(id)
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    );
  }

  // Decrease quantity
  function decreaseQuantity(id) {
    setCart((previous) =>
      previous
        .map((item) =>
          String(item.id) === String(id)
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  // Remove product
  function removeFromCart(id) {
    setCart((previous) =>
      previous.filter(
        (item) => String(item.id) !== String(id)
      )
    );
  }

  // Cart calculations
  const cartCount = cart.reduce(
    (total, item) => total + item.quantity,
    0
  );

  const subtotal = cart.reduce(
    (total, item) => total + Number(item.price) * item.quantity,
    0
  );

  // Customer form
  function handleCustomerChange(e) {
    const { name, value } = e.target;

    setCustomer((previous) => ({
      ...previous,
      [name]: value
    }));
  }

  // Place order
  async function placeOrder(e) {
    e.preventDefault();

    if (cart.length === 0 || isPlacingOrder) return;

    setIsPlacingOrder(true);
    setCheckoutError("");

    try {
      const response = await fetch(ORDERS_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          items: cart.map((item) => ({
            id: item.id,
            quantity: item.quantity
          }))
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to place order.");
      }

      setOrderInfo(data.order);
      setKafkaPublished(data.eventPublished);
      setOrderPlaced(true);

      setCart([]);
      setShowCheckout(false);
      setShowCart(false);

      setCustomer({
        name: "",
        email: "",
        phone: "",
        address: ""
      });

    } catch (err) {
      console.error("Order error:", err);
      setCheckoutError(err.message || "Something went wrong.");
    } finally {
      setIsPlacingOrder(false);
    }
  }

  return (
    <div className="app">

      {/* NAVBAR */}
      <header className="navbar">
        <a href="/" className="logo">
          <Store size={27} />
          <span>
            Shop<span className="logo-highlight">Sphere</span>
          </span>
        </a>

        <form className="search-bar" onSubmit={handleSearch}>
          <Search size={20} />

          <input
            type="text"
            placeholder="Search for products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button type="submit">Search</button>
        </form>

        <div className="nav-actions">
          <button
            className={`sphereshare-nav-button ${activeRoom ? "active-room" : ""}`}
            onClick={() => setShowRoomModal(true)}
            aria-label="SphereShare Collaborative Shopping"
          >
            <Users size={18} />
            <span>{activeRoom ? activeRoom.code : "SphereShare"}</span>
            {activeRoom && (
              <span className="sphereshare-nav-badge">Active</span>
            )}
          </button>

          <button className="icon-button" aria-label="Account">
            <User size={23} />
          </button>

          <button
            className="cart-button"
            onClick={() => {
              setShowCart(true);
              setShowCheckout(false);
            }}
          >
            <ShoppingCart size={23} />
            <span>Cart ({cartCount})</span>
          </button>
        </div>
      </header>

      {/* SPHERESHARE ACTIVE ROOM BANNER */}
      {activeRoom && (
        <div className="sphereshare-active-banner">
          <div className="sphereshare-banner-content">
            <span className="sphereshare-banner-dot" />
            <span>
              SphereShare Room: <strong>{activeRoom.name}</strong> (<code>{activeRoom.code}</code>) &bull; Joined as <strong>{activeMember}</strong>
              {activeRoom.hostName === activeMember && (
                <span className="sphereshare-host-tag">Host</span>
              )}
              {activeRoom.status === "checked_out" && (
                <span className="sphereshare-checkedout-tag">
                  Order Placed {activeRoom.orderId ? `#${activeRoom.orderId}` : ""}
                </span>
              )}
            </span>
          </div>

          <div className="sphereshare-banner-actions">
            <button
              className="sphereshare-cart-trigger-btn"
              onClick={() => {
                setShowSharedCart(true);
                setShowCart(false);
                setShowCheckout(false);
              }}
              title="Open Collaborative Shared Cart"
            >
              <ShoppingCart size={15} />
              <span>Shared Cart</span>
              {sharedItemCount > 0 && (
                <span className="sphereshare-badge-count">{sharedItemCount}</span>
              )}
            </button>

            <button
              className="sphereshare-banner-btn"
              onClick={() => setShowRoomModal(true)}
            >
              <Users size={14} /> Room Details
            </button>
            <button
              className="sphereshare-leave-btn"
              onClick={handleLeaveRoom}
              title="Disconnect from this room"
            >
              Leave
            </button>
          </div>
        </div>
      )}

      {/* CATEGORY NAVIGATION */}
      <nav className="category-nav">
        {categories.map((item) => (
          <button
            key={item}
            className={category === item ? "active" : ""}
            onClick={() => handleCategory(item)}
          >
            {item}
          </button>
        ))}
      </nav>

      <main>

        {/* HERO SECTION */}
        <section className="hero">
          <div className="hero-content">
            <span className="hero-label">
              WELCOME TO SHOPSPHERE
            </span>

            <h1>Everything you love, all in one place.</h1>

            <p>
              Discover amazing products, explore new collections
              and enjoy a smarter shopping experience.
            </p>

            <button
              onClick={() => {
                setCategory("All");
                setSearch("");
                fetchProducts("", "All");
              }}
            >
              Explore Products →
            </button>
          </div>
        </section>

        {/* PRODUCTS */}
        <section className="products-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">OUR COLLECTION</span>
              <h2>Discover Products</h2>
            </div>

            <span className="product-count">
              {products.length} products found
            </span>
          </div>

          {loading && (
            <p className="message">Loading products...</p>
          )}

          {error && <p className="error">{error}</p>}

          {!loading && !error && products.length === 0 && (
            <p className="message">
              No products found. Try another search.
            </p>
          )}

          <div className="product-grid">
            {products.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image">
                  <img
                    src={imageFor(product)}
                    alt={product.name}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=600";
                    }}
                  />

                  <span className="category-tag">
                    {product.category}
                  </span>
                </div>

                <div className="product-info">
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>

                  <div className="product-bottom">
                    <strong>
                      ₹{Number(product.price).toLocaleString("en-IN")}
                    </strong>

                    <div className="product-actions">
                      {activeRoom && (
                        <button
                          type="button"
                          className="sphereshare-add-btn"
                          onClick={() => handleAddToSphereShare(product)}
                          disabled={addingProductId === product.id}
                          title="Add product to shared room cart"
                        >
                          <Users size={13} />
                          <span>
                            {addingProductId === product.id
                              ? "Adding..."
                              : "Add to SphereShare"}
                          </span>
                        </button>
                      )}

                      <button onClick={() => addToCart(product)}>
                        Add to Cart
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      {/* SHOPPING CART */}
      {showCart && (
        <div className="overlay">
          <div className="cart-panel">

            <div className="cart-header">
              <h2>
                <ShoppingCart size={23} /> Your Shopping Cart
              </h2>

              <button
                className="close-button"
                onClick={() => setShowCart(false)}
              >
                <X />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="empty-cart">
                <Package size={55} />
                <h3>Your cart is empty</h3>
                <p>Add some products to get started.</p>

                <button onClick={() => setShowCart(false)}>
                  Continue Shopping
                </button>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item) => (
                    <div className="cart-item" key={item.id}>
                      <img
                        src={imageFor(item)}
                        alt={item.name}
                      />

                      <div className="cart-item-details">
                        <h3>{item.name}</h3>

                        <strong>
                          ₹{Number(item.price).toLocaleString("en-IN")}
                        </strong>

                        <div className="quantity-controls">
                          <button
                            onClick={() => decreaseQuantity(item.id)}
                            aria-label="Decrease quantity"
                          >
                            <Minus size={15} />
                          </button>

                          <span>{item.quantity}</span>

                          <button
                            onClick={() => increaseQuantity(item.id)}
                            aria-label="Increase quantity"
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </div>

                      <button
                        className="remove-button"
                        onClick={() => removeFromCart(item.id)}
                        aria-label="Remove product"
                      >
                        <Trash2 size={19} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="cart-summary">
                  <div className="subtotal-row">
                    <span>Subtotal</span>
                    <strong>
                      ₹{subtotal.toLocaleString("en-IN")}
                    </strong>
                  </div>

                  <p>Shipping charges calculated at checkout.</p>

                  <button
                    className="checkout-button"
                    onClick={() => {
                      setCheckoutError("");
                      setShowCheckout(true);
                    }}
                  >
                    Proceed to Checkout →
                  </button>

                  <button
                    className="continue-button"
                    onClick={() => setShowCart(false)}
                  >
                    Continue Shopping
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT */}
      {showCheckout && (
        <div className="overlay">
          <div className="checkout-panel">

            <div className="cart-header">
              <h2>
                <CreditCard size={23} /> Checkout
              </h2>

              <button
                className="close-button"
                onClick={() => setShowCheckout(false)}
              >
                <X />
              </button>
            </div>

            <form onSubmit={placeOrder}>
              <label>Full Name</label>
              <input
                type="text"
                name="name"
                placeholder="Enter your full name"
                value={customer.name}
                onChange={handleCustomerChange}
                required
              />

              <label>Email Address</label>
              <input
                type="email"
                name="email"
                placeholder="Enter your email"
                value={customer.email}
                onChange={handleCustomerChange}
                required
              />

              <label>Phone Number</label>
              <input
                type="tel"
                name="phone"
                placeholder="Enter your phone number"
                pattern="[0-9]{10}"
                maxLength={10}
                value={customer.phone}
                onChange={handleCustomerChange}
                required
              />

              <label>Delivery Address</label>
              <textarea
                name="address"
                placeholder="Enter your complete address"
                value={customer.address}
                onChange={handleCustomerChange}
                required
              />

              <div className="checkout-total">
                <span>Order Total</span>
                <strong>
                  ₹{subtotal.toLocaleString("en-IN")}
                </strong>
              </div>

              {checkoutError && (
                <p className="error">{checkoutError}</p>
              )}

              <button
                type="submit"
                className="checkout-button"
                disabled={isPlacingOrder}
              >
                {isPlacingOrder
                  ? "Processing Order..."
                  : "Place Order"}
              </button>

              <p className="checkout-note">
                Demo checkout only. No real payment will be processed.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* ORDER SUCCESS */}
      {orderPlaced && (
        <div className="overlay">
          <div className="success-panel">
            <div className="success-icon">✓</div>

            <h2>Order Placed Successfully!</h2>

            <p>
              Thank you for shopping with ShopSphere.
              Your order has been saved successfully!
            </p>

            {orderInfo && (
              <p>Order ID: {orderInfo.id}</p>
            )}

            <p>
              Kafka event:{" "}
              {kafkaPublished
                ? "Published successfully"
                : "Not published"}
            </p>

            <button onClick={() => setOrderPlaced(false)}>
              Continue Shopping
            </button>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer>
        <div className="footer-logo">ShopSphere</div>
        <p>Discover more. Shop smarter.</p>
        <p>© 2026 ShopSphere. All rights reserved.</p>
      </footer>

      {/* SPHERESHARE CREATE / JOIN MODAL */}
      <SphereShareModal
        isOpen={showRoomModal}
        onClose={() => setShowRoomModal(false)}
        onRoomJoined={handleRoomJoined}
        activeRoom={activeRoom}
        activeMember={activeMember}
        onLeaveRoom={handleLeaveRoom}
      />

      {/* SPHERESHARE SHARED CART DRAWER */}
      <SphereShareDrawer
        isOpen={showSharedCart}
        onClose={() => setShowSharedCart(false)}
        roomCode={activeRoom ? activeRoom.code : ""}
        activeMember={activeMember}
        imageFor={imageFor}
        onCartUpdated={(count) => setSharedItemCount(count)}
        onProceedToCheckout={handleProceedToGroupCheckout}
      />

      {/* SPHERESHARE GROUP CHECKOUT */}
      <SphereShareCheckout
        isOpen={showGroupCheckout}
        onClose={() => setShowGroupCheckout(false)}
        room={checkoutRoomData || activeRoom}
        activeMember={activeMember}
        onCheckoutSuccess={handleGroupCheckoutSuccess}
      />

      {/* SPHERESHARE TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="sphereshare-toast" role="status">
          <Users size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
}

export default App;
