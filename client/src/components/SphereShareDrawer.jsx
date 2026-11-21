import { useState, useEffect, useCallback } from "react";
import {
  X,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  Users,
  Copy,
  Check,
  Package,
  AlertCircle,
  RefreshCw
} from "lucide-react";

const ROOMS_API = "http://localhost:5000/api/rooms";

/**
 * SphereShareDrawer
 * Slide-out drawer displaying collaborative shared room cart, members,
 * real-time upvoting/downvoting, item deletion, and subtotal.
 *
 * @param {boolean} isOpen - Whether drawer is visible
 * @param {Function} onClose - Close callback
 * @param {string} roomCode - Current room code
 * @param {string} activeMember - Current member display name
 * @param {Function} imageFor - Helper function to map product images
 * @param {Function} onCartUpdated - Callback when items change, receiving item count
 * @param {Function} onProceedToCheckout - Callback to open group checkout modal
 */
export default function SphereShareDrawer({
  isOpen,
  onClose,
  roomCode,
  activeMember,
  imageFor = () => "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=600",
  onCartUpdated = () => { },
  onProceedToCheckout = () => { }
}) {
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  // Track pending actions per item ID to prevent rapid clicking
  const [votingItemId, setVotingItemId] = useState(null);
  const [deletingItemId, setDeletingItemId] = useState(null);

  // Fetch latest room info & shared items
  const fetchRoomDetails = useCallback(async (isSilent = false) => {
    if (!roomCode) return;

    try {
      const response = await fetch(`${ROOMS_API}/${encodeURIComponent(roomCode)}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to load shared room details.");
      }

      setRoom(data.room);
      setError("");
      if (onCartUpdated && data.room?.items) {
        onCartUpdated(data.room.items.length);
      }
    } catch (err) {
      console.error("Error fetching room details:", err);
      if (!isSilent) {
        setError(err.message || "Cannot connect to server.");
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [roomCode, onCartUpdated]);

  // Polling: Refresh shared room data every 3.5 seconds while open
  useEffect(() => {
    if (!isOpen || !roomCode) return;

    let isMounted = true;

    async function loadInitial() {
      try {
        const response = await fetch(`${ROOMS_API}/${encodeURIComponent(roomCode)}`);
        const data = await response.json();
        if (isMounted && response.ok && data.success) {
          setRoom(data.room);
          setError("");
          if (onCartUpdated && data.room?.items) {
            onCartUpdated(data.room.items.length);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Cannot connect to server.");
        }
      }
    }

    loadInitial();

    const intervalId = setInterval(() => {
      fetchRoomDetails(true);
    }, 3500);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [isOpen, roomCode, fetchRoomDetails, onCartUpdated]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Copy room code
  function handleCopyCode() {
    if (!navigator.clipboard || !roomCode) return;
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  }

  // Upvote / Downvote handler (toggles vote if user clicks the same vote again)
  async function handleVote(item, targetVote) {
    if (votingItemId !== null || !roomCode || !activeMember) return;

    setActionError("");
    setVotingItemId(item.id);

    // Determine current user's vote
    const userVoteObj = Array.isArray(item.votes)
      ? item.votes.find((v) => v.voter === activeMember)
      : null;
    const currentVote = userVoteObj ? userVoteObj.vote : 0;

    // Toggle: if already voted targetVote, cancel by sending 0; otherwise send targetVote
    const finalVote = currentVote === targetVote ? 0 : targetVote;

    try {
      const response = await fetch(
        `${ROOMS_API}/${encodeURIComponent(roomCode)}/items/${item.id}/vote`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            voterName: activeMember,
            vote: finalVote
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to record vote.");
      }

      // Immediately re-fetch to reflect sorted order and new tally
      await fetchRoomDetails(true);
    } catch (err) {
      console.error("Voting error:", err);
      setActionError(err.message || "Could not record vote.");
    } finally {
      setVotingItemId(null);
    }
  }

  // Delete item handler
  async function handleDeleteItem(itemId) {
    if (deletingItemId !== null || !roomCode) return;

    setActionError("");
    setDeletingItemId(itemId);

    try {
      const response = await fetch(
        `${ROOMS_API}/${encodeURIComponent(roomCode)}/items/${itemId}`,
        {
          method: "DELETE"
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to remove item.");
      }

      // Optimistically update local items and subtotal
      setRoom((prev) => {
        if (!prev) return prev;
        const updatedItems = (prev.items || []).filter((i) => i.id !== itemId);
        const newSubtotal = updatedItems.reduce(
          (sum, i) => sum + Number(i.price) * i.quantity,
          0
        );
        return {
          ...prev,
          items: updatedItems,
          subtotal: newSubtotal
        };
      });

      if (onCartUpdated) {
        onCartUpdated(Math.max(0, (room?.items?.length || 1) - 1));
      }

      // Sync fresh state from server
      await fetchRoomDetails(true);
    } catch (err) {
      console.error("Delete item error:", err);
      setActionError(err.message || "Could not remove item from shared cart.");
    } finally {
      setDeletingItemId(null);
    }
  }

  if (!isOpen) return null;

  const items = room?.items || [];
  const members = room?.members || [];
  const subtotal = room?.subtotal || 0;

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cart-panel sphereshare-drawer-panel" role="dialog" aria-modal="true">
        {/* DRAWER HEADER */}
        <div className="cart-header sphereshare-drawer-header">
          <div>
            <h2>
              <Users size={22} /> {room?.name || "Shared Cart"}
            </h2>
            <div className="sphereshare-drawer-subhead">
              <span className="sphereshare-drawer-code-pill">
                <code>{roomCode}</code>
                <button
                  className="sphereshare-copy-icon-btn"
                  onClick={handleCopyCode}
                  title="Copy room code"
                >
                  {copiedCode ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                </button>
              </span>

              {isRefreshing && (
                <span className="sphereshare-live-sync" title="Syncing changes with members...">
                  <RefreshCw size={12} className="spin-slow" />
                  <span>Syncing</span>
                </span>
              )}
            </div>
          </div>

          <button className="close-button" onClick={onClose} aria-label="Close Shared Cart">
            <X size={20} />
          </button>
        </div>

        {/* ERROR BANNERS */}
        {error && (
          <div className="sphereshare-error-banner" style={{ marginBottom: 15 }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {actionError && (
          <div className="sphereshare-error-banner" style={{ marginBottom: 15 }}>
            <AlertCircle size={18} />
            <span>{actionError}</span>
          </div>
        )}

        {/* MEMBERS SECTION */}
        <div className="sphereshare-members-strip">
          <span className="sphereshare-members-label">
            Members ({members.length}):
          </span>
          <div className="sphereshare-members-list">
            {members.map((member) => (
              <span
                key={member.id || member.name}
                className={`sphereshare-member-chip ${member.name === activeMember ? "is-you" : ""
                  } ${member.isHost ? "is-host" : ""}`}
                title={`Joined: ${new Date(member.joinedAt).toLocaleTimeString()}`}
              >
                {member.name}
                {member.isHost && " ★"}
                {member.name === activeMember && " (You)"}
              </span>
            ))}
          </div>
        </div>

        {/* LOADING STATE */}
        {loading && !room && (
          <div className="sphereshare-drawer-loading">
            <span className="sphereshare-spinner" style={{ borderColor: "var(--plum)" }} />
            <p>Loading shared items...</p>
          </div>
        )}

        {/* EMPTY STATE */}
        {!loading && items.length === 0 && (
          <div className="empty-cart sphereshare-empty-shared">
            <Package size={55} />
            <h3>Shared cart is empty</h3>
            <p>
              Collaborate with your room members! Click{" "}
              <strong>"Add to SphereShare"</strong> on any product to propose it.
            </p>
            <button onClick={onClose}>Browse Products</button>
          </div>
        )}

        {/* SHARED CART ITEMS LIST */}
        {items.length > 0 && (
          <>
            <div className="cart-items sphereshare-items-container">
              {items.map((item) => {
                const userVoteObj = Array.isArray(item.votes)
                  ? item.votes.find((v) => v.voter === activeMember)
                  : null;
                const userVote = userVoteObj ? userVoteObj.vote : 0;
                const isVoting = votingItemId === item.id;
                const isDeleting = deletingItemId === item.id;

                return (
                  <div className="cart-item sphereshare-item-card" key={item.id}>
                    <img
                      src={imageFor({ name: item.name, category: item.category })}
                      alt={item.name}
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src =
                          "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=600";
                      }}
                    />

                    <div className="cart-item-details sphereshare-item-info">
                      <div className="sphereshare-item-top">
                        <h3>{item.name}</h3>
                        <button
                          className="remove-button sphereshare-item-trash"
                          onClick={() => handleDeleteItem(item.id)}
                          disabled={isDeleting}
                          title="Remove item from shared room"
                          aria-label="Remove item"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      <div className="sphereshare-item-pricing">
                        <strong>₹{Number(item.price).toLocaleString("en-IN")}</strong>
                        <span className="sphereshare-qty-badge">Qty: {item.quantity}</span>
                      </div>

                      <div className="sphereshare-added-by">
                        Added by <strong>{item.addedBy}</strong>
                        {item.addedBy === activeMember && " (You)"}
                      </div>

                      {/* VOTING CONTROLS */}
                      <div className="sphereshare-voting-row">
                        <button
                          type="button"
                          className={`sphereshare-vote-btn upvote ${userVote === 1 ? "voted" : ""
                            }`}
                          onClick={() => handleVote(item, 1)}
                          disabled={isVoting}
                          title={userVote === 1 ? "Click to cancel upvote" : "Upvote this product"}
                        >
                          <ThumbsUp size={14} />
                          <span>{item.upvotes || 0}</span>
                        </button>

                        <button
                          type="button"
                          className={`sphereshare-vote-btn downvote ${userVote === -1 ? "voted" : ""
                            }`}
                          onClick={() => handleVote(item, -1)}
                          disabled={isVoting}
                          title={
                            userVote === -1 ? "Click to cancel downvote" : "Downvote this product"
                          }
                        >
                          <ThumbsDown size={14} />
                          <span>{item.downvotes || 0}</span>
                        </button>

                        <span
                          className={`sphereshare-score-pill ${item.netVotes > 0 ? "positive" : item.netVotes < 0 ? "negative" : ""
                            }`}
                          title="Net votes score"
                        >
                          Score: {item.netVotes > 0 ? `+${item.netVotes}` : item.netVotes}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* SHARED SUMMARY */}
            <div className="cart-summary sphereshare-summary">
              <div className="subtotal-row">
                <span>Shared Cart Subtotal</span>
                <strong>₹{Number(subtotal).toLocaleString("en-IN")}</strong>
              </div>

              <p className="sphereshare-summary-note">
                Live collaborative total for <strong>{items.length}</strong> product
                {items.length === 1 ? "" : "s"}. Voting helps your group agree on items.
              </p>

              <button
                className="checkout-button sphereshare-group-checkout-btn"
                onClick={() => {
                  if (onProceedToCheckout) {
                    onProceedToCheckout(room);
                  }
                }}
                disabled={items.length === 0 || room?.status === "checked_out"}
                title={
                  room?.status === "checked_out"
                    ? "Room has already been checked out"
                    : "Proceed to Group Checkout"
                }
              >
                {room?.status === "checked_out"
                  ? "Room Already Checked Out"
                  : "Proceed to Group Checkout →"}
              </button>

              <button className="continue-button" onClick={onClose}>
                Continue Shopping
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
