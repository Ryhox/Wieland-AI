import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "../styles/Dashboard.css";
import "../styles/Sidebar.css";
import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import DBStats from "../components/dashboard/DBStats";
import UsersTable from "../components/dashboard/UsersTable";
import ChatsTable from "../components/dashboard/ChatsTable";
import UserModal from "../components/dashboard/UserModal";
import ConfirmModal from "../components/dashboard/ConfirmModal";
import ChatViewer from "../components/dashboard/ChatViewer";
import { useAuth } from "../context/AuthContext";
import { withLang } from "../utils/i18nRouting";

// admin dashboard: 3 tabs (overview stats, users table, chats table) mit CRUD operations
// sidebar icon nav, search/filter, pagination, user+chat modals für detail management
export default function Dashboard({ isSidebarOpen, onSidebarToggle }) {
  const { t, i18n } = useTranslation();
  const { authFetch, user, logout } = useAuth();
  const navigate = useNavigate();
  const localPath = (path) => withLang(path, i18n.language);

  // tab struktur: overview (stats), users (list), chats (list)
  const TABS = [
    { id: "overview", label: t("dashboard.tabs.overview"), icon: "◈" },
    { id: "users", label: t("dashboard.tabs.users"), icon: "◉" },
    { id: "chats", label: t("dashboard.tabs.chats"), icon: "◧" },
  ];

  const [isOpen, setIsOpen] = useState(false);
  const sidebarRef = useRef(null);

  // click-outside zum schließen der sidebar
  useEffect(() => {
    if (!isOpen) return;
    // handler separat halten, sonst wird die render-logik schnell wirr
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  // loading state pro endpoint: stats, users, chats
  const [loading, setLoading] = useState({
    stats: true,
    users: true,
    chats: true,
  });
  const [search, setSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [chatPage, setChatPage] = useState(1);
  const [userFilter, setUserFilter] = useState("all");
  const PAGE_SIZE = 15;
  // modals: user (create/edit), confirm-dialog (delete), chat-viewer (detail)\n
  const [userModal, setUserModal] = useState({ open: false, data: null });
  const [confirmModal, setConfirmModal] = useState({
    open: false,
    action: null,
    label: "",
  });
  const [chatViewer, setChatViewer] = useState({ open: false, chat: null });
  // fetch endpoints: /api/admin/stats, /api/admin/users, /api/admin/chats\n
  const fetchStats = useCallback(async () => {
    setLoading((l) => ({ ...l, stats: true }));
    try {
      const r = await authFetch("/api/admin/stats");
      setStats(await r.json());
    } catch {
      setStats(null);
    }
    setLoading((l) => ({ ...l, stats: false }));
  }, [authFetch]);

  const fetchUsers = useCallback(async () => {
    setLoading((l) => ({ ...l, users: true }));
    try {
      const r = await authFetch("/api/admin/users");
      const d = await r.json();
      setUsers(Array.isArray(d) ? d : (d.users ?? []));
    } catch {
      setUsers([]);
    }
    setLoading((l) => ({ ...l, users: false }));
  }, [authFetch]);

  const fetchChats = useCallback(async () => {
    setLoading((l) => ({ ...l, chats: true }));
    try {
      const r = await authFetch("/api/admin/chats");
      const d = await r.json();
      setChats(Array.isArray(d) ? d : (d.chats ?? []));
    } catch {
      setChats([]);
    }
    setLoading((l) => ({ ...l, chats: false }));
  }, [authFetch]);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    fetchStats();
    fetchUsers();
    fetchChats();
  }, []);

  // user-action flow hier sauber trennen, fehlerpfad sitzt direkt daneben
  const handleSaveUser = async (formData) => {
    const isEdit = !!formData.id;
    const res = await authFetch(
      isEdit ? `/api/admin/users/${formData.id}` : "/api/admin/users",
      {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      },
    );
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error || t("profile.errors.title"));
    }
    setUserModal({ open: false, data: null });
    fetchUsers();
    fetchStats();
  };

  const confirmDeleteUser = (u) =>
    setConfirmModal({
      open: true,
      label: t("dashboard.confirmDeleteUser", { name: u.username }),
      action: async () => {
        await authFetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
        fetchUsers();
        fetchChats();
        fetchStats();
      },
    });

  const confirmDeleteChat = (c) =>
    setConfirmModal({
      open: true,
      label: t("dashboard.confirmDeleteChat", { title: c.title || c.filename }),
      action: async () => {
        await authFetch(`/api/admin/chats/${c.id}`, { method: "DELETE" });
        fetchChats();
        fetchStats();
      },
    });

  const switchTab = (id) => {
    setActiveTab(id);
    setSearch("");
    setUserFilter("all");
    setIsOpen(false);
  };
  const goToUser = (u) => {
    setActiveTab("users");
    setSearch(u.username ?? "");
    setUserPage(1);
  };
  const goToUserChats = (u) => {
    setActiveTab("chats");
    setSearch(u.username ?? "");
    setChatPage(1);
  };
  // handler separat halten, sonst wird die render-logik schnell wirr
  const handleLogout = () => {
    setIsOpen(false);
    logout();
    navigate(localPath("/"));
  };

  const filteredUsers = users.filter((u) => {
    const s = search.toLowerCase();
    return (
      (u.username?.toLowerCase().includes(s) ||
        u.email?.toLowerCase().includes(s)) &&
      (userFilter === "all" || u.plan === userFilter)
    );
  });
  const filteredChats = chats.filter(
    (c) =>
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      c.filename?.toLowerCase().includes(search.toLowerCase()) ||
      c.username?.toLowerCase().includes(search.toLowerCase()),
  );
  const pagedUsers = filteredUsers.slice(
    (userPage - 1) * PAGE_SIZE,
    userPage * PAGE_SIZE,
  );
  const pagedChats = filteredChats.slice(
    (chatPage - 1) * PAGE_SIZE,
    chatPage * PAGE_SIZE,
  );

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : "?";

  return (
    <div className="db-root">
      <aside
        ref={sidebarRef}
        className={`sidebar ${isOpen ? "open" : "collapsed"}`}
      >
        <div
          className={`sidebar-hamburger ${isOpen ? "sidebar-open" : ""}`}
          onClick={() => setIsOpen((v) => !v)}
          title={t("sidebar.menu")}
        >
          <svg fill="none" viewBox="0 0 50 50" height="28" width="28">
            <path
              className="lineTop line"
              strokeLinecap="round"
              strokeWidth="4"
              stroke="white"
              d="M6 11L44 11"
            />
            <path
              className="lineMid line"
              strokeLinecap="round"
              strokeWidth="4"
              stroke="white"
              d="M6 24H43"
            />
            <path
              className="lineBottom line"
              strokeLinecap="round"
              strokeWidth="4"
              stroke="white"
              d="M6 37H43"
            />
          </svg>
        </div>

        <div className="sidebar-top">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`sidebar-icon-btn${activeTab === t.id ? " db-tab-active" : ""}`}
              onClick={() => switchTab(t.id)}
              title={t.label}
            >
              <span className="db-tab-icon">{t.icon}</span>
              {isOpen && <span>{t.label}</span>}
            </button>
          ))}
        </div>

        {isOpen && (
          <div className="sidebar-chats-section">
            <p className="sidebar-section-label">{t("dashboard.adminPanel")}</p>
          </div>
        )}

        <div className="sidebar-spacer" />

        <div className="sidebar-bottom">
          {isOpen && (
            <a href={localPath("/")} className="db-back-link">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              {t("dashboard.backToSite")}
            </a>
          )}
          <div className="sidebar-profile">
            <div className="sidebar-avatar">{initials}</div>
            {isOpen && (
              <>
                <div className="sidebar-profile-info">
                  <span className="sidebar-profile-name">
                    {user?.username ?? "—"}
                  </span>
                  <span className="sidebar-profile-plan">
                    {user?.plan ?? "Free"}
                  </span>
                </div>
                <button
                  className="sidebar-logout-btn"
                  onClick={handleLogout}
                  title={t("sidebar.logout")}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      <main className={`db-main-area ${isOpen ? "sidebar-open" : ""}`}>
        <header className={`header no-sidebar ${isOpen ? "sidebar-open" : ""}`}>
          <button
            className="db-header-sidebar-toggle"
            onClick={() => setIsOpen((v) => !v)}
            aria-label={t("dashboard.toggleSidebar")}
            title={t("dashboard.toggleSidebar")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <a href={localPath("/")} className="header-logo">
            <span className="header-logo-name">Wieland</span>
          </a>
          <span className="db-header-sep">/</span>
          <span className="db-header-cur">
            {TABS.find((t) => t.id === activeTab)?.label}
          </span>

          <div className="header-nav">
            {(activeTab === "users" || activeTab === "chats") && (
              <div className="db-search-wrap">
                <span className="db-search-icon">⌕</span>
                <input
                  className="db-search"
                  placeholder={t("dashboard.search")}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setUserPage(1);
                    setChatPage(1);
                  }}
                />
              </div>
            )}
            {activeTab === "users" && (
              <>
                {["all", "Free", "Pro", "Max", "Admin"].map((p) => (
                  <button
                    key={p}
                    className={`db-filter-pill ${userFilter === p ? "active" : ""}`}
                    onClick={() => {
                      setUserFilter(p);
                      setUserPage(1);
                    }}
                  >
                    {p === "all" ? t("dashboard.all") : p}
                  </button>
                ))}
                <button
                  className="db-btn-primary"
                  onClick={() => setUserModal({ open: true, data: null })}
                >
                  {t("dashboard.addUser")}
                </button>
              </>
            )}
            <button
              className="db-btn-ghost"
              onClick={() => {
                fetchStats();
                fetchUsers();
                fetchChats();
              }}
              title={t("dashboard.refresh")}
            >
              ↻
            </button>
          </div>
        </header>

        <div className="db-content">
          {activeTab === "overview" && (
            <DBStats
              stats={stats}
              loading={loading.stats}
              users={users}
              chats={chats}
              onUserClick={(u) => setUserModal({ open: true, data: u })}
              onUserChats={(u) => goToUserChats(u)}
              onChatClick={(c) => setChatViewer({ open: true, chat: c })}
              onTabChange={(t) => switchTab(t)}
            />
          )}
          {activeTab === "users" && (
            <UsersTable
              users={pagedUsers}
              total={filteredUsers.length}
              page={userPage}
              pageSize={PAGE_SIZE}
              loading={loading.users}
              onEdit={(u) => setUserModal({ open: true, data: u })}
              onDelete={confirmDeleteUser}
              onPageChange={setUserPage}
              onViewChats={(u) => goToUserChats(u)}
            />
          )}
          {activeTab === "chats" && (
            <ChatsTable
              chats={pagedChats}
              total={filteredChats.length}
              page={chatPage}
              pageSize={PAGE_SIZE}
              loading={loading.chats}
              onDelete={confirmDeleteChat}
              onPageChange={setChatPage}
              onView={(c) => setChatViewer({ open: true, chat: c })}
              onUserClick={(u) => goToUser(u)}
            />
          )}
        </div>
      </main>

      {userModal.open && (
        <UserModal
          data={userModal.data}
          onSave={handleSaveUser}
          onClose={() => setUserModal({ open: false, data: null })}
          onViewChats={
            userModal.data
              ? () => {
                  setUserModal({ open: false, data: null });
                  goToUserChats(userModal.data);
                }
              : null
          }
          onDelete={
            userModal.data
              ? () => {
                  setUserModal({ open: false, data: null });
                  confirmDeleteUser(userModal.data);
                }
              : null
          }
        />
      )}
      {confirmModal.open && (
        <ConfirmModal
          label={confirmModal.label}
          onConfirm={async () => {
            await confirmModal.action?.();
            setConfirmModal({ open: false, action: null, label: "" });
          }}
          onClose={() =>
            setConfirmModal({ open: false, action: null, label: "" })
          }
        />
      )}
      {chatViewer.open && (
        <ChatViewer
          chat={chatViewer.chat}
          authFetch={authFetch}
          onClose={() => setChatViewer({ open: false, chat: null })}
          onUserClick={(u) => {
            setChatViewer({ open: false, chat: null });
            goToUser(u);
          }}
          onDelete={(c) => {
            setChatViewer({ open: false, chat: null });
            confirmDeleteChat(c);
          }}
        />
      )}
    </div>
  );
}
