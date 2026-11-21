import { useState, useEffect } from "react";
import {
  CreditCard,
  X,
  Users,
  AlertCircle,
  Package,
  CheckCircle2,
  Lock
} from "lucide-react";

const ROOMS_API = "http://localhost:5000/api/rooms";

/**
 * SphereShareCheckout
 * Collaborative group checkout modal for finalizing and placing an order for a shared room.
 *
 * @param {boolean} isOpen - Whether modal is visible
 * @param {Function} onClose - Close modal callback
 * @param {object|null} room - Current room object { id, code, name, hostName, status, subtotal, items: [...] }
 * @param {string} activeMember - Current member display name
 * @param {Function} onCheckoutSuccess - Callback called upon successful order placement
 */
export default function SphereShareCheckout({
  isOpen,
  onClose,
  room = null,
  activeMember = "",
  onCheckoutSuccess = () => {}
}) {
  const [customer, setCustomer] = useState({
    name: activeMember || "",
    email: "",
    phone: "",
    address: ""
  });

  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [orderSuccess, setOrderSuccess] = useState(null);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && isOpen && !isPlacingOrder) {
        setCheckoutError("");
        setOrderSuccess(null);
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isPlacingOrder, onClose]);

  if (!isOpen) return null;

  const items = room?.items || [];
  const subtotal = room?.subtotal || 0;
  const isRoomClosed = room?.status === "checked_out";

  function handleInputChange(e) {
    const { name, value } = e.target;
    setCustomer((prev) => ({
      ...prev,
      [name]: value
    }));
  }

  function handleModalClose() {
    setCheckoutError("");
    setOrderSuccess(null);
    onClose();
  }

  async function handleGroupOrderSubmit(e) {
    e.preventDefault();

    if (isPlacingOrder || !room?.code) return;

    if (isRoomClosed) {
      setCheckoutError("This room has already been checked out and closed.");
      return;
    }

    if (items.length === 0) {
      setCheckoutError("Cannot checkout: Shared room cart is empty.");
      return;
    }

    // Form validation matching individual checkout
    const cleanName = customer.name.trim();
    const cleanEmail = customer.email.trim();
    const cleanPhone = customer.phone.trim();
    const cleanAddress = customer.address.trim();

    if (!cleanName || !cleanEmail || !cleanPhone || !cleanAddress) {
      setCheckoutError("Please provide customer name, email, phone and delivery address.");
      return;
    }

    if (!/^[0-9]{10}$/.test(cleanPhone)) {
      setCheckoutError("Please enter a valid 10-digit phone number.");
      return;
    }

    setIsPlacingOrder(true);
    setCheckoutError("");

    try {
      const response = await fetch(
        `${ROOMS_API}/${encodeURIComponent(room.code)}/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            address: cleanAddress
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to place group order.");
      }

      // Success
      setOrderSuccess({
        order: data.order,
        roomCode: data.roomCode || room.code,
        eventPublished: data.eventPublished,
        buyer: {
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          address: cleanAddress
        }
      });

      onCheckoutSuccess({
        order: data.order,
        roomCode: data.roomCode || room.code,
        eventPublished: data.eventPublished
      });

    } catch (err) {
      console.error("SphereShare checkout error:", err);
      setCheckoutError(err.message || "Cannot place group order. Please check available stock.");
    } finally {
      setIsPlacingOrder(false);
    }
  }

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPlacingOrder) {
          handleModalClose();
        }
      }}
    >
      {/* 1. SUCCESS VIEW */}
      {orderSuccess ? (
        <div className="success-panel sphereshare-success-panel" role="dialog" aria-modal="true">
          <div className="success-icon" style={{ background: "#E8F5EE", color: "var(--success)" }}>
            <CheckCircle2 size={36} />
          </div>

          <h2>Group Order Placed!</h2>

          <p>
            Congratulations! The collaborative order for SphereShare room{" "}
            <strong>{room?.name || orderSuccess.roomCode}</strong> (<code>{orderSuccess.roomCode}</code>) has been
            placed successfully.
          </p>

          <div className="sphereshare-success-meta">
            <p>
              <strong>Order ID:</strong> #{orderSuccess.order?.id}
            </p>
            <p>
              <strong>Total Amount:</strong> ₹
              {Number(orderSuccess.order?.total || subtotal).toLocaleString("en-IN")}
            </p>
            <p>
              <strong>Buyer:</strong> {orderSuccess.buyer?.name} ({orderSuccess.buyer?.email})
            </p>
            <p>
              <strong>Delivery:</strong> {orderSuccess.buyer?.address}
            </p>
            <p>
              <strong>Kafka Event:</strong>{" "}
              {orderSuccess.eventPublished ? (
                <span style={{ color: "var(--success)", fontWeight: 700 }}>Published (room_order_placed)</span>
              ) : (
                <span style={{ color: "var(--muted)" }}>Not published</span>
              )}
            </p>
          </div>

          <button
            className="checkout-button"
            onClick={handleModalClose}
            style={{ marginTop: 24 }}
          >
            Done & Continue Shopping
          </button>
        </div>
      ) : (
        /* 2. CHECKOUT FORM VIEW */
        <div className="checkout-panel sphereshare-checkout-panel" role="dialog" aria-modal="true">
          <div className="cart-header">
            <div>
              <h2>
                <CreditCard size={23} /> Group Checkout
              </h2>
              <div className="sphereshare-order-room-tag">
                <Users size={13} />
                <span>
                  Room: <strong>{room?.name}</strong> (<code>{room?.code}</code>)
                </span>
              </div>
            </div>

            <button
              className="close-button"
              onClick={handleModalClose}
              disabled={isPlacingOrder}
              aria-label="Close Checkout"
            >
              <X size={20} />
            </button>
          </div>

          {/* ROOM ALREADY CHECKED OUT WARNING */}
          {isRoomClosed && (
            <div className="sphereshare-error-banner" style={{ marginBottom: 16 }}>
              <Lock size={18} />
              <span>
                This room has already been checked out and closed (Order ID: #{room?.orderId || "N/A"}).
                No further checkouts are allowed.
              </span>
            </div>
          )}

          {/* CHECKOUT SUMMARY PILL */}
          <div className="sphereshare-checkout-summary-box">
            <div className="sphereshare-checkout-row">
              <span className="sphereshare-summary-label">
                <Package size={14} style={{ display: "inline", marginRight: 5 }} />
                Items to Purchase:
              </span>
              <strong>{items.length} product{items.length === 1 ? "" : "s"}</strong>
            </div>

            <div className="sphereshare-checkout-row total-row">
              <span className="sphereshare-summary-label">Group Order Total:</span>
              <strong className="sphereshare-price-highlight">
                ₹{Number(subtotal).toLocaleString("en-IN")}
              </strong>
            </div>
          </div>

          {/* ERROR ALERT */}
          {checkoutError && (
            <div className="sphereshare-error-banner" role="alert" style={{ margin: "14px 0" }}>
              <AlertCircle size={18} />
              <span>{checkoutError}</span>
            </div>
          )}

          {/* CHECKOUT FORM */}
          <form onSubmit={handleGroupOrderSubmit}>
            <label htmlFor="group-name">Full Name (Payer / Receiver)</label>
            <input
              id="group-name"
              type="text"
              name="name"
              placeholder="e.g., Alice Smith"
              value={customer.name}
              onChange={handleInputChange}
              disabled={isPlacingOrder || isRoomClosed}
              required
            />

            <label htmlFor="group-email">Email Address</label>
            <input
              id="group-email"
              type="email"
              name="email"
              placeholder="e.g., alice@example.com"
              value={customer.email}
              onChange={handleInputChange}
              disabled={isPlacingOrder || isRoomClosed}
              required
            />

            <label htmlFor="group-phone">Phone Number</label>
            <input
              id="group-phone"
              type="tel"
              name="phone"
              placeholder="10-digit mobile number"
              pattern="[0-9]{10}"
              maxLength={10}
              value={customer.phone}
              onChange={handleInputChange}
              disabled={isPlacingOrder || isRoomClosed}
              required
            />

            <label htmlFor="group-address">Delivery Address</label>
            <textarea
              id="group-address"
              name="address"
              placeholder="Enter complete shipping address for the group order"
              value={customer.address}
              onChange={handleInputChange}
              disabled={isPlacingOrder || isRoomClosed}
              required
            />

            <div className="checkout-total">
              <span>Order Total</span>
              <strong>₹{Number(subtotal).toLocaleString("en-IN")}</strong>
            </div>

            <button
              type="submit"
              className="checkout-button sphereshare-submit-btn"
              disabled={isPlacingOrder || isRoomClosed || items.length === 0}
            >
              {isPlacingOrder ? (
                <>
                  <span className="sphereshare-spinner" />
                  <span>Processing Group Order...</span>
                </>
              ) : isRoomClosed ? (
                <span>Room Already Checked Out</span>
              ) : (
                <span>Place Group Order →</span>
              )}
            </button>

            <p className="checkout-note">
              This will atomically commit the order, deduct inventory, and close the shared room for all members.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
