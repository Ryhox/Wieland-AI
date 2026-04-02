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

function isEnvEnabled(value, fallback = true) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

const app = express();
const PORT = process.env.PORT || 3001;
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";
const OLLAMA_PREWARM_TIMEOUT_MS = Math.max(
  5_000,
  parseInt(process.env.OLLAMA_PREWARM_TIMEOUT_MS || "90000", 10) || 90_000,
);
const OLLAMA_STARTUP_PREWARM_ENABLED = isEnvEnabled(
  process.env.OLLAMA_STARTUP_PREWARM,
  true,
);
const OLLAMA_STARTUP_PREWARM_DELAY_MS = Math.max(
  0,
  parseInt(process.env.OLLAMA_STARTUP_PREWARM_DELAY_MS || "0", 10) || 0,
);
const OLLAMA_STARTUP_PREWARM_MODELS_RAW = String(
  process.env.OLLAMA_STARTUP_PREWARM_MODELS || "",
);
const INTENT_NLU_ENABLED = isEnvEnabled(process.env.INTENT_NLU_ENABLED, true);
const INTENT_NLU_DEBUG = isEnvEnabled(process.env.INTENT_NLU_DEBUG, false);
const INTENT_NLU_MAX_MESSAGE_CHARS = Math.max(
  120,
  parseInt(process.env.INTENT_NLU_MAX_MESSAGE_CHARS || "520", 10) || 520,
);
const INTENT_NLU_MODEL =
  process.env.INTENT_NLU_MODEL ||
  process.env.MEMORY_NLU_MODEL ||
  "qwen3-vl:2b-instruct";
const INTENT_NLU_TIMEOUT_MS = Math.max(
  900,
  parseInt(
    process.env.INTENT_NLU_TIMEOUT_MS ||
      process.env.MEMORY_NLU_TIMEOUT_MS ||
      "2800",
    10,
  ) || 2_800,
);
const INTENT_NLU_MAX_MEMORY_ITEMS = Math.max(
  1,
  Math.min(
    6,
    parseInt(
      process.env.INTENT_NLU_MAX_MEMORY_ITEMS ||
        process.env.MEMORY_NLU_MAX_ITEMS ||
        "3",
      10,
    ) || 3,
  ),
);

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

      CREATE TABLE IF NOT EXISTS user_memories (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        memory_key  TEXT    NOT NULL,
        memory_value TEXT   NOT NULL,
        is_explicit INTEGER NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, memory_key, memory_value)
      );

      CREATE INDEX IF NOT EXISTS idx_chats_user_id    ON chats(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chat_messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
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

app.get("/api/auth/memories", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, memory_key, memory_value, is_explicit, usage_count,
              last_used_at, created_at, updated_at
       FROM user_memories
       WHERE user_id = $1
       ORDER BY updated_at DESC, id DESC`,
      [req.userId],
    );

    const memories = (result.rows || []).map((row) => ({
      id: row.id,
      key: row.memory_key,
      label: formatMemoryLabel(row.memory_key),
      value: row.memory_value,
      isExplicit: Boolean(row.is_explicit),
      usageCount: Number(row.usage_count || 0),
      lastUsedAt: row.last_used_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ memories });
  } catch (err) {
    console.error("List memories error:", err.message);
    res.status(500).json({ error: "Failed to load memories" });
  }
});

app.delete("/api/auth/memories/:id", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid memory id" });
  }

  try {
    const result = await pool.query(
      `DELETE FROM user_memories WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.userId],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Memory entry not found" });
    }

    res.json({ success: true, id });
  } catch (err) {
    console.error("Delete memory error:", err.message);
    res.status(500).json({ error: "Failed to delete memory entry" });
  }
});

app.delete("/api/auth/memories", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM user_memories WHERE user_id = $1`,
      [req.userId],
    );

    res.json({ success: true, deleted: Number(result.rowCount || 0) });
  } catch (err) {
    console.error("Clear memories error:", err.message);
    res.status(500).json({ error: "Failed to clear memories" });
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
- You CAN generate complete website/app/code solutions when asked.
- Do not claim you cannot create websites or code.
- You do NOT represent any company (Alibaba, OpenAI, Anthropic, etc.).
- Internet snippets can be provided by the server. Use them only when present.
- Answer only what the user asked. Skip unrelated prefaces and meta commentary.
- Do not mention date/time/timezone/calendar details unless the user explicitly asks for them.
- Do not narrate internal actions (for example: "checks the clock" or "checks the server clock").
- Never guess specific factual values (for example birth dates, death dates, places, or statistics). If unsure, say you are unsure.
- Keep answers concise by default. Expand only when the user asks for more detail.
Always respond in the exact language of the user's last message.`;

const IMAGE_MD_REGEX = /!\[[^\]]*\]\(([^)]+)\)/g;
const MAX_CONTEXT_IMAGES = 4;
const WEB_SEARCH_TIMEOUT_MS = 7_000;
const MAX_WEB_SOURCES = 4;
const MAX_WEB_SNIPPET_CHARS = 320;
const MAX_PAGE_CONTEXT_CONTENT_CHARS = 4_500;
const CLARIFY_JSON_BLOCK_START = "[[WIELAND_CLARIFY_JSON]]";
const CLARIFY_JSON_BLOCK_END = "[[/WIELAND_CLARIFY_JSON]]";
const CLARIFY_JSON_BLOCK_ANY_RE =
  /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]([\s\S]*?)\[\[\s*\/\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_OPTION_LINE_RE = /^\s*[A-E][)\].:-]\s*.+$/i;
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

function getLastUserContextMessage(context = []) {
  for (let i = context.length - 1; i >= 0; i--) {
    const item = context[i];
    if (item?.role === "user") {
      return String(item?.content || "");
    }
  }
  return "";
}

function emptyMessageIntentSignals() {
  return {
    asksTime: false,
    asksTodayEvents: false,
    asksLiveWeb: false,
    explicitWebLookup: false,
    liveFollowup: false,
    needsMemoryContext: false,
    explicitRemember: false,
    memoryHintKeys: [],
    memoryItems: [],
  };
}

function toIntentBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "on";
}

function toUniqueHintKeys(values = []) {
  const out = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = normalizeHintKey(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

const INTENT_TIME_PHRASES = [
  "wie spaet ist es",
  "wie spat ist es",
  "uhrzeit",
  "what time",
  "current time",
  "time now",
  "date today",
  "heutiges datum",
  "che ora",
  "ora",
  "orario",
  "timezone",
  "time zone",
  "zeitzone",
  "fuso orario",
];

const INTENT_NEWS_PHRASES = [
  "news",
  "nachrichten",
  "notizie",
  "headlines",
  "breaking",
  "latest updates",
  "current events",
  "news von heute",
  "today news",
  "today in history",
  "what happened today",
  "what is happening today",
  "was ist heute passiert",
  "was passiert heute",
  "cosa e successo oggi",
  "cosa succede oggi",
];

const INTENT_LIVE_TOPIC_PHRASES = [
  "weather",
  "forecast",
  "wetter",
  "meteo",
  "stock",
  "aktie",
  "borsa",
  "crypto",
  "traffic",
  "verkehr",
  "flight status",
  "sports scores",
  "results",
  "release date",
  "trending",
];

const INTENT_WEB_LOOKUP_PHRASES = [
  "search web",
  "web search",
  "google",
  "duckduckgo",
  "bing",
  "internet",
  "online search",
  "with sources",
  "source links",
  "citations",
  "mit quellen",
  "quellen",
  "con fonti",
  "fonti",
];

const INTENT_FACT_LOOKUP_PHRASES = [
  "wann wurde",
  "wann ist",
  "wann starb",
  "wann ist gestorben",
  "wann war",
  "when was",
  "when did",
  "when is",
  "when died",
  "born",
  "birth date",
  "birth year",
  "geboren",
  "geburtsdatum",
  "geburtsjahr",
  "gestorben",
  "todesdatum",
  "todesjahr",
  "wer ist",
  "who is",
  "who was",
  "where was",
  "wo wurde",
  "wo ist",
  "quando e nato",
  "quando nacque",
  "quando e morto",
  "chi e",
  "chi era",
  "dove e nato",
  "dove e",
  "nato",
  "morto",
];

const CLARIFY_BUILD_VERB_PHRASES = [
  "mach",
  "mache",
  "build",
  "make",
  "create",
  "generate",
  "generat",
  "generier",
  "genera",
  "erstell",
  "baue",
  "program",
  "entwickl",
  "crea",
  "sviluppa",
  "fai",
];

const CLARIFY_BROAD_TARGET_PHRASES = [
  "eine app",
  "ein app",
  "an app",
  "app",
  "website",
  "webseite",
  "landing page",
  "tool",
  "projekt",
  "project",
  "bot",
  "script",
  "programm",
  "program",
  "dashboard",
  "automation",
  "automatisierung",
  "extension",
];

const CLARIFY_SPECIFIC_SCOPE_HINT_PHRASES = [
  "react",
  "vue",
  "svelte",
  "html",
  "css",
  "javascript",
  "typescript",
  "node",
  "python",
  "java",
  "single file",
  "mehrere dateien",
  "backend",
  "frontend",
  "api",
  "mobile",
  "ios",
  "android",
  "chrome extension",
  "browser extension",
  "deadline",
  "budget",
  "zielgruppe",
  "target audience",
];

const INTENT_MEMORY_QUERY_PHRASES = [
  "what do you remember",
  "do you remember",
  "about me",
  "who am i",
  "how old am i",
  "my age",
  "my name",
  "where do i live",
  "where am i from",
  "was weisst du uber mich",
  "was weisst du ueber mich",
  "wer bin ich",
  "wie alt bin ich",
  "mein alter",
  "wie heisse ich",
  "wo wohne ich",
  "ricordi",
  "su di me",
  "quanti anni ho",
  "come mi chiamo",
  "was mag ich",
  "what do i like",
  "cosa mi piace",
];

const INTENT_REMEMBER_PHRASES = [
  "remember",
  "please remember",
  "keep this in mind",
  "merk dir",
  "bitte merk dir",
  "ricorda",
  "ricorda che",
];

const INTENT_FOLLOWUP_PHRASES = [
  "yes",
  "yep",
  "yeah",
  "ja",
  "ok",
  "okay",
  "continue",
  "continua",
  "do it",
  "go on",
  "mach weiter",
  "mach es",
];

const INTENT_AGE_HINT_PHRASES = [
  "age",
  "years old",
  "how old",
  "jahre",
  "wie alt",
  "anni",
  "quanti anni",
  "mein alter",
  "my age",
];

const INTENT_NAME_HINT_PHRASES = [
  "name",
  "wie heisse ich",
  "come mi chiamo",
  "called",
  "my name",
];

const INTENT_LOCATION_HINT_PHRASES = [
  "where do i live",
  "where am i from",
  "wo wohne ich",
  "woher komme ich",
  "dove vivo",
  "di dove sono",
  "from",
  "live in",
];

const INTENT_FAVORITE_HINT_PHRASES = [
  "favorite",
  "prefer",
  "lieblings",
  "ich mag",
  "mag ich",
  "i like",
  "i love",
  "mi piace",
  "what do i like",
  "was mag ich",
  "cosa mi piace",
];

const INTENT_PREFERENCE_PREFIX_PHRASES = [
  "i like",
  "i love",
  "ich mag",
  "ich liebe",
  "mi piace",
  "mi piacciono",
  "amo",
  "prefer",
  "my favorite is",
  "mein lieblings",
  "mein liebling ist",
  "il mio preferito e",
];

const INTENT_PREFERENCE_STOP_PHRASES = [
  " and ",
  " und ",
  " e ",
  " but ",
  " aber ",
  " ma ",
  " because ",
  " weil ",
  " perche ",
  " that ",
  " dass ",
  " che ",
];

const INTENT_PREFERENCE_LEADING_WORDS = [
  "the",
  "a",
  "an",
  "der",
  "die",
  "das",
  "ein",
  "eine",
  "einen",
  "la",
  "il",
  "lo",
  "i",
  "gli",
  "le",
  "un",
  "una",
  "uno",
];

function foldIntentChars(value) {
  const source = String(value || "").toLowerCase();
  let out = "";

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "a" || ch === "b" || ch === "c" || ch === "d" || ch === "e") {
      out += ch;
      continue;
    }
    if (ch === "f" || ch === "g" || ch === "h" || ch === "i" || ch === "j") {
      out += ch;
      continue;
    }
    if (ch === "k" || ch === "l" || ch === "m" || ch === "n" || ch === "o") {
      out += ch;
      continue;
    }
    if (ch === "p" || ch === "q" || ch === "r" || ch === "s" || ch === "t") {
      out += ch;
      continue;
    }
    if (ch === "u" || ch === "v" || ch === "w" || ch === "x" || ch === "y" || ch === "z") {
      out += ch;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      out += ch;
      continue;
    }
    if (ch === "ä") {
      out += "ae";
      continue;
    }
    if (ch === "ö") {
      out += "oe";
      continue;
    }
    if (ch === "ü") {
      out += "ue";
      continue;
    }
    if (ch === "ß") {
      out += "ss";
      continue;
    }
    if (ch === "à" || ch === "á" || ch === "â" || ch === "ã") {
      out += "a";
      continue;
    }
    if (ch === "è" || ch === "é" || ch === "ê") {
      out += "e";
      continue;
    }
    if (ch === "ì" || ch === "í" || ch === "î") {
      out += "i";
      continue;
    }
    if (ch === "ò" || ch === "ó" || ch === "ô") {
      out += "o";
      continue;
    }
    if (ch === "ù" || ch === "ú" || ch === "û") {
      out += "u";
      continue;
    }
    out += " ";
  }

  return out;
}

function compactIntentText(value, maxLen = 360) {
  const folded = foldIntentChars(value);
  let out = "";
  let lastWasSpace = true;

  for (let i = 0; i < folded.length; i++) {
    if (out.length >= maxLen) break;
    const ch = folded[i];
    const isSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
    if (isSpace) {
      if (!lastWasSpace && out.length > 0) {
        out += " ";
        lastWasSpace = true;
      }
      continue;
    }
    out += ch;
    lastWasSpace = false;
  }

  if (out.endsWith(" ")) out = out.slice(0, -1);
  return out;
}

function containsAnyPhrase(text, phrases = []) {
  if (!text) return false;
  for (const phrase of phrases) {
    const needle = compactIntentText(phrase, 120);
    if (!needle) continue;
    if (text.includes(needle)) return true;
  }
  return false;
}

function extractFirstIntegerFromText(text) {
  const parts = String(text || "").split(" ");
  for (const part of parts) {
    let digits = "";
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (ch >= "0" && ch <= "9") {
        digits += ch;
      } else if (digits.length > 0) {
        break;
      }
    }
    if (!digits) continue;
    const value = Number(digits);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function trimLeadingIntentWords(text, blockedWords = []) {
  const words = String(text || "")
    .split(" ")
    .filter(Boolean);

  while (words.length > 0 && blockedWords.includes(words[0])) {
    words.shift();
  }

  return words.join(" ");
}

function extractPreferenceCandidateFromText(text = "") {
  const source = String(text || "");
  if (!source) return "";

  for (const rawPrefix of INTENT_PREFERENCE_PREFIX_PHRASES) {
    const prefix = compactIntentText(rawPrefix, 80);
    if (!prefix) continue;

    const index = source.indexOf(prefix);
    if (index < 0) continue;

    let tail = source.slice(index + prefix.length).trim();
    if (!tail) continue;

    let cutPos = tail.length;
    for (const stopPhrase of INTENT_PREFERENCE_STOP_PHRASES) {
      const stop = compactIntentText(stopPhrase, 30);
      if (!stop) continue;
      const stopIndex = tail.indexOf(stop);
      if (stopIndex > 0 && stopIndex < cutPos) {
        cutPos = stopIndex;
      }
    }

    tail = tail.slice(0, cutPos).trim();
    tail = trimLeadingIntentWords(tail, INTENT_PREFERENCE_LEADING_WORDS);
    if (!tail) continue;

    const words = tail.split(" ").filter(Boolean).slice(0, 6);
    const candidate = words.join(" ").trim();
    if (candidate.length < 2) continue;
    return candidate;
  }

  return "";
}

function hasAnyIntentSignal(intent) {
  if (!intent) return false;
  return (
    intent.asksTime ||
    intent.asksTodayEvents ||
    intent.asksLiveWeb ||
    intent.explicitWebLookup ||
    intent.liveFollowup ||
    intent.needsMemoryContext ||
    intent.explicitRemember ||
    (Array.isArray(intent.memoryHintKeys) && intent.memoryHintKeys.length > 0) ||
    (Array.isArray(intent.memoryItems) && intent.memoryItems.length > 0)
  );
}

function buildDeterministicBackupIntentSignals(message = "", previousUserMessage = "") {
  const signals = emptyMessageIntentSignals();
  const text = compactIntentText(message, 420);
  if (!text) return signals;

  const previous = compactIntentText(previousUserMessage, 420);

  const asksTime = containsAnyPhrase(text, INTENT_TIME_PHRASES);
  const asksNews = containsAnyPhrase(text, INTENT_NEWS_PHRASES);
  const asksLiveTopic = containsAnyPhrase(text, INTENT_LIVE_TOPIC_PHRASES);
  const explicitWeb = containsAnyPhrase(text, INTENT_WEB_LOOKUP_PHRASES);
  const needsMemory = containsAnyPhrase(text, INTENT_MEMORY_QUERY_PHRASES);
  const explicitRemember = containsAnyPhrase(text, INTENT_REMEMBER_PHRASES);

  const followup = containsAnyPhrase(text, INTENT_FOLLOWUP_PHRASES);
  const previousWasLive =
    containsAnyPhrase(previous, INTENT_NEWS_PHRASES) ||
    containsAnyPhrase(previous, INTENT_LIVE_TOPIC_PHRASES) ||
    containsAnyPhrase(previous, INTENT_WEB_LOOKUP_PHRASES);

  signals.asksTodayEvents = asksNews;
  signals.asksLiveWeb = asksNews || asksLiveTopic || explicitWeb;
  signals.explicitWebLookup = explicitWeb;
  signals.asksTime = asksTime && !asksNews;
  signals.liveFollowup = followup && previousWasLive;
  signals.needsMemoryContext = needsMemory;
  signals.explicitRemember = explicitRemember;

  const hintKeys = [];
  if (containsAnyPhrase(text, INTENT_AGE_HINT_PHRASES)) hintKeys.push("age");
  if (containsAnyPhrase(text, INTENT_NAME_HINT_PHRASES)) hintKeys.push("name");
  if (containsAnyPhrase(text, INTENT_LOCATION_HINT_PHRASES))
    hintKeys.push("location");
  if (containsAnyPhrase(text, INTENT_FAVORITE_HINT_PHRASES))
    hintKeys.push("favorite");
  if (needsMemory || explicitRemember) hintKeys.push("note");

  const memoryItems = [];
  const ageCandidate = extractFirstIntegerFromText(text);
  if (
    ageCandidate != null &&
    ageCandidate >= 3 &&
    ageCandidate <= 120 &&
    containsAnyPhrase(text, INTENT_AGE_HINT_PHRASES)
  ) {
    memoryItems.push({
      key: "age",
      value: String(ageCandidate),
      explicit: explicitRemember,
    });
  }

  const preferenceCandidate = extractPreferenceCandidateFromText(text);
  if (preferenceCandidate) {
    memoryItems.push({
      key: `favorite_${toMemoryKeySuffix(preferenceCandidate)}`,
      value: preferenceCandidate,
      explicit: explicitRemember,
    });
    hintKeys.push("favorite");
    signals.needsMemoryContext = true;
  }

  signals.memoryHintKeys = toUniqueHintKeys(hintKeys);
  signals.memoryItems = mergeMemoryCandidates([], memoryItems);

  return signals;
}

function mergeMessageIntentSignals(
  baseIntent = emptyMessageIntentSignals(),
  modelIntent = emptyMessageIntentSignals(),
) {
  const merged = {
    ...emptyMessageIntentSignals(),
    ...baseIntent,
    ...modelIntent,
  };

  merged.asksTime = Boolean(baseIntent.asksTime || modelIntent.asksTime);
  merged.asksTodayEvents = Boolean(
    baseIntent.asksTodayEvents || modelIntent.asksTodayEvents,
  );
  merged.asksLiveWeb = Boolean(
    baseIntent.asksLiveWeb || modelIntent.asksLiveWeb,
  );
  merged.explicitWebLookup = Boolean(
    baseIntent.explicitWebLookup || modelIntent.explicitWebLookup,
  );
  merged.liveFollowup = Boolean(
    baseIntent.liveFollowup || modelIntent.liveFollowup,
  );
  merged.needsMemoryContext = Boolean(
    baseIntent.needsMemoryContext || modelIntent.needsMemoryContext,
  );
  merged.explicitRemember = Boolean(
    baseIntent.explicitRemember || modelIntent.explicitRemember,
  );
  merged.memoryHintKeys = toUniqueHintKeys([
    ...(baseIntent.memoryHintKeys || []),
    ...(modelIntent.memoryHintKeys || []),
  ]);
  merged.memoryItems = mergeMemoryCandidates(
    baseIntent.memoryItems || [],
    modelIntent.memoryItems || [],
  );

  return merged;
}

function shouldIncludeRuntimeClockContext(
  _message = "",
  _context = [],
  intentSignals = null,
) {
  const intent = mergeMessageIntentSignals(
    emptyMessageIntentSignals(),
    intentSignals || emptyMessageIntentSignals(),
  );

  const likelyLiveQuery =
    intent.asksTodayEvents ||
    intent.asksLiveWeb ||
    intent.explicitWebLookup ||
    intent.liveFollowup;
  if (likelyLiveQuery) return false;

  return intent.asksTime;
}

function isLikelyFactualLookupQuery(message = "") {
  const text = compactIntentText(message, 420);
  if (!text) return false;

  if (containsAnyPhrase(text, INTENT_FACT_LOOKUP_PHRASES)) return true;

  const startsWithWhWord =
    text.startsWith("when ") ||
    text.startsWith("wann ") ||
    text.startsWith("quando ") ||
    text.startsWith("where ") ||
    text.startsWith("wo ") ||
    text.startsWith("dove ") ||
    text.startsWith("who ") ||
    text.startsWith("wer ") ||
    text.startsWith("chi ");

  const words = text.split(" ").filter(Boolean);
  const mathLike = /^[\d\s+\-*/().=]+$/.test(text);

  return startsWithWhWord && words.length >= 3 && !mathLike;
}

function shouldRunWebLookup(
  message = "",
  _context = [],
  intentSignals = null,
  options = {},
) {
  const query = String(message || "").trim();
  if (!query) return false;

  const intent = mergeMessageIntentSignals(
    emptyMessageIntentSignals(),
    intentSignals || emptyMessageIntentSignals(),
  );

  const pageContextAvailable = options?.pageContextAvailable === true;
  const preferPageContext = options?.preferPageContext === true;
  const shouldPreferPageContext = pageContextAvailable && preferPageContext;

  if (intent.asksTodayEvents) return true;
  if (intent.liveFollowup) return true;
  if (intent.explicitWebLookup) return true;

  if (intent.asksTime) return false;

  if (intent.asksLiveWeb) return true;

  if (shouldPreferPageContext) return false;

  if (isLikelyFactualLookupQuery(query)) return true;

  return false;
}

function isLikelyVagueBuildRequest(message = "", context = []) {
  const text = compactIntentText(message, 420);
  if (!text) return false;

  const wordCount = text.split(" ").filter(Boolean).length;
  const hasBuildVerb = containsAnyPhrase(text, CLARIFY_BUILD_VERB_PHRASES);
  const hasBroadTarget = containsAnyPhrase(text, CLARIFY_BROAD_TARGET_PHRASES);
  const hasSpecificScopeHint = containsAnyPhrase(
    text,
    CLARIFY_SPECIFIC_SCOPE_HINT_PHRASES,
  );

  const isLikelyFirstTurn = !Array.isArray(context) || context.length <= 2;

  if (hasBuildVerb && hasBroadTarget && !hasSpecificScopeHint && wordCount <= 10) {
    return true;
  }

  if (isLikelyFirstTurn && hasBuildVerb && wordCount <= 6) {
    return true;
  }

  return false;
}

function isSingleClarifyOptionReply(message = "") {
  const text = compactIntentText(message, 80);
  if (!text) return false;

  if (/^[abcde]$/.test(text)) return true;
  if (/^option\s+[abcde]$/.test(text)) return true;
  if (/^wahl\s+[abcde]$/.test(text)) return true;
  if (/^scelta\s+[abcde]$/.test(text)) return true;

  const qaOptionMatch = text.match(
    /\ba\s*:\s*(?:option\s+|wahl\s+|scelta\s+)?([abcde])(?:[)\].:-]|\b)/,
  );
  if (qaOptionMatch) return true;

  return false;
}

function detectClarifyLanguage(message = "") {
  const text = compactIntentText(message, 300);
  if (!text) return "en";

  if (
    /[àèéìíîòóù]/i.test(text) ||
    /\b(che|quando|dove|vorrei|fammi|crea|costruisci|sito|estensione|automazione)\b/i.test(text)
  ) {
    return "it";
  }

  if (
    /[äöüß]/i.test(text) ||
    /\b(und|oder|ich|bitte|mach|baue|erstell|frage|website|webseite)\b/i.test(text)
  ) {
    return "de";
  }

  return "en";
}

function buildForcedClarificationFallbackPayload(message = "") {
  const lang = detectClarifyLanguage(message);

  if (lang === "de") {
    return {
      question: "Worauf soll ich mich zuerst fokussieren?",
      options: [
        { id: "A", label: "Website oder Landingpage" },
        { id: "B", label: "Web-App" },
        { id: "C", label: "Browser-Erweiterung" },
        { id: "D", label: "Automatisierung oder Script" },
        { id: "E", label: "Etwas anderes" },
      ],
      allowFreeform: true,
      freeformPlaceholder: "Kurz beschreiben",
      skipLabel: "Überspringen",
      step: 1,
      totalSteps: 1,
    };
  }

  if (lang === "it") {
    return {
      question: "Su cosa devo concentrarmi per prima cosa?",
      options: [
        { id: "A", label: "Sito web o landing page" },
        { id: "B", label: "Web app" },
        { id: "C", label: "Estensione browser" },
        { id: "D", label: "Automazione o script" },
        { id: "E", label: "Altro" },
      ],
      allowFreeform: true,
      freeformPlaceholder: "Descrivilo in breve",
      skipLabel: "Salta",
      step: 1,
      totalSteps: 1,
    };
  }

  return {
    question: "What should I focus on first?",
    options: [
      { id: "A", label: "Website or landing page" },
      { id: "B", label: "Web app" },
      { id: "C", label: "Browser extension" },
      { id: "D", label: "Automation or script" },
      { id: "E", label: "Something else" },
    ],
    allowFreeform: true,
    freeformPlaceholder: "Describe briefly",
    skipLabel: "Skip",
    step: 1,
    totalSteps: 1,
  };
}

function hasClarificationPayload(text = "") {
  const source = String(text || "");
  if (!source.trim()) return false;

  if (CLARIFY_JSON_BLOCK_ANY_RE.test(source)) return true;

  let optionCount = 0;
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    if (!CLARIFY_OPTION_LINE_RE.test(line)) continue;
    optionCount += 1;
    if (optionCount >= 2) return true;
  }

  return false;
}

const SINGLE_VALUE_MEMORY_KEYS = new Set([
  "name",
  "age",
  "location",
  "birthday",
  "timezone",
  "occupation",
]);
const MEMORY_KEY_ALIASES = new Map([
  ["full_name", "name"],
  ["first_name", "name"],
  ["years_old", "age"],
  ["age_years", "age"],
  ["years", "age"],
  ["city", "location"],
  ["country", "location"],
  ["birth_date", "birthday"],
  ["profession", "occupation"],
  ["job", "occupation"],
  ["work", "occupation"],
  ["likes", "favorite"],
  ["like", "favorite"],
  ["preference", "favorite"],
  ["preferences", "favorite"],
  ["favorite_animal", "favorite_animals"],
  ["favorite_animals", "favorite_animals"],
  ["note", "note"],
  ["memo", "note"],
]);

function collapseWhitespace(value) {
  const source = String(value || "");
  let out = "";
  let seenText = false;
  let lastWasSpace = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const code = ch.charCodeAt(0);
    const isSpace = code <= 32 || code === 160;

    if (isSpace) {
      if (seenText) {
        lastWasSpace = true;
      }
      continue;
    }

    if (lastWasSpace && out) out += " ";
    out += ch;
    seenText = true;
    lastWasSpace = false;
  }

  return out;
}

function trimUnderscores(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "_") start++;
  while (end > start && value[end - 1] === "_") end--;
  return value.slice(start, end);
}

function toUnderscoreKey(value, maxLen = 60) {
  const source = collapseWhitespace(value).toLowerCase();
  let out = "";
  let lastWasUnderscore = false;

  for (let i = 0; i < source.length; i++) {
    if (out.length >= maxLen) break;
    const code = source.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isLower = code >= 97 && code <= 122;

    if (isDigit || isLower) {
      out += source[i];
      lastWasUnderscore = false;
      continue;
    }

    if (!lastWasUnderscore && out.length > 0) {
      out += "_";
      lastWasUnderscore = true;
    }
  }

  return trimUnderscores(out);
}

function normalizeMemoryText(value, maxLen = 180) {
  return collapseWhitespace(value).slice(0, maxLen);
}

function toMemoryKeySuffix(value) {
  const normalized = toUnderscoreKey(normalizeMemoryText(value, 30), 30);
  return normalized || "item";
}

function parseJsonObjectFromText(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const candidates = [];

  if (text.startsWith("```")) {
    const headerEnd = text.indexOf("\n", 3);
    const contentStart = headerEnd >= 0 ? headerEnd + 1 : 3;
    const closeFence = text.indexOf("```", contentStart);
    if (closeFence > contentStart) {
      const fencedPayload = text.slice(contentStart, closeFence).trim();
      if (fencedPayload) candidates.push(fencedPayload);
    }
  }

  candidates.push(text);

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function normalizeSuggestedMemoryKey(rawKey, rawValue) {
  let key = toUnderscoreKey(normalizeMemoryText(rawKey, 60), 60);

  if (!key) key = "note";
  if (MEMORY_KEY_ALIASES.has(key)) key = MEMORY_KEY_ALIASES.get(key);

  if (
    key.startsWith("favorite") &&
    key !== "favorite" &&
    !key.startsWith("favorite_")
  ) {
    let suffix = key.slice("favorite".length);
    while (suffix.startsWith("_")) suffix = suffix.slice(1);
    key = suffix ? `favorite_${suffix}` : "favorite";
  }
  if (key === "favorite") {
    key = `favorite_${toMemoryKeySuffix(rawValue)}`;
  }
  if (key === "note") {
    key = `note_${crypto
      .createHash("sha1")
      .update(normalizeMemoryText(rawValue, 220))
      .digest("hex")
      .slice(0, 12)}`;
  }

  return key;
}

function sanitizeMemoryCandidate(candidate, defaultExplicit = false) {
  const value = normalizeMemoryText(candidate?.value, 180);
  if (!value) return null;

  const key = normalizeSuggestedMemoryKey(candidate?.key, value);
  if (!key) return null;

  const explicit =
    candidate?.explicit === true || candidate?.explicit === 1 || defaultExplicit;

  return { key, value, explicit };
}

function mergeMemoryCandidates(base = [], extra = []) {
  const map = new Map();

  for (const candidate of [...base, ...extra]) {
    if (!candidate?.key || !candidate?.value) continue;
    const signature = `${candidate.key}::${candidate.value}`;
    const existing = map.get(signature);
    if (!existing) {
      map.set(signature, { ...candidate });
      continue;
    }
    if (candidate.explicit) existing.explicit = true;
  }

  return [...map.values()];
}

function normalizeHintKey(key) {
  const source = normalizeMemoryText(key, 60);
  if (!source) return "";

  const normalized = normalizeSuggestedMemoryKey(source, source);
  if (normalized.startsWith("favorite_")) return "favorite";
  if (normalized.startsWith("note_")) return "note";
  return normalized;
}

function getIntentNluModel() {
  if (ALLOWED_MODELS.has(INTENT_NLU_MODEL)) return INTENT_NLU_MODEL;
  return "qwen3-vl:2b-instruct";
}

const ROUTER_ACTION_VALUES = new Set([
  "CHAT",
  "MEMORY_STORE",
  "MEMORY_QUERY",
  "SEARCH_WEB",
  "READ_PAGE",
  "POPUP_ACTION",
]);

function normalizeRouterAction(value = "") {
  const action = String(value || "")
    .trim()
    .toUpperCase();
  return ROUTER_ACTION_VALUES.has(action) ? action : "";
}

async function analyzeMessageIntentWithModel(message, previousUserMessage = "") {
  const emptyIntent = emptyMessageIntentSignals();
  if (!INTENT_NLU_ENABLED) return emptyIntent;

  const userText = normalizeMemoryText(message, INTENT_NLU_MAX_MESSAGE_CHARS);
  const previousText = normalizeMemoryText(
    previousUserMessage,
    INTENT_NLU_MAX_MESSAGE_CHARS,
  );
  if (!userText) return emptyIntent;

  const systemInstruction = [
    "You are an intelligent request router for a browser assistant.",
    "Analyze the user's message and choose exactly one action.",
    "Understand intent, not keywords.",
    "Work in any language and tolerate slang, typos, and casual phrasing.",
    "Use previous_user_message only as optional context for short follow-ups.",
    "Return ONLY strict JSON with this schema:",
    '{"action": "CHAT|MEMORY_STORE|MEMORY_QUERY|SEARCH_WEB|READ_PAGE|POPUP_ACTION", "reason": string, "memory": string, "search_query": string, "confidence": number}.',
    "Action policy:",
    "- MEMORY_STORE: only when user shares stable, useful personal info (name, preferences, goals). Ignore temporary states.",
    "- MEMORY_QUERY: user asks what you know/remember about them.",
    "- SEARCH_WEB: up-to-date info or external facts are required (news, prices, latest updates, factual lookup).",
    "- READ_PAGE: user refers to current page content (for example summarize this page / what does this site say).",
    "- POPUP_ACTION: user interacts with extension UI (open settings, change theme, toggle memory).",
    "- CHAT: default fallback.",
    "reason must be short.",
    "confidence must be a number in [0,1].",
    "If action is not MEMORY_STORE, return memory as an empty string.",
    "If action is not SEARCH_WEB, return search_query as an empty string.",
    "No markdown. No explanation. JSON only.",
  ].join("\n");

  const compactFallbackInstruction = [
    "Analyze a user message in ANY language.",
    "Return ONLY strict JSON with this minimal schema:",
    '{"action": "CHAT|MEMORY_STORE|MEMORY_QUERY|SEARCH_WEB|READ_PAGE|POPUP_ACTION", "reason": string, "memory": string, "search_query": string, "confidence": number}.',
    "If unsure, choose the most likely intent from the message.",
    "No markdown. No explanation. JSON only.",
  ].join("\n");

  const userPayload = JSON.stringify({
    previous_user_message: previousText || null,
    current_user_message: userText,
  });

  async function requestIntentObject(
    instruction,
    numPredict = 220,
    timeoutMs = INTENT_NLU_TIMEOUT_MS,
  ) {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getIntentNluModel(),
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: userPayload },
        ],
        stream: false,
        format: "json",
        options: {
          think: false,
          num_ctx: 768,
          num_predict: numPredict,
          temperature: 0,
          ...OLLAMA_ANTI_REPEAT_OPTIONS,
        },
        keep_alive: OLLAMA_KEEP_ALIVE,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const parsed = parseJsonObjectFromText(data?.message?.content || "");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  }

  try {
    const primaryTimeout = Math.max(
      900,
      Math.min(INTENT_NLU_TIMEOUT_MS, 2_300),
    );
    const retryTimeout = Math.max(
      700,
      Math.min(INTENT_NLU_TIMEOUT_MS, 1_400),
    );

    let parsed = await requestIntentObject(systemInstruction, 170, primaryTimeout);
    if (!parsed) {
      parsed = await requestIntentObject(
        compactFallbackInstruction,
        120,
        retryTimeout,
      );
    }
    if (!parsed) return emptyIntent;

    const routerAction = normalizeRouterAction(parsed?.action);

    const defaultExplicit =
      toIntentBoolean(parsed?.explicit_remember) ||
      toIntentBoolean(parsed?.explicit);
    const memoryItemsRaw = Array.isArray(parsed.memory_items)
      ? parsed.memory_items
      : Array.isArray(parsed.items)
        ? parsed.items
        : [];
    let memoryItems = memoryItemsRaw
      .slice(0, INTENT_NLU_MAX_MEMORY_ITEMS)
      .map((item) => sanitizeMemoryCandidate(item, defaultExplicit))
      .filter(Boolean);

    if (routerAction === "MEMORY_STORE") {
      let memoryValue = "";
      let memoryKey = "note";

      if (typeof parsed?.memory === "string") {
        memoryValue = parsed.memory;
      } else if (parsed?.memory && typeof parsed.memory === "object") {
        memoryKey = String(parsed.memory.key || "note");
        memoryValue = String(parsed.memory.value || parsed.memory.text || "");
      }

      const candidate = sanitizeMemoryCandidate(
        {
          key: memoryKey,
          value: memoryValue,
          explicit: true,
        },
        true,
      );

      if (candidate) {
        memoryItems = mergeMemoryCandidates([candidate], memoryItems);
      }
    }

    const rawHintKeys = Array.isArray(parsed.memory_hint_keys)
      ? parsed.memory_hint_keys
      : Array.isArray(parsed.hint_keys)
        ? parsed.hint_keys
        : [];

    const actionHintKeys =
      routerAction === "MEMORY_QUERY"
        ? [
            "name",
            "age",
            "location",
            "birthday",
            "timezone",
            "occupation",
            "favorite",
            "note",
          ]
        : [];

    const modelIntent = emptyMessageIntentSignals();

    if (routerAction === "MEMORY_STORE") {
      modelIntent.needsMemoryContext = true;
      modelIntent.explicitRemember = true;
    } else if (routerAction === "MEMORY_QUERY") {
      modelIntent.needsMemoryContext = true;
    } else if (routerAction === "SEARCH_WEB") {
      modelIntent.asksLiveWeb = true;
      modelIntent.explicitWebLookup = true;
    } else if (routerAction === "POPUP_ACTION") {
      modelIntent.liveFollowup = !!previousText;
    }

    modelIntent.asksTime = modelIntent.asksTime || toIntentBoolean(parsed.asks_time);
    modelIntent.asksTodayEvents =
      modelIntent.asksTodayEvents || toIntentBoolean(parsed.asks_today_events);
    modelIntent.asksLiveWeb = modelIntent.asksLiveWeb || toIntentBoolean(parsed.asks_live_web);
    modelIntent.explicitWebLookup =
      modelIntent.explicitWebLookup || toIntentBoolean(parsed.explicit_web_lookup);
    modelIntent.liveFollowup =
      modelIntent.liveFollowup || (toIntentBoolean(parsed.live_followup) && !!previousText);
    modelIntent.needsMemoryContext =
      modelIntent.needsMemoryContext || toIntentBoolean(parsed.needs_memory_context);
    modelIntent.explicitRemember =
      modelIntent.explicitRemember || toIntentBoolean(parsed.explicit_remember) || defaultExplicit;
    modelIntent.memoryHintKeys = toUniqueHintKeys([
      ...actionHintKeys,
      ...rawHintKeys,
    ]);
    modelIntent.memoryItems = memoryItems;

    return modelIntent;
  } catch {
    return emptyIntent;
  }
}

async function saveUserMemories(userId, candidates = []) {
  let savedCount = 0;

  for (const candidate of candidates) {
    const key = normalizeMemoryText(candidate?.key, 60).toLowerCase();
    const value = normalizeMemoryText(candidate?.value, 180);
    if (!key || !value) continue;

    const existing = await pool.query(
      `SELECT id, is_explicit FROM user_memories
       WHERE user_id = $1 AND memory_key = $2 AND memory_value = $3
       LIMIT 1`,
      [userId, key, value],
    );

    if (existing.rows[0]) {
      if (candidate.explicit && !existing.rows[0].is_explicit) {
        await pool.query(
          `UPDATE user_memories
           SET is_explicit = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [existing.rows[0].id],
        );
      }
      continue;
    }

    if (SINGLE_VALUE_MEMORY_KEYS.has(key)) {
      await pool.query(
        `DELETE FROM user_memories WHERE user_id = $1 AND memory_key = $2`,
        [userId, key],
      );
    }

    await pool.query(
      `INSERT INTO user_memories
       (user_id, memory_key, memory_value, is_explicit, usage_count, last_used_at)
       VALUES ($1, $2, $3, $4, 0, NULL)`,
      [userId, key, value, candidate.explicit ? 1 : 0],
    );
    savedCount++;
  }

  return savedCount;
}

function shouldInjectUserMemories(_message = "", _context = [], intentSignals = null) {
  const intent = mergeMessageIntentSignals(
    emptyMessageIntentSignals(),
    intentSignals || emptyMessageIntentSignals(),
  );

  return (
    intent.needsMemoryContext ||
    intent.liveFollowup ||
    intent.explicitRemember ||
    (intent.memoryHintKeys || []).length > 0 ||
    (intent.memoryItems || []).length > 0
  );
}

async function getRelevantUserMemories(
  userId,
  _message = "",
  limit = 6,
  externalHintKeys = [],
) {
  const rowsRes = await pool.query(
    `SELECT id, memory_key, memory_value, is_explicit, usage_count, updated_at
     FROM user_memories
     WHERE user_id = $1
     ORDER BY updated_at DESC, id DESC
     LIMIT 40`,
    [userId],
  );

  const rows = rowsRes.rows || [];
  if (!rows.length) return [];

  const keyHints = new Set();
  for (const key of externalHintKeys || []) {
    const normalized = normalizeHintKey(key);
    if (normalized) keyHints.add(normalized);
  }

  let filtered = rows;
  if (keyHints.size > 0) {
    filtered = rows.filter((memory) => {
      for (const key of keyHints) {
        if (memory.memory_key === key) return true;
        if (key === "favorite" && memory.memory_key.startsWith("favorite_"))
          return true;
        if (key === "favorite" && memory.memory_key.startsWith("note_"))
          return true;
        if (key === "note" && memory.memory_key.startsWith("note_"))
          return true;
      }
      return false;
    });
  }

  if (!filtered.length && keyHints.size > 0) return [];

  const seenSingleValueKeys = new Set();
  const selected = [];
  for (const memory of filtered) {
    if (
      SINGLE_VALUE_MEMORY_KEYS.has(memory.memory_key) &&
      seenSingleValueKeys.has(memory.memory_key)
    ) {
      continue;
    }
    if (SINGLE_VALUE_MEMORY_KEYS.has(memory.memory_key)) {
      seenSingleValueKeys.add(memory.memory_key);
    }
    selected.push(memory);
    if (selected.length >= limit) break;
  }

  return selected;
}

async function markUserMemoriesUsed(memories = []) {
  for (const memory of memories) {
    if (!memory?.id) continue;
    await pool.query(
      `UPDATE user_memories
       SET usage_count = usage_count + 1,
           last_used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [memory.id],
    );
  }
}

function formatMemoryLabel(key = "") {
  if (key.startsWith("favorite_")) {
    return `favorite ${key.slice("favorite_".length).replace(/_/g, " ")}`;
  }
  if (key.startsWith("note_")) {
    return "note";
  }
  return key;
}

function buildUserMemorySystemMessage(memories = []) {
  const lines = [
    "Known user memory (private profile).",
    "Use this only when relevant to the current request.",
    "Do not mention memory items that are not needed for the answer.",
  ];

  for (const memory of memories) {
    lines.push(
      `- ${formatMemoryLabel(memory.memory_key)}: ${memory.memory_value}`,
    );
  }

  return lines.join("\n");
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

function buildClarificationStyleSystemMessage() {
  return [
    "Clarification behavior for build/coding requests only:",
    "- Only ask a clarification question with options when the user is asking to build/create software, websites, apps, scripts, or extensions and key scope details are missing.",
    "- For non-build requests, answer directly without option lists.",
    "- If language understanding is uncertain, ask for a short rephrase and do not output option lists or clarification JSON.",
    "- If user intent is too vague, risky, or has competing output goals, ask a clarification question before delivering a final solution.",
    "- Use exactly one concise question sentence and provide 3-5 labeled options: A), B), C), D) (optional E)).",
    "- Add one final line that invites a freeform reply as an alternative to choosing an option.",
    "- If the user replies with only a letter (for example A or C), treat it as the selected option and continue.",
    `- When you ask a clarification question, append exactly one machine-readable JSON block between ${CLARIFY_JSON_BLOCK_START} and ${CLARIFY_JSON_BLOCK_END}.`,
    '- JSON schema: {"question": string, "options": [{"id": "A", "label": string}], "allowFreeform": true, "freeformPlaceholder": string, "skipLabel": string, "step": number, "totalSteps": number}.',
    "- The question field must be one short sentence only (max 120 characters).",
    "- Clarification popup flow is single-step only; always set step: 1 and totalSteps: 1 when included.",
    "- Keep option ids as uppercase letters (A, B, C, D, optional E).",
    "- Keep question/options/labels in the user's language.",
    "- Do not wrap the JSON block in markdown code fences.",
    "- Avoid repeated clarification popups. After the user picks an option, continue with a concrete answer.",
    "- If the request is already specific, skip clarification and answer directly.",
    "- If no clarification is needed, do not output the JSON block.",
  ].join("\n");
}

function buildForcedClarificationSystemMessage() {
  return [
    "The current request is too vague for a useful final output.",
    "Do not provide the final solution yet.",
    "Ask one concise clarification question now with options A), B), C), D) (optional E)).",
    "Visible output should be one short sentence only.",
    `Then append exactly one JSON block between ${CLARIFY_JSON_BLOCK_START} and ${CLARIFY_JSON_BLOCK_END}.`,
    '- JSON schema: {"question": string, "options": [{"id": "A", "label": string}], "allowFreeform": true, "freeformPlaceholder": string, "skipLabel": string, "step": number, "totalSteps": number}.',
    "The question field must be one short sentence only (max 120 characters).",
    "Clarification popup flow is single-step only; always set step: 1 and totalSteps: 1.",
    "Use 3-5 options and keep all text in the user's language.",
    "After the user responds with an option or free text, continue with a concrete answer and avoid another popup unless absolutely blocked.",
    "Do not use markdown code fences for that JSON block.",
  ].join("\n");
}

function buildClarificationContinueSystemMessage(optionReply = false) {
  const lines = [
    "The user is replying to a previous clarification popup.",
    optionReply
      ? "The reply is an option selection. Continue directly with a concrete answer."
      : "The reply provides additional details. Continue directly with a concrete answer.",
    "Do not output another clarification JSON block unless solving the task remains impossible without one critical missing detail.",
  ];

  return lines.join("\n");
}

function buildFactualSafetySystemMessage({
  internetAccessEnabled = false,
  shouldLookupWeb = false,
  webSourcesCount = 0,
  hasPageContext = false,
  webUnavailable = false,
} = {}) {
  const lines = [
    "Factual safety behavior:",
    "- Never invent exact facts (dates, places, numbers, statistics, names).",
    "- If confidence is low, say uncertainty in one short sentence.",
  ];

  if (hasPageContext) {
    lines.push("- If relevant, prioritize the provided page context before other knowledge.");
  }

  if (webSourcesCount > 0) {
    lines.push("- Prefer exact factual claims from provided web snippets.");
  } else if (internetAccessEnabled && shouldLookupWeb && webUnavailable) {
    lines.push("- Mention that live internet lookup is currently unavailable and offer a retry.");
  } else if (internetAccessEnabled) {
    lines.push("- Offer an internet/source lookup when verification is needed.");
  } else {
    lines.push("- Internet mode is off; offer to continue with internet lookup if the user wants verified facts.");
  }

  lines.push("- Keep uncertainty plus next-step offer concise.");

  return lines.join("\n");
}

function parseClientPageContext(rawContext) {
  if (!rawContext) return null;

  let payload = rawContext;
  if (typeof rawContext === "string") {
    const trimmed = rawContext.trim();
    if (!trimmed) return null;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== "object") return null;

  const title = String(payload.title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  const rawUrl = String(payload.url || "").trim();
  let url = rawUrl.slice(0, 420);
  if (rawUrl) {
    try {
      url = new URL(rawUrl).toString().slice(0, 420);
    } catch {
      url = rawUrl.slice(0, 420);
    }
  }

  let content = String(payload.content || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!content) return null;
  if (content.length > MAX_PAGE_CONTEXT_CONTENT_CHARS) {
    content = content.slice(0, MAX_PAGE_CONTEXT_CONTENT_CHARS);
  }

  return {
    title,
    url,
    content,
  };
}

function buildPageContextSystemMessage(pageContext) {
  if (!pageContext?.content) return "";

  const lines = [
    "Active page context was supplied by the browser extension.",
    "If the user asks about this page topic, prioritize this page context before model memory or web snippets.",
    "If the answer is missing from this page context, say that briefly and then continue with best available knowledge.",
  ];

  if (pageContext.title) lines.push(`Page title: ${pageContext.title}`);
  if (pageContext.url) lines.push(`Page URL: ${pageContext.url}`);

  lines.push("Page content:");
  lines.push(pageContext.content);

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
Start directly with the answer, then add detail only if needed.
You may use *italic*, **bold**, and - bullet points.`,
    friendly: `${SYSTEM_BASE}
Be warm, conversational, and approachable. Use a friendly tone.
Keep it compact and practical. Avoid filler.
You may use *italic*, **bold**, and - bullet points with emojis.`,
    precise: `${SYSTEM_BASE}
Be precise and analytical. Focus on correctness first.
Use structure when helpful, but keep responses compact unless detail is requested.
You may use *italic*, **bold**, and - bullet points. Avoid fluff.`,
  };
  return styleGuides[style] || styleGuides.formal;
}

function getModelResponseGuidance(model) {
  if (model === "qwen3-vl:2b-instruct") {
    return "Model guidance: keep replies short and focused. Usually 1-4 short sentences or up to 5 bullets. Only go longer when the user explicitly asks for detailed steps or code. Never output stage directions like 'checks the clock'.";
  }
  if (model === "qwen3-vl:4b-instruct") {
    return "Model guidance: prioritize concise, direct answers. Usually 1-6 short sentences. Expand only when the user explicitly requests depth. Never output stage directions like 'checks the clock'.";
  }
  return "Model guidance: stay on-topic and concise by default. Add depth only when requested. Never output stage directions like 'checks the clock'.";
}

const OLLAMA_ANTI_REPEAT_OPTIONS = {
  repeat_penalty: 1.12,
  repeat_last_n: 128,
};

const OLLAMA_OPTIONS_8B = {
  think: false,
  num_ctx: 2048,
  num_predict: 1024,
  temperature: 0.65,
  ...OLLAMA_ANTI_REPEAT_OPTIONS,
};
const OLLAMA_OPTIONS_4B = {
  think: false,
  num_ctx: 1024,
  num_predict: 320,
  temperature: 0.55,
  ...OLLAMA_ANTI_REPEAT_OPTIONS,
};
const OLLAMA_OPTIONS_2B = {
  think: false,
  num_ctx: 768,
  num_predict: 220,
  temperature: 0.5,
  ...OLLAMA_ANTI_REPEAT_OPTIONS,
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

function getStartupPrewarmModels() {
  const defaults = [
    "qwen3-vl:2b-instruct",
    "qwen3-vl:4b-instruct",
    "qwen3-vl:8b-instruct",
  ];

  if (!OLLAMA_STARTUP_PREWARM_MODELS_RAW.trim()) {
    return defaults.filter((model) => ALLOWED_MODELS.has(model));
  }

  const configured = OLLAMA_STARTUP_PREWARM_MODELS_RAW.split(",")
    .map((m) => m.trim())
    .filter((m) => m && ALLOWED_MODELS.has(m));

  return configured.length
    ? configured
    : defaults.filter((model) => ALLOWED_MODELS.has(model));
}

async function warmModelInOllama(model, baseOptions, timeoutMs) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "Reply with exactly: OK",
        },
      ],
      stream: false,
      options: {
        think: false,
        num_ctx: Math.min(baseOptions.num_ctx || 512, 512),
        num_predict: 1,
        temperature: 0,
      },
      keep_alive: OLLAMA_KEEP_ALIVE,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Warmup failed (${res.status})`);
  }
}

async function prewarmModelsOnStartup() {
  if (!OLLAMA_STARTUP_PREWARM_ENABLED) {
    console.log("[prewarm] startup prewarm disabled");
    return;
  }

  const models = getStartupPrewarmModels();
  if (!models.length) {
    console.log("[prewarm] no valid models configured for startup prewarm");
    return;
  }

  if (OLLAMA_STARTUP_PREWARM_DELAY_MS > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, OLLAMA_STARTUP_PREWARM_DELAY_MS),
    );
  }

  console.log(`[prewarm] starting warmup for: ${models.join(", ")}`);

  for (const model of models) {
    const started = Date.now();
    try {
      await warmModelInOllama(
        model,
        getOptionsForModel(model),
        OLLAMA_PREWARM_TIMEOUT_MS,
      );
      console.log(`[prewarm] ready: ${model} (${Date.now() - started}ms)`);
    } catch (err) {
      console.warn(
        `[prewarm] failed: ${model} (${Date.now() - started}ms) - ${err?.message || err}`,
      );
    }
  }
}

async function pipeOllamaChatStream(ollamaRes, expressRes, abortSignal) {
  const body = ollamaRes.body;
  if (!body) return "";

  let fullText = "";

  const onLine = (line) => {
    if (!line.trim()) return;
    try {
      const chunk = JSON.parse(line);
      const token = chunk?.message?.content ?? "";
      if (token && !expressRes.writableEnded && !expressRes.destroyed) {
        fullText += token;
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

  return fullText;
}

async function generateChatTitle(firstUserMessage) {
  const truncated = firstUserMessage.slice(0, 200);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
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

app.post("/api/chat/preload", requireAuth, async (req, res) => {
  let userPlan = "Free";
  try {
    const planResult = await pool.query(`SELECT plan FROM users WHERE id = $1`, [
      req.userId,
    ]);
    userPlan = planResult.rows[0]?.plan || "Free";
  } catch {
    userPlan = "Free";
  }

  const requestedModel = req.body?.model || getModelForPlan(userPlan);
  const requestedSafeModel = ALLOWED_MODELS.has(requestedModel)
    ? requestedModel
    : getModelForPlan(userPlan);
  const defaultModel = getModelForPlan(userPlan);
  const model = isModelAllowedForPlan(requestedSafeModel, userPlan)
    ? requestedSafeModel
    : defaultModel;

  const baseOptions = getOptionsForModel(model);

  try {
    await warmModelInOllama(model, baseOptions, OLLAMA_PREWARM_TIMEOUT_MS);

    return res.json({
      success: true,
      model,
      keepAlive: OLLAMA_KEEP_ALIVE,
    });
  } catch (err) {
    console.warn("Model preload error:", err?.message || err);
    return res.status(502).json({ error: "Model preload failed" });
  }
});

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
    const clarifyReply = parseBooleanFlag(req.body.clarifyReply);
    const pageContext = parseClientPageContext(req.body.pageContext);
    const preferPageContext = parseBooleanFlag(req.body.preferPageContext);
    const options = getOptionsForModel(model);

    let context = [];
    try {
      context = req.body.context ? JSON.parse(req.body.context) : [];
      if (!Array.isArray(context)) context = [];
    } catch {
      context = [];
    }

    const previousUserMessage = getLastUserContextMessage(context);
    const deterministicIntent = buildDeterministicBackupIntentSignals(
      message,
      previousUserMessage,
    );

    let modelIntent = emptyMessageIntentSignals();
    if (message) {
      modelIntent = await analyzeMessageIntentWithModel(
        message,
        previousUserMessage,
      );
    }
    const intentSignals = hasAnyIntentSignal(modelIntent)
      ? mergeMessageIntentSignals(deterministicIntent, modelIntent)
      : deterministicIntent;

    if (INTENT_NLU_DEBUG) {
      console.log(
        "[intent-nlu]",
        JSON.stringify({
          message: normalizeMemoryText(message, 120),
          asksTime: intentSignals.asksTime,
          asksTodayEvents: intentSignals.asksTodayEvents,
          asksLiveWeb: intentSignals.asksLiveWeb,
          explicitWebLookup: intentSignals.explicitWebLookup,
          liveFollowup: intentSignals.liveFollowup,
          needsMemoryContext: intentSignals.needsMemoryContext,
          explicitRemember: intentSignals.explicitRemember,
          memoryHintKeys: intentSignals.memoryHintKeys || [],
          memoryItemsCount: (intentSignals.memoryItems || []).length,
        }),
      );
    }

    let memorySavedCount = 0;
    let memoryShouldInject = shouldInjectUserMemories(
      message,
      context,
      intentSignals,
    );
    let memoryHintKeys = intentSignals.memoryHintKeys || [];
    try {
      let memoryCandidates = [...(intentSignals.memoryItems || [])];

      if (intentSignals.explicitRemember && memoryCandidates.length === 0) {
        const note = normalizeMemoryText(message, 220);
        if (note) {
          const noteKey = `note_${crypto
            .createHash("sha1")
            .update(note)
            .digest("hex")
            .slice(0, 12)}`;
          memoryCandidates.push({ key: noteKey, value: note, explicit: true });
        }
      }

      if (memoryCandidates.length) {
        memorySavedCount = await saveUserMemories(req.userId, memoryCandidates);
      }
    } catch (err) {
      console.warn("Memory save failed:", err?.message || err);
    }

    let relevantUserMemories = [];
    if (memoryShouldInject) {
      try {
        relevantUserMemories = await getRelevantUserMemories(
          req.userId,
          message,
          6,
          memoryHintKeys,
        );
        if (relevantUserMemories.length) {
          await markUserMemoriesUsed(relevantUserMemories);
        }
      } catch (err) {
        console.warn("Memory lookup failed:", err?.message || err);
      }
    }

    let webSources = [];
    let webUnavailable = false;
    const vagueBuildRequest = isLikelyVagueBuildRequest(message, context);
    const optionClarifyReply =
      clarifyReply && isSingleClarifyOptionReply(message);
    const shouldForceClarification = vagueBuildRequest && !clarifyReply;
    const shouldAttachClarificationStyleMessage =
      clarifyReply || vagueBuildRequest;
    const shouldLookupWeb =
      internetAccessEnabled &&
      !shouldForceClarification &&
      shouldRunWebLookup(message, context, intentSignals, {
        pageContextAvailable: !!pageContext,
        preferPageContext,
      });
    const likelyFactualQuery = isLikelyFactualLookupQuery(message);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Wieland-Memory-Saved", memorySavedCount > 0 ? "1" : "0");
    res.setHeader("X-Wieland-Memory-Count", String(memorySavedCount));
    res.setHeader("X-Wieland-Clarify-Forced", shouldForceClarification ? "1" : "0");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Wieland-Memory-Saved, X-Wieland-Memory-Count, X-Wieland-Clarify-Forced",
    );

    if (shouldLookupWeb && message) {
      try {
        webSources = await fetchWebSources(message);
        if (!webSources.length) {
          webUnavailable = true;
        }
      } catch (err) {
        webUnavailable = true;
        console.warn("Web access unavailable:", err?.message || err);
      }
    }

    const systemPrompt = getSystemPrompt(aiStyle);
    const modelResponseGuidance = getModelResponseGuidance(model);
    const clarificationStyleSystemMessage = buildClarificationStyleSystemMessage();
    const factualSafetySystemMessage = likelyFactualQuery
      ? buildFactualSafetySystemMessage({
          internetAccessEnabled,
          shouldLookupWeb,
          webSourcesCount: webSources.length,
          hasPageContext: !!pageContext,
          webUnavailable,
        })
      : "";
    const includeRuntimeSystemContext = shouldIncludeRuntimeClockContext(
      message,
      context,
      intentSignals,
    );
    const runtimeSystemContext = includeRuntimeSystemContext
      ? buildRuntimeSystemContextMessage()
      : "";
    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      { role: "system", content: modelResponseGuidance },
      ...(shouldAttachClarificationStyleMessage
        ? [{ role: "system", content: clarificationStyleSystemMessage }]
        : []),
      ...(clarifyReply
        ? [
            {
              role: "system",
              content: buildClarificationContinueSystemMessage(optionClarifyReply),
            },
          ]
        : []),
      ...(shouldForceClarification
        ? [{ role: "system", content: buildForcedClarificationSystemMessage() }]
        : []),
      ...(factualSafetySystemMessage
        ? [{ role: "system", content: factualSafetySystemMessage }]
        : []),
      ...(relevantUserMemories.length
        ? [
            {
              role: "system",
              content: buildUserMemorySystemMessage(relevantUserMemories),
            },
          ]
        : []),
      ...(runtimeSystemContext
        ? [{ role: "system", content: runtimeSystemContext }]
        : []),
      ...(pageContext
        ? [
            {
              role: "system",
              content: buildPageContextSystemMessage(pageContext),
            },
          ]
        : []),
      ...(webSources.length
        ? [
            {
              role: "system",
              content: buildWebContextSystemMessage(webSources),
            },
          ]
        : []),
      ...(shouldLookupWeb
        ? [
            {
              role: "system",
              content:
                "The user asked for current/live information. Do not claim you never have real-time access. If no web snippets are present, say the live lookup is temporarily unavailable right now.",
            },
          ]
        : []),
      ...(shouldLookupWeb && webUnavailable
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
      const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: true,
          options,
          keep_alive: OLLAMA_KEEP_ALIVE,
        }),
        signal: upstreamAbort.signal,
      });

      if (!ollamaRes.ok) {
        return res.status(502).end("Upstream model error");
      }

      const streamedAssistantText = await pipeOllamaChatStream(
        ollamaRes,
        res,
        upstreamAbort.signal,
      );

      if (
        shouldForceClarification &&
        !res.writableEnded &&
        !res.destroyed &&
        !hasClarificationPayload(streamedAssistantText)
      ) {
        const fallbackPayload = buildForcedClarificationFallbackPayload(message);
        const separator = streamedAssistantText.trim() ? "\n" : "";
        const fallbackBlock =
          CLARIFY_JSON_BLOCK_START +
          JSON.stringify(fallbackPayload) +
          CLARIFY_JSON_BLOCK_END;
        res.write(`${separator}${fallbackBlock}`);
      }

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
    app.listen(PORT, () => {
      console.log(`Wieland http://localhost:${PORT}`);
      void prewarmModelsOnStartup();
    });
  })
  .catch((err) => {
    console.error("DB init failed:", err.message);
    process.exit(1);
  });
