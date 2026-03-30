require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const archiver = require("archiver");
const { exec } = require("child_process");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const app = express();
const PORT = process.env.PORT || 3001;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    throw new Error("JWT_SECRET env var required");
  })();
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);
const SQLITE_PATH =
  process.env.SQLITE_PATH || path.join(__dirname, "data", "wieland.sqlite");

let db;

function toSqliteStatement(sql, params = []) {
  const indexes = [];
  const convertedSql = sql.replace(/\$(\d+)/g, (_m, n) => {
    indexes.push(Number(n) - 1);
    return "?";
  });
  const convertedParams =
    indexes.length > 0 ? indexes.map((i) => params[i]) : params;
  return { convertedSql, convertedParams };
}

function normalizeDbError(err) {
  const message = err?.message || "";
  if (
    err?.code === "SQLITE_CONSTRAINT" ||
    err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    /UNIQUE constraint failed/i.test(message)
  ) {
    err.code = "23505";
    const match = message.match(
      /UNIQUE constraint failed: ([^.\s]+)\.([^\s,]+)/i,
    );
    if (match) {
      err.constraint = `${match[1]}_${match[2]}_key`;
    }
  }
  return err;
}

async function dbQuery(sql, params = []) {
  const { convertedSql, convertedParams } = toSqliteStatement(sql, params);
  const normalizedSql = convertedSql.trim();

  try {
    if (
      convertedParams.length === 0 &&
      normalizedSql.includes(";") &&
      !/\bRETURNING\b/i.test(normalizedSql)
    ) {
      await db.exec(convertedSql);
      return { rows: [], rowCount: 0 };
    }

    if (
      /^SELECT\b/i.test(normalizedSql) ||
      /\bRETURNING\b/i.test(normalizedSql)
    ) {
      const rows = await db.all(convertedSql, convertedParams);
      return { rows, rowCount: rows.length };
    }

    const result = await db.run(convertedSql, convertedParams);
    return {
      rows: [],
      rowCount: typeof result?.changes === "number" ? result.changes : 0,
      lastID: result?.lastID,
    };
  } catch (err) {
    throw normalizeDbError(err);
  }
}

const pool = {
  query: dbQuery,
  connect: async () => ({
    query: dbQuery,
    release: () => {},
  }),
};

async function initDB() {
  await fs.promises.mkdir(path.dirname(SQLITE_PATH), { recursive: true });
  db = await open({ filename: SQLITE_PATH, driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA busy_timeout = 5000;");

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT         NOT NULL,
        plan          TEXT NOT NULL DEFAULT 'Free',
        created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chats (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename   TEXT NOT NULL,
        title      TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, filename)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id    INTEGER     NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        content    TEXT        NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_chats_user_id    ON chats(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chat_messages(chat_id);
    `);
    console.log("DB schema ready.");
  } finally {
    client.release();
  }
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
    credentials: true,
  }),
);

const IMAGES_DIR = path.join(__dirname, "history", "images");
const EXTENSION_DIR = path.resolve(__dirname, "..", "wieland-extension");
const EXTENSION_ARCHIVE_NAME = "wieland-extension.zip";
fs.mkdirSync(IMAGES_DIR, { recursive: true });
app.use("/history/images", express.static(IMAGES_DIR));

app.get("/api/extension/download", async (_req, res) => {
  try {
    await fs.promises.access(EXTENSION_DIR, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ error: "Extension folder not found" });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${EXTENSION_ARCHIVE_NAME}"`,
  );
  res.setHeader("Cache-Control", "no-store");

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("warning", (err) => {
    if (err?.code === "ENOENT") {
      console.warn("Extension archive warning:", err.message);
      return;
    }
    if (!res.writableEnded) res.end();
  });

  archive.on("error", (err) => {
    console.error("Extension archive error:", err.message);
    if (!res.writableEnded) res.end();
  });

  res.once("close", () => {
    if (!res.writableEnded) archive.abort();
  });

  archive.pipe(res);
  archive.directory(EXTENSION_DIR, "wieland-extension");

  try {
    await archive.finalize();
  } catch {
    if (!res.writableEnded) res.end();
  }
});

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error("Only images allowed"), { status: 400 }), false);
  },
});

function saveImageToDisk(buffer, mimetype) {
  const ext = mimetype.split("/")[1].replace("jpeg", "jpg");
  const hash = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex")
    .slice(0, 16);
  const filename = `${hash}.${ext}`;
  const filepath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, buffer);
  return `/history/images/${filename}`;
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
    algorithm: "HS256",
  });
}

function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function isValidUsername(u) {
  return typeof u === "string" && /^[a-zA-Z0-9_-]{3,32}$/.test(u);
}
function isValidEmail(e) {
  return (
    typeof e === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) &&
    e.length <= 255
  );
}
function isValidPassword(p) {
  return typeof p === "string" && p.length >= 8 && p.length <= 128;
}
function toSafeFilename(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 40);
}

app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body ?? {};

  if (!isValidUsername(username))
    return res
      .status(400)
      .json({ error: "Username must be 3–32 chars (letters, digits, _ -)" });
  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email address" });
  if (!isValidPassword(password))
    return res.status(400).json({ error: "Password must be 8–128 characters" });

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, username, email, plan`,
      [username.trim(), email.trim().toLowerCase(), hash],
    );
    const user = result.rows[0];
    const token = signToken(user.id);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        plan: user.plan,
      },
    });
  } catch (err) {
    if (err.code === "23505") {
      const field = err.constraint?.includes("email") ? "Email" : "Username";
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error("Register error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const result = await pool.query(
      `SELECT id, username, email, password_hash, plan FROM users WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    const user = result.rows[0];

    const hashToCheck =
      user?.password_hash ??
      "$2b$12$invalidhashfortimingXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const matches = await bcrypt.compare(password, hashToCheck);

    if (!user || !matches)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user.id);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        plan: user.plan,
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, plan FROM users WHERE id = $1`,
      [req.userId],
    );
    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Me error:", err.message);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.post("/api/auth/update-email", requireAuth, async (req, res) => {
  const { email } = req.body ?? {};

  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email address" });

  try {
    const result = await pool.query(
      `UPDATE users SET email = $1 WHERE id = $2
       RETURNING id, username, email, plan`,
      [email.trim().toLowerCase(), req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email already in use" });
    console.error("Update email error:", err.message);
    res.status(500).json({ error: "Failed to update email" });
  }
});

app.post("/api/auth/update-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Current and new password required" });

  if (!isValidPassword(newPassword))
    return res
      .status(400)
      .json({ error: "New password must be 8–128 characters" });

  try {
    const result = await pool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    const matches = await bcrypt.compare(
      currentPassword,
      result.rows[0].password_hash,
    );
    if (!matches)
      return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      newHash,
      req.userId,
    ]);

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Update password error:", err.message);
    res.status(500).json({ error: "Failed to update password" });
  }
});

app.post("/api/auth/cancel-subscription", requireAuth, async (req, res) => {
  try {
    const planRes = await pool.query(`SELECT plan FROM users WHERE id = $1`, [
      req.userId,
    ]);
    const currentPlan = (planRes.rows[0]?.plan || "").toLowerCase();
    if (currentPlan === "admin") {
      return res
        .status(403)
        .json({ error: "Admin subscription cannot be cancelled" });
    }

    const result = await pool.query(
      `UPDATE users SET plan = 'Free' WHERE id = $1
       RETURNING id, username, email, plan`,
      [req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    res.json({
      success: true,
      message: "Subscription cancelled",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Cancel subscription error:", err.message);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

app.post("/api/auth/upgrade-plan", requireAuth, async (req, res) => {
  try {
    const { plan } = req.body ?? {};
    const normalizedPlan = String(plan || "").trim();
    const canonicalPlan =
      normalizedPlan.toLowerCase() === "max" ? "Max" : normalizedPlan;

    if (
      !canonicalPlan ||
      !["Free", "Pro", "Max", "Admin"].includes(canonicalPlan)
    )
      return res.status(400).json({ error: "Invalid plan" });

    const result = await pool.query(
      `UPDATE users SET plan = $1 WHERE id = $2
       RETURNING id, username, email, plan`,
      [canonicalPlan, req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    res.json({
      success: true,
      message: `Plan changed to ${canonicalPlan}`,
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Upgrade plan error:", err.message);
    res.status(500).json({ error: "Failed to upgrade plan" });
  }
});

app.delete("/api/auth/delete-account", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    res.json({
      success: true,
      message: "Account deleted permanently",
    });
  } catch (err) {
    console.error("Delete account error:", err.message);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

function requireAdmin(req, res, next) {
  pool
    .query(`SELECT plan FROM users WHERE id = $1`, [req.userId])
    .then((result) => {
      if (!result.rows[0] || result.rows[0].plan !== "Admin")
        return res
          .status(403)
          .json({ error: "Forbidden: Admin access required" });
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth check failed" }));
}

app.get("/api/admin/stats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        CAST((SELECT COUNT(*) FROM users) AS INTEGER)        AS total_users,
        CAST((SELECT COUNT(*) FROM chats) AS INTEGER)        AS total_chats,
        CAST((SELECT COUNT(*) FROM chat_messages) AS INTEGER) AS total_msgs
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Admin stats error:", err.message);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.username, u.email, u.plan, u.created_at,
        CAST(COUNT(c.id) AS INTEGER) AS chat_count
      FROM users u
      LEFT JOIN chats c ON c.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin users error:", err.message);
    res.status(500).json({ error: "Failed to load users" });
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const { username, email, password, plan } = req.body ?? {};
  if (!isValidUsername(username))
    return res.status(400).json({ error: "Invalid username" });
  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email" });
  if (!isValidPassword(password))
    return res.status(400).json({ error: "Password too short" });

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, plan)
       VALUES ($1, $2, $3, $4) RETURNING id, username, email, plan, created_at`,
      [username.trim(), email.trim().toLowerCase(), hash, plan ?? "Free"],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      const field = err.constraint?.includes("email") ? "Email" : "Username";
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error("Admin create user error:", err.message);
    res.status(500).json({ error: "Failed to create user" });
  }
});

app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username, email, password, plan } = req.body ?? {};
  if (!isValidUsername(username))
    return res.status(400).json({ error: "Invalid username" });
  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email" });

  try {
    let query, params;
    if (password) {
      if (!isValidPassword(password))
        return res.status(400).json({ error: "Password too short" });
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      query = `UPDATE users SET username=$1, email=$2, password_hash=$3, plan=$4 WHERE id=$5 RETURNING id, username, email, plan`;
      params = [
        username.trim(),
        email.trim().toLowerCase(),
        hash,
        plan ?? "Free",
        id,
      ];
    } else {
      query = `UPDATE users SET username=$1, email=$2, plan=$3 WHERE id=$4 RETURNING id, username, email, plan`;
      params = [
        username.trim(),
        email.trim().toLowerCase(),
        plan ?? "Free",
        id,
      ];
    }
    const result = await pool.query(query, params);
    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      const field = err.constraint?.includes("email") ? "Email" : "Username";
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error("Admin update user error:", err.message);
    res.status(500).json({ error: "Failed to update user" });
  }
});

app.delete(
  "/api/admin/users/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const result = await pool.query(
        `DELETE FROM users WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!result.rowCount)
        return res.status(404).json({ error: "User not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("Admin delete user error:", err.message);
      res.status(500).json({ error: "Failed to delete user" });
    }
  },
);

app.get("/api/admin/chats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.filename, c.title, c.created_at, c.updated_at, c.user_id,
        u.username,
        CAST(COUNT(cm.id) AS INTEGER) AS message_count
      FROM chats c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN chat_messages cm ON cm.chat_id = c.id
      GROUP BY c.id, u.username
      ORDER BY c.updated_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin chats error:", err.message);
    res.status(500).json({ error: "Failed to load chats" });
  }
});

app.delete(
  "/api/admin/chats/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const result = await pool.query(
        `DELETE FROM chats WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!result.rowCount)
        return res.status(404).json({ error: "Chat not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("Admin delete chat error:", err.message);
      res.status(500).json({ error: "Failed to delete chat" });
    }
  },
);

app.get(
  "/api/admin/chats/:id/messages",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const chatRes = await pool.query(
        `SELECT c.id, c.filename, c.title, c.created_at, c.updated_at, c.user_id, u.username,
              CAST(COUNT(cm.id) AS INTEGER) AS message_count
       FROM chats c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN chat_messages cm ON cm.chat_id = c.id
       WHERE c.id = $1
       GROUP BY c.id, u.username`,
        [id],
      );
      if (!chatRes.rows[0])
        return res.status(404).json({ error: "Chat not found" });

      const msgRes = await pool.query(
        `SELECT role, content, created_at
       FROM chat_messages WHERE chat_id = $1
       ORDER BY created_at ASC, id ASC`,
        [id],
      );
      res.json({ ...chatRes.rows[0], messages: msgRes.rows });
    } catch (err) {
      console.error("Admin chat messages error:", err.message);
      res.status(500).json({ error: "Failed to load messages" });
    }
  },
);
const SYSTEM_BASE = `You are a LOCAL AI assistant named "Wieland".
- You CAN analyze images provided in this conversation.
- You do NOT represent any company (Alibaba, OpenAI, Anthropic, etc.).
- Internet snippets can be provided by the server. Use them only when present.
Always respond in the exact language of the user's last message.`;

const IMAGE_MD_REGEX = /!\[[^\]]*\]\(([^)]+)\)/g;
const MAX_CONTEXT_IMAGES = 4;
const WEB_SEARCH_TIMEOUT_MS = 7_000;
const MAX_WEB_SOURCES = 4;
const MAX_WEB_SNIPPET_CHARS = 320;
const SERVER_TIMEZONE =
  process.env.RUNTIME_TIMEZONE ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  "UTC";

function stripImageMarkdown(text) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]+\)\n\n?/g, "")
    .trim();
}

function extractImageUrlsFromMarkdown(text) {
  const urls = [];
  const content = String(text || "");
  let match;
  while ((match = IMAGE_MD_REGEX.exec(content)) !== null) {
    urls.push(match[1]);
  }
  IMAGE_MD_REGEX.lastIndex = 0;
  return urls;
}

function resolveHistoryImageFileFromUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return null;

  let pathname = "";
  try {
    pathname = new URL(value, "http://localhost").pathname || "";
  } catch {
    return null;
  }

  if (!pathname.startsWith("/history/images/")) return null;

  const filename = path.basename(pathname);
  if (!filename) return null;

  const candidate = path.resolve(path.join(IMAGES_DIR, filename));
  const root = path.resolve(IMAGES_DIR);
  if (!(candidate === root || candidate.startsWith(`${root}${path.sep}`)))
    return null;
  if (!fs.existsSync(candidate)) return null;

  return candidate;
}

function parseBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function safeLocaleFormat(formatter, fallback = "unknown") {
  try {
    const value = formatter();
    return value ? String(value) : fallback;
  } catch {
    return fallback;
  }
}

function buildRuntimeSystemContextMessage(now = new Date()) {
  const utcIso = now.toISOString();
  const unixSeconds = Math.floor(now.getTime() / 1000);

  const localDate = safeLocaleFormat(() =>
    now.toLocaleDateString("en-CA", { timeZone: SERVER_TIMEZONE }),
  );
  const localTime = safeLocaleFormat(() =>
    now.toLocaleTimeString("en-GB", {
      timeZone: SERVER_TIMEZONE,
      hour12: false,
    }),
  );
  const localWeekday = safeLocaleFormat(() =>
    now.toLocaleDateString("en-US", {
      timeZone: SERVER_TIMEZONE,
      weekday: "long",
    }),
  );
  const utcWeekday = safeLocaleFormat(() =>
    now.toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
    }),
  );

  return [
    "Runtime context from the server clock (authoritative):",
    `- Server timezone: ${SERVER_TIMEZONE}`,
    `- Current UTC datetime: ${utcIso}`,
    `- Current UTC weekday: ${utcWeekday}`,
    `- Current local date (${SERVER_TIMEZONE}): ${localDate}`,
    `- Current local time (${SERVER_TIMEZONE}): ${localTime}`,
    `- Current local weekday (${SERVER_TIMEZONE}): ${localWeekday}`,
    `- Unix timestamp (seconds): ${unixSeconds}`,
    "Use this as ground truth for questions about today, day/date/time, deadlines, and relative time.",
  ].join("\n");
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#x([\da-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlTags(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isPrivateIPv4(host) {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  )
    return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

function isSafePublicHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false;

    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "::1"
    )
      return false;
    if (host.startsWith("[") && host.endsWith("]")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIPv4(host)) return false;

    return true;
  } catch {
    return false;
  }
}

function normalizeDuckDuckGoUrl(rawHref) {
  const href = decodeHtmlEntities(rawHref);

  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const host = parsed.hostname.toLowerCase();

    if (
      (host === "duckduckgo.com" || host === "www.duckduckgo.com") &&
      parsed.pathname.startsWith("/l/")
    ) {
      const wrapped = parsed.searchParams.get("uddg");
      if (wrapped) return decodeURIComponent(wrapped);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseDuckDuckGoResults(html, maxSources = MAX_WEB_SOURCES) {
  const out = [];
  const seen = new Set();

  const withSnippetRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while (
    (match = withSnippetRegex.exec(html)) !== null &&
    out.length < maxSources
  ) {
    const url = normalizeDuckDuckGoUrl(match[1]);
    if (!url || !isSafePublicHttpUrl(url) || seen.has(url)) continue;

    const title = stripHtmlTags(match[2]).slice(0, 180);
    const snippet = stripHtmlTags(match[3]).slice(0, MAX_WEB_SNIPPET_CHARS);
    out.push({
      title: title || url,
      url,
      snippet,
    });
    seen.add(url);
  }

  if (out.length >= maxSources) return out;

  const titleOnlyRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while (
    (match = titleOnlyRegex.exec(html)) !== null &&
    out.length < maxSources
  ) {
    const url = normalizeDuckDuckGoUrl(match[1]);
    if (!url || !isSafePublicHttpUrl(url) || seen.has(url)) continue;

    const title = stripHtmlTags(match[2]).slice(0, 180);
    out.push({
      title: title || url,
      url,
      snippet: "",
    });
    seen.add(url);
  }

  return out;
}

async function fetchWebSources(query) {
  const normalized = String(query || "").trim();
  if (!normalized) return [];

  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(normalized)}`;
  const res = await fetch(searchUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WielandAI/1.0",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Web search failed (${res.status})`);
  }

  const html = await res.text();
  return parseDuckDuckGoResults(html, MAX_WEB_SOURCES);
}

function buildWebContextSystemMessage(sources) {
  const lines = [
    "Live web access is enabled for this answer.",
    "Use the following current web snippets as context where relevant.",
    "Do not invent URLs or source details.",
    "Web snippets:",
  ];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    lines.push(`[${i + 1}] ${source.title}`);
    lines.push(`URL: ${source.url}`);
    if (source.snippet) lines.push(`Snippet: ${source.snippet}`);
  }

  return lines.join("\n");
}

function escapeMarkdownLinkText(text) {
  return String(text || "")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeMarkdownUrl(url) {
  return String(url || "")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function formatWebSourcesMarkdown(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "";

  const lines = ["", "", "Sources / Quellen:"];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const title = escapeMarkdownLinkText(source.title) || `Source ${i + 1}`;
    lines.push(`- [${i + 1}] [${title}](${escapeMarkdownUrl(source.url)})`);
  }

  return lines.join("\n");
}

function buildContextMessagesForOllama(context) {
  let remainingImages = MAX_CONTEXT_IMAGES;
  const mapped = [];

  for (const m of context) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const rawContent = String(m?.content || "");
    const textContent = stripImageMarkdown(rawContent);
    const imageUrls =
      role === "user" ? extractImageUrlsFromMarkdown(rawContent) : [];

    const out = {
      role,
      content: textContent || (imageUrls.length ? "Image attached." : ""),
    };

    if (role === "user" && imageUrls.length && remainingImages > 0) {
      const images = [];
      for (const imageUrl of imageUrls) {
        if (remainingImages <= 0) break;
        const filePath = resolveHistoryImageFileFromUrl(imageUrl);
        if (!filePath) continue;
        try {
          images.push(fs.readFileSync(filePath).toString("base64"));
          remainingImages--;
        } catch {}
      }
      if (images.length) out.images = images;
    }

    if (!out.content && !out.images?.length) continue;
    mapped.push(out);
  }

  return mapped;
}

function getSystemPrompt(style = "formal") {
  const styleGuides = {
    formal: `${SYSTEM_BASE}
Speak naturally, concisely, and professionally. Be accurate and precise.
You may use *italic*, **bold**, and - bullet points.`,
    friendly: `${SYSTEM_BASE}
Be warm, conversational, and approachable. Use a friendly tone.
Make jokes when appropriate and show personality.
You may use *italic*, **bold**, and - bullet points with emojis.`,
    precise: `${SYSTEM_BASE}
Be extremely precise and analytical. Focus on accuracy and detail.
Provide structured, well-organized responses with technical depth.
You may use *italic*, **bold**, and - bullet points. Avoid fluff.`,
  };
  return styleGuides[style] || styleGuides.formal;
}

const OLLAMA_OPTIONS_8B = {
  think: false,
  num_ctx: 2048,
  num_predict: 1024,
  temperature: 0.7,
};
const OLLAMA_OPTIONS_4B = {
  think: false,
  num_ctx: 1024,
  num_predict: 512,
  temperature: 0.7,
};
const OLLAMA_OPTIONS_2B = {
  think: false,
  num_ctx: 768,
  num_predict: 384,
  temperature: 0.7,
};
const ALLOWED_MODELS = new Set([
  "qwen3-vl:8b-instruct",
  "qwen3-vl:4b-instruct",
  "qwen3-vl:2b-instruct",
]);

function normalizePlan(plan) {
  const value = String(plan || "Free").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "max") return "max";
  if (value === "pro") return "pro";
  return "free";
}

function getPlanRank(plan) {
  const normalized = normalizePlan(plan);
  if (normalized === "admin" || normalized === "max") return 2;
  if (normalized === "pro") return 1;
  return 0;
}

function getModelRank(model) {
  if (model === "qwen3-vl:8b-instruct") return 2;
  if (model === "qwen3-vl:4b-instruct") return 1;
  return 0;
}

function isModelAllowedForPlan(model, plan) {
  return getModelRank(model) <= getPlanRank(plan);
}

function getModelForPlan(plan) {
  const normalized = normalizePlan(plan);
  if (normalized === "admin" || normalized === "max")
    return "qwen3-vl:8b-instruct";
  if (normalized === "pro") return "qwen3-vl:4b-instruct";
  return "qwen3-vl:2b-instruct";
}

function getOptionsForModel(model) {
  if (model === "qwen3-vl:8b-instruct") return OLLAMA_OPTIONS_8B;
  if (model === "qwen3-vl:4b-instruct") return OLLAMA_OPTIONS_4B;
  return OLLAMA_OPTIONS_2B;
}

async function pipeOllamaChatStream(ollamaRes, expressRes, abortSignal) {
  const body = ollamaRes.body;
  if (!body) return;

  const onLine = (line) => {
    if (!line.trim()) return;
    try {
      const chunk = JSON.parse(line);
      const token = chunk?.message?.content ?? "";
      if (token && !expressRes.writableEnded && !expressRes.destroyed) {
        expressRes.write(token);
      }
    } catch {}
  };

  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let readerCancelled = false;
    const onAbort = () => {
      if (readerCancelled) return;
      readerCancelled = true;
      try {
        const cancelPromise = reader.cancel();
        if (cancelPromise && typeof cancelPromise.catch === "function") {
          cancelPromise.catch(() => {});
        }
      } catch {}
    };

    if (abortSignal) {
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      while (true) {
        if (expressRes.writableEnded || expressRes.destroyed) {
          onAbort();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.forEach(onLine);
      }
      if (buf) onLine(buf);
    } finally {
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
    }
  } else {
    await new Promise((resolve, reject) => {
      let buf = "";
      const onAbort = () => {
        try {
          body.destroy?.();
        } catch {}
        resolve();
      };

      if (abortSignal) {
        if (abortSignal.aborted) return onAbort();
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      body.on("data", (chunk) => {
        if (expressRes.writableEnded || expressRes.destroyed) {
          onAbort();
          return;
        }
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.forEach(onLine);
      });

      body.on("end", () => {
        if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
        if (buf) onLine(buf);
        resolve();
      });

      body.on("error", (err) => {
        if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  }
}

async function generateChatTitle(firstUserMessage) {
  const truncated = firstUserMessage.slice(0, 200);
  try {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3-vl:4b-instruct",
        messages: [
          {
            role: "user",
            content: `Kurzer Titel (max 3 Wörter, keine Anführungszeichen): "${truncated}"`,
          },
        ],
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 10,
          num_ctx: 256,
          think: false,
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    let title = (data?.message?.content ?? "")
      .trim()
      .replace(/^["'\s]+|["'\s]+$/g, "");
    if (title.split(" ").length > 5)
      title = title.split(" ").slice(0, 5).join(" ") + "…";
    return title || truncated.slice(0, 50);
  } catch {
    return truncated.slice(0, 50);
  }
}

app.post(
  "/api/chat/stream",
  requireAuth,
  upload.single("image"),
  async (req, res) => {
    const imageFile = req.file ?? null;
    const rawMessage =
      req.body.message?.trim() || (imageFile ? "Describe this image" : "");
    if (!rawMessage)
      return res.status(400).json({ error: "message or image required" });

    const message = stripImageMarkdown(rawMessage);
    const currentMessageImages = [];

    if (imageFile) {
      currentMessageImages.push(imageFile.buffer.toString("base64"));
    } else {
      const inlineImageUrls = extractImageUrlsFromMarkdown(rawMessage);
      for (const imageUrl of inlineImageUrls) {
        if (currentMessageImages.length >= MAX_CONTEXT_IMAGES) break;
        const filePath = resolveHistoryImageFileFromUrl(imageUrl);
        if (!filePath) continue;
        try {
          currentMessageImages.push(
            fs.readFileSync(filePath).toString("base64"),
          );
        } catch {}
      }
    }

    let userPlan = "Free";
    try {
      const planResult = await pool.query(
        `SELECT plan FROM users WHERE id = $1`,
        [req.userId],
      );
      userPlan = planResult.rows[0]?.plan || "Free";
    } catch {
      userPlan = "Free";
    }

    const requestedModel = req.body.model || getModelForPlan(userPlan);
    const requestedSafeModel = ALLOWED_MODELS.has(requestedModel)
      ? requestedModel
      : getModelForPlan(userPlan);
    const defaultModel = getModelForPlan(userPlan);
    const model = isModelAllowedForPlan(requestedSafeModel, userPlan)
      ? requestedSafeModel
      : defaultModel;
    const aiStyle = req.body.aiStyle || "formal";
    const internetAccessEnabled = parseBooleanFlag(req.body.internetAccess);
    const options = getOptionsForModel(model);

    let context = [];
    try {
      context = req.body.context ? JSON.parse(req.body.context) : [];
      if (!Array.isArray(context)) context = [];
    } catch {
      context = [];
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let webSources = [];
    let webUnavailable = false;

    if (internetAccessEnabled && message) {
      try {
        webSources = await fetchWebSources(message);
      } catch (err) {
        webUnavailable = true;
        console.warn("Web access unavailable:", err?.message || err);
      }
    }

    const systemPrompt = getSystemPrompt(aiStyle);
    const runtimeSystemContext = buildRuntimeSystemContextMessage();
    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      { role: "system", content: runtimeSystemContext },
      ...(webSources.length
        ? [
            {
              role: "system",
              content: buildWebContextSystemMessage(webSources),
            },
          ]
        : []),
      ...(internetAccessEnabled && webUnavailable
        ? [
            {
              role: "system",
              content:
                "The user asked for internet access, but it is currently unavailable. In this reply, start with one short sentence that internet access is unavailable, then continue normally using your own knowledge. Keep the user language.",
            },
          ]
        : []),
      ...buildContextMessagesForOllama(context),
      {
        role: "user",
        content:
          message || (currentMessageImages.length ? "Image attached." : ""),
        ...(currentMessageImages.length
          ? { images: currentMessageImages }
          : {}),
      },
    ];

    const upstreamAbort = new AbortController();
    const abortUpstream = () => {
      if (upstreamAbort.signal.aborted) return;
      try {
        upstreamAbort.abort();
      } catch {}
    };

    req.once("close", abortUpstream);
    res.once("close", abortUpstream);

    try {
      const ollamaRes = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: true,
          options,
        }),
        signal: upstreamAbort.signal,
      });

      if (!ollamaRes.ok) {
        return res.status(502).end("Upstream model error");
      }

      await pipeOllamaChatStream(ollamaRes, res, upstreamAbort.signal);
      if (!res.writableEnded && !res.destroyed && webSources.length) {
        res.write(formatWebSourcesMarkdown(webSources));
      }
      if (!res.writableEnded) res.end();
    } catch (err) {
      const aborted =
        upstreamAbort.signal.aborted || err?.name === "AbortError";
      if (aborted) {
        if (!res.writableEnded) res.end();
        return;
      }

      if (!res.headersSent) res.status(502).end("Model unavailable");
      else if (!res.writableEnded) res.end();
    } finally {
      req.removeListener("close", abortUpstream);
      res.removeListener("close", abortUpstream);
    }
  },
);

app.post(
  "/api/history/upload-image",
  requireAuth,
  upload.single("image"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image provided" });
    try {
      res.json({ url: saveImageToDisk(req.file.buffer, req.file.mimetype) });
    } catch (err) {
      console.error("Image save error:", err);
      res.status(500).json({ error: "Failed to save image" });
    }
  },
);

app.post("/api/history/save", requireAuth, async (req, res) => {
  const { messages, filename, generateTitle } = req.body;
  if (!Array.isArray(messages))
    return res.status(400).json({ error: "messages must be array" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let title = null;
    let chatId, targetFilename;

    if (filename) {
      const existing = await client.query(
        `SELECT id FROM chats WHERE user_id = $1 AND filename = $2`,
        [req.userId, filename],
      );
      if (!existing.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Chat not found" });
      }

      chatId = existing.rows[0].id;
      targetFilename = filename;
      await client.query(
        `UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [chatId],
      );
      await client.query(`DELETE FROM chat_messages WHERE chat_id = $1`, [
        chatId,
      ]);
    } else {
      const chatUuid = crypto.randomUUID();
      targetFilename = `chat_${chatUuid}.json`;
      const result = await client.query(
        `INSERT INTO chats (user_id, filename) VALUES ($1, $2) RETURNING id`,
        [req.userId, targetFilename],
      );
      chatId = result.rows[0].id;
    }

    for (const m of messages) {
      if (!m.content) continue;
      await client.query(
        `INSERT INTO chat_messages (chat_id, role, content) VALUES ($1, $2, $3)`,
        [chatId, m.role === "user" ? "user" : "assistant", m.content],
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, filename: targetFilename, title: null });

    if (generateTitle && !filename) {
      setImmediate(async () => {
        try {
          const firstUser =
            messages.find((m) => m.role === "user")?.content ?? "";
          const clean = firstUser.replace(/!\[.*?\]\([^)]+\)\n\n?/g, "").trim();
          if (clean) {
            const newTitle = await generateChatTitle(clean);
            const updateClient = await pool.connect();
            try {
              await updateClient.query(
                `UPDATE chats SET title = $1 WHERE id = $2`,
                [newTitle, chatId],
              );
            } finally {
              updateClient.release();
            }
          }
        } catch {}
      });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Save error:", err.message);
    res.status(500).json({ error: "Failed to save chat" });
  } finally {
    client.release();
  }
});

app.get("/api/history/:filename", requireAuth, async (req, res) => {
  try {
    const chatResult = await pool.query(
      `SELECT id, title, created_at, updated_at FROM chats WHERE user_id = $1 AND filename = $2`,
      [req.userId, req.params.filename],
    );
    if (!chatResult.rows[0])
      return res.status(404).json({ error: "Not found" });

    const chat = chatResult.rows[0];
    const msgResult = await pool.query(
      `SELECT role, content FROM chat_messages WHERE chat_id = $1 ORDER BY created_at ASC, id ASC`,
      [chat.id],
    );
    res.json({
      title: chat.title,
      timestamp: chat.created_at,
      updated: chat.updated_at,
      messages: msgResult.rows,
    });
  } catch (err) {
    console.error("Get chat error:", err.message);
    res.status(500).json({ error: "Failed to load chat" });
  }
});

app.delete("/api/history/:filename", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM chats WHERE user_id = $1 AND filename = $2 RETURNING id`,
      [req.userId, req.params.filename],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err.message);
    res.status(500).json({ error: "Failed to delete" });
  }
});

app.get("/api/history", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.filename, c.title, c.created_at, c.updated_at,
        CAST(COUNT(cm.id) AS INTEGER) AS message_count,
         (SELECT cm2.content FROM chat_messages cm2
          WHERE cm2.chat_id = c.id AND cm2.role = 'user'
          ORDER BY cm2.created_at ASC, cm2.id ASC LIMIT 1) AS first_user_message
       FROM chats c
       LEFT JOIN chat_messages cm ON cm.chat_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
      [req.userId],
    );
    res.json(
      result.rows.map((row) => ({
        filename: row.filename,
        created: row.created_at,
        updated: row.updated_at,
        messageCount: row.message_count,
        title: row.title ?? null,
        preview:
          row.title ||
          (row.first_user_message ?? "")
            .replace(/!\[.*?\]\([^)]+\)\n\n?/g, "")
            .slice(0, 60) ||
          "Neuer Chat",
      })),
    );
  } catch (err) {
    console.error("History list error:", err.message);
    res.status(500).json({ error: "Failed to list history" });
  }
});

app.get("/api/health", (_req, res) => {
  exec("ollama list", (err, stdout) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      ollama: err ? "unreachable" : "running",
      models: stdout || "none",
    });
  });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled:", err.message);
  res
    .status(err.status ?? 500)
    .json({ error: err.message || "Internal server error" });
});
app.get("/api/stats", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        CAST((SELECT COUNT(*) FROM users) AS INTEGER)        AS total_users,
        CAST((SELECT COUNT(*) FROM chats) AS INTEGER)        AS total_chats,
        CAST((SELECT COUNT(*) FROM chat_messages) AS INTEGER) AS total_messages
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Stats error:", err.message);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

app.post("/api/contact", (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const contactDir = path.join(__dirname, "contacts");
    if (!fs.existsSync(contactDir)) {
      fs.mkdirSync(contactDir, { recursive: true });
    }

    const contactData = {
      name,
      email,
      subject,
      message,
      timestamp: new Date().toISOString(),
    };

    const filename = `contact_${Date.now()}.json`;
    fs.writeFileSync(
      path.join(contactDir, filename),
      JSON.stringify(contactData, null, 2),
    );

    res.json({ success: true, message: "Contact message received" });
  } catch (err) {
    console.error("Contact error:", err.message);
    res.status(500).json({ error: "Failed to process contact message" });
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Wieland http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("DB init failed:", err.message);
    process.exit(1);
  });
