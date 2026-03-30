import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../styles/ChatInterface.css";
import Sidebar from "./Sidebar";
import AuthModal from "./AuthModal";
import { useAuth } from "../context/AuthContext";
import { withLang } from "../utils/i18nRouting";

const MAX_IMAGE_MB = 10;

const TargetIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);
const LightningIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);
const BotIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <path d="M12 4v4" />
    <circle cx="9" cy="14" r="1" />
    <circle cx="15" cy="14" r="1" />
  </svg>
);
const SparkIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);
const GlobeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14.5 14.5 0 0 1 0 18" />
    <path d="M12 3a14.5 14.5 0 0 0 0 18" />
  </svg>
);

const AVAILABLE_MODELS = [
  { id: "qwen3-vl:2b-instruct", key: "chat.models.free", icon: <BotIcon /> },
  {
    id: "qwen3-vl:4b-instruct",
    key: "chat.models.pro",
    icon: <LightningIcon />,
  },
  {
    id: "qwen3-vl:8b-instruct",
    key: "chat.models.precise",
    icon: <TargetIcon />,
  },
];

const normalizePlan = (plan) => {
  const value = String(plan || "Free").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "max") return "max";
  if (value === "pro") return "pro";
  return "free";
};

const getPlanRank = (plan) => {
  const normalized = normalizePlan(plan);
  if (normalized === "admin" || normalized === "max") return 2;
  if (normalized === "pro") return 1;
  return 0;
};

const getModelRank = (modelId) => {
  if (modelId === "qwen3-vl:8b-instruct") return 2;
  if (modelId === "qwen3-vl:4b-instruct") return 1;
  return 0;
};

const getPlanModel = (plan) => {
  const normalized = normalizePlan(plan);
  if (normalized === "admin" || normalized === "max")
    return "qwen3-vl:8b-instruct";
  if (normalized === "pro") return "qwen3-vl:4b-instruct";
  return "qwen3-vl:2b-instruct";
};

const AI_STYLES = [
  { id: "formal", key: "chat.styles.formal", icon: <BotIcon /> },
  { id: "friendly", key: "chat.styles.friendly", icon: <BotIcon /> },
  { id: "precise", key: "chat.styles.precise", icon: <SparkIcon /> },
];

function renderMarkdown(raw = "") {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/gs, "<strong>$1</strong>")
    .replace(/__(.*?)__/gs, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gs, "<em>$1</em>")
    .replace(/_(.*?)_/gs, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(
      /\[(.*?)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\n/g, "<br />");
}

const stripImg = (text = "") =>
  text.replace(/!\[.*?\]\([^)]+\)\n\n?/g, "").trim();

const toContextContent = (text = "") =>
  String(text || "")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (full, rawUrl) => {
      const url = String(rawUrl || "").trim();
      return /\/history\/images\//.test(url) ? full : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function extractImageUrl(content = "") {
  const m = content.match(/!\[.*?\]\(([^)]+)\)/);
  return m ? m[1] : null;
}

function pushUrl(url) {
  if (window.location.pathname !== url) window.history.pushState(null, "", url);
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const ImageIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

export default function ChatInterface({
  onMessagesChange,
  chatId,
  isLoading = false,
  sidebarOpen,
  onSidebarChange,
  inputOffset = 50,
  onNewChatRef,
  onLoadChatRef,
}) {
  const { t, i18n } = useTranslation();
  const DEMO_MODE = true;
  const { authFetch, user } = useAuth();
  const localPath = (path) => withLang(path, i18n.language);

  const isModelAllowed = (modelId, plan = "Free") => {
    return getModelRank(modelId) <= getPlanRank(plan);
  };

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [currentChatId, setCurrentChatId] = useState(chatId || null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [selectedModel, setSelectedModel] = useState(getPlanModel(user?.plan));
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [aiStyle, setAiStyle] = useState("formal");
  const [internetAccess, setInternetAccess] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("wieland_internet_access") === "1";
    } catch {
      return false;
    }
  });
  const pendingInputRef = useRef("");

  useEffect(() => {
    setSelectedModel(getPlanModel(user?.plan));
  }, [user?.plan]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "wieland_internet_access",
        internetAccess ? "1" : "0",
      );
    } catch {}
  }, [internetAccess]);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const editInputRef = useRef(null);
  const abortRef = useRef(null);
  const currentChatRef = useRef(currentChatId);
  const plusMenuRef = useRef(null);
  const modelDropdownRef = useRef(null);

  const welcomeMessage = useMemo(() => {
    const welcomeMessages = t("chat.welcome", { returnObjects: true });
    const items = Array.isArray(welcomeMessages)
      ? welcomeMessages
      : [String(welcomeMessages)];
    return items[Math.floor(Math.random() * items.length)];
  }, [i18n.language, t]);

  useEffect(() => {
    currentChatRef.current = currentChatId;
  }, [currentChatId]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    onMessagesChange?.(messages.length > 0);
  }, [messages, onMessagesChange]);
  useEffect(() => {
    if (chatId) loadChat(chatId);
  }, [chatId]);
  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);
  useEffect(() => {
    onNewChatRef?.(handleNewChat);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target)
      )
        setShowModelDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target))
        setShowPlusMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const uploadImage = useCallback(
    async (file) => {
      const fd = new FormData();
      fd.append("image", file);
      const res = await authFetch("/api/history/upload-image", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
      return (await res.json()).url;
    },
    [authFetch],
  );

  const loadChat = useCallback(
    async (filename) => {
      try {
        const res = await authFetch(`/api/history/${filename}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const loaded = (data.messages ?? []).map((m, i) => ({
          content: m.content,
          isUser: m.role === "user",
          id: `loaded-${i}-${uid()}`,
        }));
        setMessages(loaded);
        setCurrentChatId(filename);
        const uuid = filename.match(/chat_([a-f0-9-]+)\.json/)?.[1];
        if (uuid) pushUrl(localPath(`/chat/${uuid}`));
      } catch (err) {
        console.error("Failed to load chat:", err);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    onLoadChatRef?.(loadChat);
  }, [loadChat]);

  const saveChat = useCallback(
    async (msgs, chatIdToUse, generateTitle = false) => {
      if (!msgs.length) return;
      try {
        const res = await authFetch("/api/history/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs.map((m) => ({
              role: m.isUser ? "user" : "assistant",
              content: m.content,
            })),
            filename: chatIdToUse ?? undefined,
            generateTitle,
          }),
        });
        if (!res.ok) {
          console.error("Save failed:", res.status);
          return;
        }
        const saved = await res.json();
        if (saved.filename && !chatIdToUse) {
          setCurrentChatId(saved.filename);
          currentChatRef.current = saved.filename;
          const uuid = saved.filename.match(/chat_([a-f0-9-]+)\.json/)?.[1];
          if (uuid) pushUrl(localPath(`/chat/${uuid}`));
        }
        window.dispatchEvent(new CustomEvent("chatHistoryUpdated"));
      } catch (err) {
        console.error("Failed to save chat:", err);
      }
    },
    [authFetch],
  );

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert(t("chat.errors.notImage", { name: file.name }));
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      alert(t("chat.errors.tooLarge", { max: MAX_IMAGE_MB }));
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) =>
      setImagePreview({ dataUrl: ev.target.result, name: file.name });
    reader.readAsDataURL(file);
    setShowPlusMenu(false);
    e.target.value = "";
  };

  const clearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim() || (imageFile ? t("chat.describeImage") : "");
    if (!text || isSending) return;

    if (!user) {
      pendingInputRef.current = input;
      setAuthModalOpen(true);
      return;
    }

    setIsSending(true);
    setInput("");

    let imageUrl = null;
    const fileCopy = imageFile;
    if (fileCopy) {
      clearImage();
      try {
        imageUrl = await uploadImage(fileCopy);
      } catch (err) {
        console.error("Image upload failed:", err);
        imageUrl = imagePreview?.dataUrl ?? null;
      }
    }

    const userContext = imageUrl ? `![Bild](${imageUrl})\n\n${text}` : text;
    const userMsg = { content: userContext, isUser: true, id: uid() };

    const contextSnap = messages.map((m) => ({
      role: m.isUser ? "user" : "assistant",
      content: toContextContent(m.content),
    }));

    const withUser = [...messages, userMsg];
    setMessages(withUser);

    await runStream(
      text,
      fileCopy,
      contextSnap,
      withUser,
      selectedModel,
      aiStyle,
      internetAccess,
    );
  }, [
    input,
    imageFile,
    imagePreview,
    isSending,
    messages,
    user,
    clearImage,
    selectedModel,
    aiStyle,
    internetAccess,
    uploadImage,
  ]);

  const handleAuthSuccess = useCallback(() => {
    if (pendingInputRef.current) {
      setInput(pendingInputRef.current);
      pendingInputRef.current = "";
      setTimeout(() => {}, 50);
    }
  }, []);

  const runStream = useCallback(
    async (
      userText,
      file,
      contextSnap,
      baseMessages,
      model = AVAILABLE_MODELS[0].id,
      style = "formal",
      useInternet = false,
    ) => {
      const aiId = uid();
      setMessages((prev) => [
        ...prev,
        { content: "", isUser: false, id: aiId },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      let fullText = "";

      try {
        const fd = new FormData();
        fd.append("message", userText);
        fd.append("context", JSON.stringify(contextSnap));
        fd.append("model", model);
        fd.append("aiStyle", style);
        fd.append("internetAccess", useInternet ? "true" : "false");
        if (file) fd.append("image", file);

        const token = localStorage.getItem("wieland_token");
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers,
          body: fd,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`API ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, content: fullText } : m)),
          );
        }

        const final = [
          ...baseMessages,
          { content: fullText, isUser: false, id: aiId },
        ];
        const isNew = !currentChatRef.current && final.length <= 2;
        await saveChat(final, currentChatRef.current, isNew);
      } catch (err) {
        if (err.name === "AbortError") {
          if (currentChatRef.current) {
            await saveChat(
              [...baseMessages, { content: fullText, isUser: false, id: aiId }],
              currentChatRef.current,
              false,
            );
          }
          return;
        }
        console.error("Stream error:", err);
        const fallback = DEMO_MODE
          ? t("chat.demoFallback")
          : t("chat.errors.server");
        setMessages((prev) =>
          prev.map((m) => (m.id === aiId ? { ...m, content: fallback } : m)),
        );
      } finally {
        abortRef.current = null;
        setIsSending(false);
      }
    },
    [saveChat],
  );

  const stopGeneration = () => abortRef.current?.abort();

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isSending) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setCurrentChatId(null);
    currentChatRef.current = null;
    setInput("");
    clearImage();
    setEditingId(null);
    pushUrl(localPath("/"));
  }, [clearImage]);

  const lastUserMsg = messages.reduce((last, m) => (m.isUser ? m : last), null);

  const startEditing = (msg) => {
    if (msg.id !== lastUserMsg?.id) return;
    setEditingId(msg.id);
    setEditingText(stripImg(msg.content));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async (msgId) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    const orig = messages[idx];
    const imgUrl = extractImageUrl(orig.content);
    const newContent = imgUrl
      ? `![Bild](${imgUrl})\n\n${editingText}`
      : editingText;

    const updated = messages.map((m, i) =>
      i === idx ? { ...m, content: newContent } : m,
    );
    const truncated = updated.slice(0, idx + 1);

    setMessages(truncated);
    setEditingId(null);

    const hadAI = idx < messages.length - 1 && !messages[idx + 1]?.isUser;

    if (hadAI) {
      setIsSending(true);
      const ctx = truncated.slice(0, idx).map((m) => ({
        role: m.isUser ? "user" : "assistant",
        content: toContextContent(m.content),
      }));
      let refile = null;
      if (imgUrl) {
        try {
          const blob = await fetch(imgUrl).then((r) => r.blob());
          refile = new File([blob], "image.jpg", {
            type: blob.type || "image/jpeg",
          });
        } catch (err) {
          console.error("Failed to restore image for edit stream:", err);
        }
      }
      const requestText = refile ? editingText : toContextContent(newContent);
      await runStream(
        requestText,
        refile,
        ctx,
        truncated,
        selectedModel,
        aiStyle,
        internetAccess,
      );
    } else {
      if (currentChatRef.current)
        await saveChat(truncated, currentChatRef.current, false);
    }
  };

  const regenerate = useCallback(async () => {
    if (isSending || !messages.length) return;
    const aiIdx = [...messages].reduceRight(
      (found, m, i) => (found === -1 && !m.isUser ? i : found),
      -1,
    );
    if (aiIdx === -1) return;
    const uIdx = messages
      .slice(0, aiIdx)
      .reduceRight((f, m, i) => (f === -1 && m.isUser ? i : f), -1);
    if (uIdx === -1) return;

    const uMsg = messages[uIdx];
    const imgUrl = extractImageUrl(uMsg.content);
    const truncated = messages.slice(0, aiIdx);
    setMessages(truncated);
    setIsSending(true);

    const ctx = truncated.slice(0, uIdx).map((m) => ({
      role: m.isUser ? "user" : "assistant",
      content: toContextContent(m.content),
    }));
    let refile = null;
    if (imgUrl) {
      try {
        const blob = await fetch(imgUrl).then((r) => r.blob());
        refile = new File([blob], "image.jpg", {
          type: blob.type || "image/jpeg",
        });
      } catch (err) {
        console.error("Failed to restore image for regenerate stream:", err);
      }
    }
    const requestText = refile
      ? stripImg(uMsg.content)
      : toContextContent(uMsg.content);
    await runStream(
      requestText,
      refile,
      ctx,
      truncated,
      selectedModel,
      aiStyle,
      internetAccess,
    );
  }, [messages, isSending, runStream, selectedModel, aiStyle, internetAccess]);

  const copyText = (content) =>
    navigator.clipboard.writeText(stripImg(content)).catch(console.error);

  return (
    <div
      className={`chat-interface-wrapper ${isLoading ? "loading" : ""}`}
      style={{ "--chat-input-offset": `${inputOffset}px` }}
    >
      {user && (
        <Sidebar
          onNewChat={handleNewChat}
          onDeleteChat={(id) => {
            if (id === currentChatId) handleNewChat();
          }}
          onLoadChat={(filename) => loadChat(filename)}
          currentChatId={currentChatId}
          isOpen={sidebarOpen}
          onOpenChange={onSidebarChange}
        />
      )}

      <div className="chat-container">
        <div className="messages-area">
          {messages.length === 0 ? (
            <div
              className="welcome-message-container"
              style={{ bottom: `${inputOffset + 104}px` }}
            >
              <span>{welcomeMessage}</span>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                isLast={idx === messages.length - 1}
                isLastUser={msg.id === lastUserMsg?.id}
                isEditing={editingId === msg.id}
                editingText={editingText}
                editInputRef={editInputRef}
                isSending={isSending}
                onEdit={startEditing}
                onEditChange={setEditingText}
                onEditSave={saveEdit}
                onEditCancel={cancelEdit}
                onCopy={copyText}
                onRegenerate={regenerate}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div
          className={`chat-input-container ${imagePreview ? "has-preview" : ""}`}
          style={{ bottom: `${inputOffset}px` }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />

          {imagePreview && (
            <div className="image-previews-container">
              <div className="image-file-pill">
                <div className="image-file-icon">
                  <img src={imagePreview.dataUrl} alt={imagePreview.name} />
                </div>
                <div className="image-file-meta">
                  <div className="image-file-name">{imagePreview.name}</div>
                  <div className="image-file-type">{t("chat.image")}</div>
                </div>
                <button
                  className="image-file-remove"
                  onClick={clearImage}
                  aria-label={t("chat.removeImage")}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {showPlusMenu && (
            <div className="plus-popup" ref={plusMenuRef}>
              <button
                className="plus-popup-item"
                onClick={() => {
                  fileInputRef.current?.click();
                  setShowPlusMenu(false);
                }}
              >
                <ImageIcon /> {t("chat.imageUpload")}
              </button>
              <div className="plus-popup-divider" />
              <button
                className={`plus-popup-item plus-popup-toggle ${internetAccess ? "active" : ""}`}
                onClick={() => setInternetAccess((prev) => !prev)}
              >
                <GlobeIcon /> {t("chat.internetAccess")}
              </button>
              <div className="plus-popup-divider" />
              <div className="plus-popup-section-title">
                {t("chat.aiStyle")}
              </div>
              {AI_STYLES.map((style) => (
                <button
                  key={style.id}
                  className={`plus-popup-item ${aiStyle === style.id ? "active" : ""}`}
                  onClick={() => {
                    setAiStyle(style.id);
                    setShowPlusMenu(false);
                  }}
                >
                  {style.icon} {t("chat.aiStyle")}: {t(style.key)}
                </button>
              ))}
            </div>
          )}

          <div
            className="input-row"
            onClick={() => showPlusMenu && setShowPlusMenu(false)}
          >
            <button
              className="icon-btn plus-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowPlusMenu((v) => !v);
              }}
              disabled={isSending}
              aria-label={t("chat.options")}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !user
                  ? t("chat.placeholderLogin")
                  : imagePreview
                    ? t("chat.placeholderImage")
                    : t("chat.placeholderMessage")
              }
              disabled={isSending}
              className="chat-input-bottom"
              rows={1}
            />

            <div className="model-selector-wrapper" ref={modelDropdownRef}>
              <button
                className={`model-selector-btn ${showModelDropdown ? "open" : ""}`}
                onClick={() => setShowModelDropdown((v) => !v)}
                disabled={isSending}
              >
                <span className="model-selector-label">
                  {AVAILABLE_MODELS.find((m) => m.id === selectedModel)
                    ? t(
                        AVAILABLE_MODELS.find((m) => m.id === selectedModel)
                          .key,
                      )
                    : selectedModel}
                </span>
                <svg
                  className="model-selector-arrow"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {showModelDropdown && (
                <div className="model-dropdown">
                  {AVAILABLE_MODELS.map((m) => {
                    const allowed = isModelAllowed(m.id, user?.plan);
                    return (
                      <button
                        key={m.id}
                        className={`model-dropdown-item ${selectedModel === m.id ? "active" : ""} ${!allowed ? "disabled" : ""}`}
                        onClick={() => {
                          if (allowed) {
                            setSelectedModel(m.id);
                            setShowModelDropdown(false);
                          }
                        }}
                        disabled={!allowed}
                        title={!allowed ? t("chat.planModelLocked") : ""}
                      >
                        <span>{m.icon}</span> {t(m.key)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              className={`icon-btn ${isSending ? "stop-btn" : "send-btn"}`}
              onClick={isSending ? stopGeneration : sendMessage}
              disabled={!isSending && !input.trim() && !imagePreview}
              aria-label={isSending ? t("common.stop") : t("common.send")}
            >
              {isSending ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="6" y="6" width="12" height="12" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          pendingInputRef.current = "";
        }}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}

function MessageRow({
  msg,
  isLast,
  isLastUser,
  isEditing,
  editingText,
  editInputRef,
  isSending,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onCopy,
  onRegenerate,
}) {
  const { t } = useTranslation();
  const imageUrl = extractImageUrl(msg.content);
  const textOnly = stripImg(msg.content);

  return (
    <div className={`message ${msg.isUser ? "user-message" : "ai-message"}`}>
      <div className="message-bubble">
        {isEditing ? (
          <div className="edit-message-container">
            <textarea
              ref={editInputRef}
              value={editingText}
              onChange={(e) => onEditChange(e.target.value)}
              className="edit-message-input"
              rows={3}
            />
            <div className="edit-actions">
              <button
                className="edit-save-btn"
                onClick={() => onEditSave(msg.id)}
              >
                {t("common.save")}
              </button>
              <button className="edit-cancel-btn" onClick={onEditCancel}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {msg.isUser ? (
              <div>
                {imageUrl && (
                  <div className="message-images-grid">
                    <img
                      src={imageUrl}
                      alt={t("chat.imageAlt")}
                      className="message-image"
                    />
                  </div>
                )}
                {textOnly && <span>{textOnly}</span>}
              </div>
            ) : msg.content === "" ? (
              <TypingLoader />
            ) : (
              <div
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(msg.content),
                }}
              />
            )}
          </>
        )}
      </div>

      {!isEditing && (
        <div className="message-actions">
          {msg.isUser ? (
            <>
              {isLastUser && (
                <button
                  className="message-action-btn"
                  onClick={() => onEdit(msg)}
                  title={t("common.edit")}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 3L21 7L7 21H3V17L17 3Z" />
                  </svg>
                </button>
              )}
              <button
                className="message-action-btn"
                onClick={() => onCopy(msg.content)}
                title={t("common.copy")}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </>
          ) : (
            <>
              {msg.content && isLast && (
                <button
                  className="message-action-btn"
                  onClick={onRegenerate}
                  disabled={isSending}
                  title={t("chat.regenerate")}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M1 4v6h6" />
                    <path d="M23 20v-6h-6" />
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                  </svg>
                </button>
              )}
              {msg.content && (
                <button
                  className="message-action-btn"
                  onClick={() => onCopy(msg.content)}
                  title={t("common.copy")}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TypingLoader() {
  const { t } = useTranslation();
  return (
    <div className="loader" aria-label={t("common.loading")}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="circle">
          <div className="dot" />
          <div className="outline" />
        </div>
      ))}
    </div>
  );
}
