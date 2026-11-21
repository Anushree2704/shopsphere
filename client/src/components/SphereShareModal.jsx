import { useState, useEffect } from "react";
import {
  Users,
  PlusCircle,
  LogIn,
  X,
  Copy,
  Check,
  AlertCircle,
  LogOut,
  Sparkles
} from "lucide-react";

const ROOMS_API = "http://localhost:5000/api/rooms";

/**
 * SphereShareModal
 * Modal allowing shoppers to create a new shared shopping room or join an existing one.
 * 
 * @param {boolean} isOpen - Whether modal is visible
 * @param {Function} onClose - Callback to close modal
 * @param {Function} onRoomJoined - Callback receiving (roomData, memberName)
 * @param {object|null} activeRoom - Current room if already connected
 * @param {string} activeMember - Current user's name in room
 * @param {Function} onLeaveRoom - Callback to leave active room
 */
export default function SphereShareModal({
  isOpen,
  onClose,
  onRoomJoined,
  activeRoom = null,
  activeMember = "",
  onLeaveRoom = () => {}
}) {
  const [tab, setTab] = useState("create"); // "create" | "join"

  // Create Form State
  const [createRoomName, setCreateRoomName] = useState("");
  const [createHostName, setCreateHostName] = useState(activeMember || "");

  // Join Form State
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [joinMemberName, setJoinMemberName] = useState(activeMember || "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  // Close modal on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && isOpen && !loading) {
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  // Handle Create Room
  async function handleCreateRoom(e) {
    e.preventDefault();
    setError("");

    const name = createRoomName.trim();
    const host = createHostName.trim();

    if (!name || !host) {
      setError("Please provide both a room name and your name.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(ROOMS_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          hostName: host
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to create room.");
      }

      // Success callback
      onRoomJoined(data.room, host);
      setCreateRoomName("");
      onClose();
    } catch (err) {
      console.error("SphereShare create error:", err);
      setError(err.message || "Cannot connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Handle Join Room
  async function handleJoinRoom(e) {
    e.preventDefault();
    setError("");

    const code = joinRoomCode.trim().toUpperCase();
    const member = joinMemberName.trim();

    if (!code || !member) {
      setError("Please provide both the room code and your name.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${ROOMS_API}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code,
          memberName: member
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to join room.");
      }

      // Success callback
      const finalMemberName = (data.member && data.member.name) || member;
      onRoomJoined(data.room, finalMemberName);
      setJoinRoomCode("");
      onClose();
    } catch (err) {
      console.error("SphereShare join error:", err);
      setError(err.message || "Cannot connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Copy code helper
  function copyRoomCode(code) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  }

  return (
    <div
      className="sphereshare-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div className="sphereshare-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="sphereshare-header">
          <div className="sphereshare-title-group">
            <h2>
              <Users size={24} /> SphereShare
            </h2>
            <p>Shop together in real-time with friends and family</p>
          </div>

          <button
            className="close-button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* If user is already connected to an active room */}
        {activeRoom && (
          <div className="sphereshare-active-card">
            <div className="sphereshare-active-header">
              <span className="sphereshare-active-badge">Active Room</span>
              <button
                className="sphereshare-leave-btn"
                onClick={() => {
                  onLeaveRoom();
                  setError("");
                }}
                disabled={loading}
              >
                <LogOut size={13} style={{ display: "inline", marginRight: 4 }} />
                Leave Room
              </button>
            </div>

            <h3>{activeRoom.name}</h3>

            <div className="sphereshare-code-pill">
              <span>Code: {activeRoom.code}</span>
              <button
                className="sphereshare-copy-btn"
                onClick={() => copyRoomCode(activeRoom.code)}
                title="Copy room code"
              >
                {copiedCode ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
              </button>
            </div>

            <div className="sphereshare-active-meta">
              <span>Host: <strong>{activeRoom.hostName}</strong></span>
              <span>Joined as: <strong>{activeMember}</strong></span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="sphereshare-tabs">
          <button
            type="button"
            className={`sphereshare-tab ${tab === "create" ? "active" : ""}`}
            onClick={() => {
              setTab("create");
              setError("");
            }}
          >
            <PlusCircle size={17} />
            <span>Create Room</span>
          </button>

          <button
            type="button"
            className={`sphereshare-tab ${tab === "join" ? "active" : ""}`}
            onClick={() => {
              setTab("join");
              setError("");
            }}
          >
            <LogIn size={17} />
            <span>Join Room</span>
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="sphereshare-error-banner" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* TAB 1: CREATE ROOM */}
        {tab === "create" && (
          <form className="sphereshare-form" onSubmit={handleCreateRoom}>
            <div className="sphereshare-form-group">
              <label htmlFor="create-room-name">Room Name</label>
              <input
                id="create-room-name"
                type="text"
                placeholder="e.g., Gaming Setup Haul or Weekend Groceries"
                value={createRoomName}
                onChange={(e) => setCreateRoomName(e.target.value)}
                maxLength={100}
                required
                disabled={loading}
              />
              <span className="sphereshare-form-hint">
                Give your collaborative shopping session a friendly name
              </span>
            </div>

            <div className="sphereshare-form-group">
              <label htmlFor="create-host-name">Your Name</label>
              <input
                id="create-host-name"
                type="text"
                placeholder="e.g., Alice"
                value={createHostName}
                onChange={(e) => setCreateHostName(e.target.value)}
                maxLength={255}
                required
                disabled={loading}
              />
              <span className="sphereshare-form-hint">
                You will be designated as the host of this room
              </span>
            </div>

            <button
              type="submit"
              className="sphereshare-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="sphereshare-spinner" />
                  <span>Creating Room...</span>
                </>
              ) : (
                <>
                  <Sparkles size={17} />
                  <span>Create Room</span>
                </>
              )}
            </button>

            <p className="sphereshare-switch-note">
              Have a code from a friend?{" "}
              <button
                type="button"
                className="sphereshare-switch-link"
                onClick={() => {
                  setTab("join");
                  setError("");
                }}
              >
                Join an existing room →
              </button>
            </p>
          </form>
        )}

        {/* TAB 2: JOIN ROOM */}
        {tab === "join" && (
          <form className="sphereshare-form" onSubmit={handleJoinRoom}>
            <div className="sphereshare-form-group">
              <label htmlFor="join-room-code">Room Code</label>
              <input
                id="join-room-code"
                type="text"
                className="code-input"
                placeholder="e.g., SPHERE-5NWG"
                value={joinRoomCode}
                onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                maxLength={20}
                required
                disabled={loading}
              />
              <span className="sphereshare-form-hint">
                Enter the 4-letter SphereShare code shared with you
              </span>
            </div>

            <div className="sphereshare-form-group">
              <label htmlFor="join-member-name">Your Name</label>
              <input
                id="join-member-name"
                type="text"
                placeholder="e.g., Bob"
                value={joinMemberName}
                onChange={(e) => setJoinMemberName(e.target.value)}
                maxLength={255}
                required
                disabled={loading}
              />
              <span className="sphereshare-form-hint">
                Your name will appear next to your votes and cart items
              </span>
            </div>

            <button
              type="submit"
              className="sphereshare-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="sphereshare-spinner" />
                  <span>Joining Room...</span>
                </>
              ) : (
                <>
                  <LogIn size={17} />
                  <span>Join Room</span>
                </>
              )}
            </button>

            <p className="sphereshare-switch-note">
              Want to start a new session?{" "}
              <button
                type="button"
                className="sphereshare-switch-link"
                onClick={() => {
                  setTab("create");
                  setError("");
                }}
              >
                Create a room instead →
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
