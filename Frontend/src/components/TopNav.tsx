import { io } from "socket.io-client";
import { useState, useEffect } from "react";
import { Bell, Globe, LogOut, User } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface NotificationType {
  _id: string;
  title: string;
  message: string;
  createdAt: string;
  document_id?: string;
  is_read: boolean;
}

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000")
const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:5000");

export default function TopNav() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    if (profile) loadNotifications();
  }, [profile]);

  useEffect(() => {
    socket.on("new-notification", (data) => {
      setNotifications((prev) => [data, ...prev]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const authFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem("token");

    const headers = {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };

    return fetch(url, { ...options, headers });
  };

  const loadNotifications = async () => {
    try {
      const res = await authFetch(`${API_URL}/notifications/my`);
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data);
    } catch (err) {
      console.error("Error loading notifications:", err);
    }
  };

  const openNotification = (n: NotificationType) => {
    if (n.document_id) {
      navigate(`/documents/${n.document_id}`);
    }
    setShowNotifications(false);
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <nav className="bg-blue-200 border-b border-gray-200 px-6 py-4 sticky top-0 z-50 shadow-sm">
      <div className="flex items-center justify-between">

        <div className="flex items-center space-x-4">
          <h1 className="text-4xl font-bold text-blue-600">UDIS</h1>
          <span className="text-lg">Document Intelligence Platform</span>
        </div>

        <div className="flex items-center space-x-4">

          {/* Notifications */}
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 hover:bg-gray-100 rounded-lg"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 bg-red-500 text-white text-xs
                rounded-full w-5 h-5 flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          <button className="p-2 hover:bg-gray-100 rounded-lg">
            <Globe className="w-5 h-5" />
          </button>

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center space-x-3 p-2 hover:bg-gray-100 rounded-lg"
            >
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center">
                {profile?.full_name?.charAt(0).toUpperCase() || "U"}
              </div>
              <span>{profile?.full_name || "User"}</span>
            </button>

            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl">
                <button
                  onClick={() => navigate("/profile")}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100"
                >
                  <User className="w-4 h-4 inline mr-2" /> View Profile
                </button>

                <button
                  onClick={async () => { await signOut(); navigate("/login"); }}
                  className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50"
                >
                  <LogOut className="w-4 h-4 inline mr-2" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notification Dropdown */}
      {showNotifications && (
        <div className="absolute right-6 top-16 w-80 bg-white rounded-lg shadow-xl">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Notifications</h3>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-gray-500">No new notifications</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n._id}
                  className="p-4 border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => openNotification(n)}
                >
                  <p className="font-medium">{n.message}</p>
                  <span className="text-xs text-gray-400">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
