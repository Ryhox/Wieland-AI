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

// env flags zentral auswerten damit feature toggles konsistent bleiben
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
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
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
const INTENT_NLU_MODEL = process.env.INTENT_NLU_MODEL || "qwen3-vl:2b-instruct";
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

// SQLite Fehler auf Postgres-ähnliche Codes mappen damit Error-Handling konsistent bleibt
function normalizeDbError(err) {
  const message = err?.message || "";
  // Unique Constraint > Postgres Code 23505
  if (
    err?.code === "SQLITE_CONSTRAINT" ||
    err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    /UNIQUE constraint failed/i.test(message)
  ) {
    err.code = "23505";
    // Constraint Name parsen aus SQLite Message: "UNIQUE constraint failed: table.column"
    const match = message.match(
      /UNIQUE constraint failed: ([^.\s]+)\.([^\s,]+)/i,
    );
    if (match) {
      err.constraint = `${match[1]}_${match[2]}_key`;
    }
  }
  return err;
}

// Query über Globale DB Instanz
async function dbQuery(sql, params = []) {
  return runDbQuery(db, sql, params);
}

// Query-Execution mit Postgres-like Response Format
async function runDbQuery(targetDb, sql, params = []) {
  const normalizedSql = String(sql || "").trim();

  try {
    // Multi-Statement ohne Parameter > exec statt run
    if (
      params.length === 0 &&
      normalizedSql.includes(";") &&
      !/\bRETURNING\b/i.test(normalizedSql)
    ) {
      await targetDb.exec(normalizedSql);
      return { rows: [], rowCount: 0 };
    }

    // SELECT/RETURNING > alle Rows zurück
    if (
      /^SELECT\b/i.test(normalizedSql) ||
      /\bRETURNING\b/i.test(normalizedSql)
    ) {
      const rows = await targetDb.all(normalizedSql, params);
      return { rows, rowCount: rows.length };
    }

    // INSERT/UPDATE/DELETE > rowCount zurück
    const result = await targetDb.run(normalizedSql, params);
    return {
      rows: [],
      rowCount: typeof result?.changes === "number" ? result.changes : 0,
      lastID: result?.lastID,
    };
  } catch (err) {
    throw normalizeDbError(err);
  }
}

// Neue DB Connection mit Pragmas für Sicherheit + Performance
async function createDbClientConnection() {
  const clientDb = await open({
    filename: SQLITE_PATH,
    driver: sqlite3.Database,
  });
  await clientDb.exec("PRAGMA foreign_keys = ON;"); // Referential Integrity
  await clientDb.exec("PRAGMA journal_mode = WAL;"); // Write-Ahead Logging für Concurrency
  await clientDb.exec("PRAGMA busy_timeout = 5000;"); // Lock Timeout
  return clientDb;
}

// Einfacher Connection Pool (einzelne Connections für Transactions)
const pool = {
  query: dbQuery,
  connect: async () => {
    const clientDb = await createDbClientConnection();
    let released = false;
    return {
      query: (sql, params = []) => runDbQuery(clientDb, sql, params),
      release: () => {
        if (released) return;
        released = true;
        void clientDb.close().catch(() => {});
      },
    };
  },
};

// DB initialisieren: Schema + Pragmas
async function initDB() {
  // Verzeichnis anlegen wenn nicht existiert
  await fs.promises.mkdir(path.dirname(SQLITE_PATH), { recursive: true });
  db = await open({ filename: SQLITE_PATH, driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA busy_timeout = 5000;");

  const client = await pool.connect();
  try {
    // Alle Tables in einem Batching erstellen (CREATE TABLE IF NOT EXISTS)
    await client.query(`
      -- Users Tabelle mit Auth Daten
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        plan          TEXT NOT NULL DEFAULT 'Free',
        created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Chats pro User (Gespräche speichern)
      CREATE TABLE IF NOT EXISTS chats (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename   TEXT NOT NULL,
        title      TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, filename) -- Ein Chat File pro User
      );

      -- Messages in jedem Chat (User/Assistant/System)
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- User-spezifische Memories (von AI gelernt oder explizit gespeichert)
      CREATE TABLE IF NOT EXISTS user_memories (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        memory_key  TEXT NOT NULL,
        memory_value TEXT NOT NULL,
        is_explicit INTEGER NOT NULL DEFAULT 0, -- 1 = User hat manuell gespeichert
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, memory_key, memory_value)
      );

      -- Indizes für häufige Queries
      CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
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

// endpoint: pack wieland-extension folder → zip download
app.get("/api/extension/download", async (_req, res) => {
  // verify extension folder readable
  try {
    await fs.promises.access(EXTENSION_DIR, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ error: "Extension folder not found" });
  }

  // set download headers: Content-Type + filename + no-cache
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

function signToken(userId, plan = "Free") {
  // JWT generieren: sub (user ID) + plan claim, expires nach JWT_EXPIRES time
  return jwt.sign({ sub: userId, plan: normalizePlan(plan) }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
    algorithm: "HS256",
  });
}

// auth middleware: token aus Authorization header parse + verify
function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    // JWT verify: extract sub (user_id) + plan
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    req.userId = payload.sub;
    req.userPlan =
      typeof payload?.plan === "string" && payload.plan.trim()
        ? normalizePlan(payload.plan)
        : null;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// validators: user input sanitizing (username/email/password format)
function isValidUsername(u) {
  // 3-32 chars: a-zA-Z0-9_- nur
  return typeof u === "string" && /^[a-zA-Z0-9_-]{3,32}$/.test(u);
}
function isValidEmail(e) {
  // basic RFC email check + max 255 chars
  return (
    typeof e === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) &&
    e.length <= 255
  );
}
function isValidPassword(p) {
  // min 8, max 128 chars (bcrypt limit beachten)
  return typeof p === "string" && p.length >= 8 && p.length <= 128;
}

function isValidDisplayName(value) {
  const displayName = String(value || "").trim();
  return displayName.length >= 2 && displayName.length <= 40;
}

// filename sanitize: nur alphanumerisch + ä ö ü ß
function toSafeFilename(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 40);
}

// Registrierung: Neuer User mit Email + Password
app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body ?? {};

  // Validierung
  if (!isValidUsername(username))
    return res
      .status(400)
      .json({ error: "Username must be 3–32 chars (letters, digits, _ -)" });
  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email address" });
  if (!isValidPassword(password))
    return res.status(400).json({ error: "Password must be 8–128 characters" });

  try {
    // password hashen + user in DB einfügen
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const cleanUsername = username.trim();
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
       RETURNING id, username, email, plan`,
      [cleanUsername, email.trim().toLowerCase(), hash],
    );
    const user = result.rows[0];
    // JWT token generieren für sofort auth zu sein
    const token = signToken(user.id, user.plan);
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
    // Duplicate Email/Username catchen
    if (err.code === "23505") {
      const field = err.constraint?.includes("email") ? "Email" : "Username";
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error("Register error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// login: email + password → bcrypt validation → JWT token
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const result = await pool.query(
      `SELECT id, username, email, password_hash, plan FROM users WHERE email = ?`,
      [email.trim().toLowerCase()],
    );
    const user = result.rows[0];

    // timing-safe bcrypt: always hash check (even if user not found) gegen timing attacks
    const hashToCheck =
      user?.password_hash ??
      "$2b$12$invalidhashfortimingXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const matches = await bcrypt.compare(password, hashToCheck);

    // generic error: verhindert benutzer-enumerierung
    if (!user || !matches)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user.id, user.plan);
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

// endpoint: get current authenticated user info (braucht token)
app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, plan FROM users WHERE id = ?`,
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

// Email ändern (Protected)
// endpoint: update email (braucht valid neuen email + check duplicate)
app.post("/api/auth/update-email", requireAuth, async (req, res) => {
  const { email } = req.body ?? {};

  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email address" });

  try {
    const result = await pool.query(
      `UPDATE users SET email = ? WHERE id = ?
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
    // unique constraint error: email already exists
    if (err.code === "23505")
      return res.status(409).json({ error: "Email already in use" });
    console.error("Update email error:", err.message);
    res.status(500).json({ error: "Failed to update email" });
  }
});

// endpoint: update password (old password verification + bcrypt neuen hash)
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
      `SELECT password_hash FROM users WHERE id = ?`,
      [req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    // verify old password bevor update
    const matches = await bcrypt.compare(
      currentPassword,
      result.rows[0].password_hash,
    );
    if (!matches)
      return res.status(401).json({ error: "Current password is incorrect" });

    // hash new password + save
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      newHash,
      req.userId,
    ]);

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Update password error:", err.message);
    res.status(500).json({ error: "Failed to update password" });
  }
});

// endpoint: update account name (name == display name)
app.post("/api/auth/update-name", requireAuth, async (req, res) => {
  const { name } = req.body ?? {};
  const nextName = String(name || "").trim();

  if (!isValidUsername(nextName)) {
    return res
      .status(400)
      .json({ error: "Name must be 3-32 chars (letters, digits, _ -)" });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET username = ?
       WHERE id = ?
       RETURNING id, username, email, plan`,
      [nextName, req.userId],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Name already taken" });
    }
    console.error("Update name error:", err.message);
    res.status(500).json({ error: "Failed to update name" });
  }
});

// endpoint: cancel subscription (revert zu Free plan)
app.post("/api/auth/cancel-subscription", requireAuth, async (req, res) => {
  try {
    const planRes = await pool.query(`SELECT plan FROM users WHERE id = ?`, [
      req.userId,
    ]);
    const currentPlan = (planRes.rows[0]?.plan || "").toLowerCase();
    // admin kann nicht canceln
    if (currentPlan === "admin") {
      return res
        .status(403)
        .json({ error: "Admin subscription cannot be cancelled" });
    }

    const result = await pool.query(
      `UPDATE users SET plan = 'Free' WHERE id = ?
       RETURNING id, username, email, plan`,
      [req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    // neue token für free plan
    res.json({
      success: true,
      message: "Subscription cancelled",
      token: signToken(req.userId, result.rows[0].plan),
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Cancel subscription error:", err.message);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// endpoint: upgrade subscription plan (Free → Pro → Max)
app.post("/api/auth/upgrade-plan", requireAuth, async (req, res) => {
  try {
    const { plan } = req.body ?? {};
    const normalizedPlan = String(plan || "").trim();
    // normalize "max" zu "Max" (canonical form)
    const canonicalPlan =
      normalizedPlan.toLowerCase() === "max" ? "Max" : normalizedPlan;

    if (
      !canonicalPlan ||
      !["Free", "Pro", "Max", "Admin"].includes(canonicalPlan)
    )
      return res.status(400).json({ error: "Invalid plan" });

    const currentRes = await pool.query(`SELECT plan FROM users WHERE id = ?`, [
      req.userId,
    ]);
    const currentPlan = currentRes.rows[0]?.plan || "";
    if (!currentPlan) {
      return res.status(404).json({ error: "User not found" });
    }

    // Admin-Plan ist nur für intern/admin setup gedacht und darf hier nicht gesetzt werden.
    if (canonicalPlan === "Admin") {
      return res.status(403).json({ error: "Cannot switch to admin plan" });
    }

    // Admin accounts dürfen ihren Plan nicht über diesen endpoint ändern.
    if (String(currentPlan).toLowerCase() === "admin") {
      return res
        .status(403)
        .json({ error: "Admin plan cannot be changed here" });
    }

    const result = await pool.query(
      `UPDATE users SET plan = ? WHERE id = ?
       RETURNING id, username, email, plan`,
      [canonicalPlan, req.userId],
    );

    if (!result.rows[0])
      return res.status(404).json({ error: "User not found" });

    // neue token regenerieren mit neuen plan
    res.json({
      success: true,
      message: `Plan changed to ${canonicalPlan}`,
      token: signToken(req.userId, result.rows[0].plan),
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Upgrade plan error:", err.message);
    res.status(500).json({ error: "Failed to upgrade plan" });
  }
});

// endpoint: komplett account löschen (cascading delete)
app.delete("/api/auth/delete-account", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = ? RETURNING id`,
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

// endpoint: GET alle memories für user (sortiert nach update-time)
app.get("/api/auth/memories", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, memory_key, memory_value, is_explicit, usage_count,
              last_used_at, created_at, updated_at
       FROM user_memories
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC`,
      [req.userId],
    );

    // map db rows zu client format
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

// endpoint: DELETE single memory entry by ID
app.delete("/api/auth/memories/:id", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid memory id" });
  }

  try {
    // only owner kann ihre eigene memory löschen
    const result = await pool.query(
      `DELETE FROM user_memories WHERE id = ? AND user_id = ? RETURNING id`,
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

// endpoint: DELETE ALLE memories für user (purge alles)
app.delete("/api/auth/memories", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM user_memories WHERE user_id = ?`,
      [req.userId],
    );

    res.json({ success: true, deleted: Number(result.rowCount || 0) });
  } catch (err) {
    console.error("Clear memories error:", err.message);
    res.status(500).json({ error: "Failed to clear memories" });
  }
});

// auth middleware: check ob user ist admin (plan = "Admin")
function requireAdmin(req, res, next) {
  pool
    .query(`SELECT plan FROM users WHERE id = ?`, [req.userId])
    .then((result) => {
      // Kein User oder nicht Admin > error
      if (!result.rows[0] || result.rows[0].plan !== "Admin")
        return res
          .status(403)
          .json({ error: "Forbidden: Admin access required" });
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth check failed" }));
}

function includeDebugAccounts(req) {
  const value = String(req.query?.includeDebug || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

// endpoint: GET aggregate stats (total user/chat/message counts)
app.get("/api/admin/stats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const includeDebug = includeDebugAccounts(_req);
    const userWhere = includeDebug
      ? ""
      : "WHERE NOT (LOWER(u.email) GLOB 'dbg[0-9]*@example.com' OR LOWER(u.username) GLOB 'dbg[0-9]*')";
    const chatJoinWhere = includeDebug
      ? ""
      : "WHERE NOT (LOWER(u.email) GLOB 'dbg[0-9]*@example.com' OR LOWER(u.username) GLOB 'dbg[0-9]*')";

    const result = await pool.query(`
      SELECT
        CAST((SELECT COUNT(*) FROM users u ${userWhere}) AS INTEGER) AS total_users,
        CAST((
          SELECT COUNT(*)
          FROM chats c
          JOIN users u ON u.id = c.user_id
          ${chatJoinWhere}
        ) AS INTEGER) AS total_chats,
        CAST((
          SELECT COUNT(*)
          FROM chat_messages cm
          JOIN chats c ON c.id = cm.chat_id
          JOIN users u ON u.id = c.user_id
          ${chatJoinWhere}
        ) AS INTEGER) AS total_msgs
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Admin stats error:", err.message);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// endpoint: GET alle user mit chat count (admin dashboard)
app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const includeDebug = includeDebugAccounts(_req);
    const debugWhere = includeDebug
      ? ""
      : "WHERE NOT (LOWER(u.email) GLOB 'dbg[0-9]*@example.com' OR LOWER(u.username) GLOB 'dbg[0-9]*')";

    const result = await pool.query(`
      SELECT
        u.id, u.username, u.email, u.plan, u.created_at,
        CAST(COUNT(c.id) AS INTEGER) AS chat_count
      FROM users u
      LEFT JOIN chats c ON c.user_id = u.id
      ${debugWhere}
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin users error:", err.message);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// endpoint: PUT update existing user (username/email/password/plan by admin)
app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username, email, password, plan } = req.body ?? {};
  if (!isValidUsername(username))
    return res.status(400).json({ error: "Invalid username" });
  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email" });

  try {
    let query, params;
    // optional password field: nur wenn password supplied
    if (password) {
      if (!isValidPassword(password))
        return res.status(400).json({ error: "Password too short" });
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      query = `UPDATE users SET username=?, email=?, password_hash=?, plan=? WHERE id=? RETURNING id, username, email, plan`;
      params = [
        username.trim(),
        email.trim().toLowerCase(),
        hash,
        plan ?? "Free",
        id,
      ];
    } else {
      // nur username/email/plan update
      query = `UPDATE users SET username=?, email=?, plan=? WHERE id=? RETURNING id, username, email, plan`;
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

// endpoint: DELETE user by ID (cascading delete für alle chats/messages)
app.delete(
  "/api/admin/users/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const result = await pool.query(
        `DELETE FROM users WHERE id = ? RETURNING id`,
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

// endpoint: GET alle chats mit owner + message count (admin view)
app.get("/api/admin/chats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const includeDebug = includeDebugAccounts(_req);
    const debugWhere = includeDebug
      ? ""
      : "WHERE NOT (LOWER(u.email) GLOB 'dbg[0-9]*@example.com' OR LOWER(u.username) GLOB 'dbg[0-9]*')";

    const result = await pool.query(`
      SELECT
        c.id, c.filename, c.title, c.created_at, c.updated_at, c.user_id,
        u.username,
        CAST(COUNT(cm.id) AS INTEGER) AS message_count
      FROM chats c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN chat_messages cm ON cm.chat_id = c.id
      ${debugWhere}
      GROUP BY c.id, u.username
      ORDER BY c.updated_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin chats error:", err.message);
    res.status(500).json({ error: "Failed to load chats" });
  }
});

// endpoint: DELETE single chat by ID
app.delete(
  "/api/admin/chats/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const result = await pool.query(
        `DELETE FROM chats WHERE id = ? RETURNING id`,
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

// endpoint: GET chat detail mit all messages (admin inspect)
app.get(
  "/api/admin/chats/:id/messages",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      // get chat metadata
      const chatRes = await pool.query(
        `SELECT c.id, c.filename, c.title, c.created_at, c.updated_at, c.user_id, u.username,
              CAST(COUNT(cm.id) AS INTEGER) AS message_count
       FROM chats c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN chat_messages cm ON cm.chat_id = c.id
       WHERE c.id = ?
       GROUP BY c.id, u.username`,
        [id],
      );
      if (!chatRes.rows[0])
        return res.status(404).json({ error: "Chat not found" });

      // get all messages für chat (chronologisch)
      const msgRes = await pool.query(
        `SELECT role, content, created_at
       FROM chat_messages WHERE chat_id = ?
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
- Do not roleplay or narrate emotions/actions (for example: "smiles slightly", "*laughs*", "(sighs)", or "voice becoming more relaxed").
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

// strip image markdown: remove markdown image syntax ![...](URL) from text
function stripImageMarkdown(text) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]+\)\n\n?/g, "")
    .trim();
}

// extract image urls from markdown: find all ![...](URL) patterns and return URL list
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

// resolve history image file from url: map /history/images/ URLs to actual file paths, prevent path traversal
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

function safeLocaleFormat(formatter, fallback = "unknown") {
  try {
    const value = formatter();
    return value ? String(value) : fallback;
  } catch {
    return fallback;
  }
}

// build runtime system context message: server clock context (UTC + SERVER_TIMEZONE) for AI temporal awareness
// helper: system context mit server-zeit (UTC + SERVER_TIMEZONE)
// wird in chat context injected damit AI current date/time weiß
function buildRuntimeSystemContextMessage(now = new Date()) {
  const utcIso = now.toISOString();
  const unixSeconds = Math.floor(now.getTime() / 1000);

  // parse verschiedene zeitformate: local date/time/weekday + UTC
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

// helper: extrahiere letzte user-message aus conversation (rückwärts suche)
function getLastUserContextMessage(context = []) {
  // backtrack durch konversation: finde letzte user-nachricht
  for (let i = context.length - 1; i >= 0; i--) {
    const item = context[i];
    if (item?.role === "user") {
      return String(item?.content || "");
    }
  }
  return "";
}

// helper: intent detection struktur - was braucht die user-message?
function emptyMessageIntentSignals() {
  return {
    asksTime: false, // zeitfrage?
    asksTodayEvents: false, // "was ist heute?"
    asksLiveWeb: false, // braucht web-suche?
    explicitWebLookup: false, // user sagte "search..."
    webSearchQuery: "", // search terms"
    needsClarification: false,
    liveFollowup: false,
    prefersPageContext: false,
    clarifyOptionReply: false,
    needsMemoryContext: false,
    explicitRemember: false,
    memoryHintKeys: [],
    memoryItems: [],
  };
}

// helper: parse verschiedene boolean formats robust
function toIntentBoolean(value) {
  // handle true/1/false/0/null
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  // string fallthrough
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

function compactIntentText(value, maxLen = 360) {
  const compacted = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (compacted.length <= maxLen) return compacted;
  return compacted.slice(0, maxLen).trim();
}

function looksLikeExplicitPageReference(text = "") {
  const compacted = compactIntentText(text, 500);
  if (!compacted) return false;

  return /\b(this|current|active)\s+(page|site|website|tab|article|post|document)\b|\bon\s+this\s+(page|site|website|tab|article|post|document)\b|\bfrom\s+this\s+(page|site|website|tab|article|post|document)\b|\b(in|on)\s+the\s+current\s+(page|site|tab|article)\b/.test(
    compacted,
  );
}

function looksLikeLiveWebLookupQuery(text = "") {
  const compacted = compactIntentText(text, 500);
  if (!compacted) return false;

  return /\b(news|headline|headlines|breaking|latest|current events|trending|update|updates|what happened|happening|weather|forecast|temperature|stock|stocks|market|crypto|bitcoin|exchange rate|traffic|score|scores|results|who won|election|today s news)\b/.test(
    compacted,
  );
}

function looksLikeGreetingOrSmalltalk(text = "") {
  const compacted = compactIntentText(text, 140);
  if (!compacted) return false;

  const wordCount = compacted.split(" ").filter(Boolean).length;
  if (wordCount > 8) return false;

  return /\b(hi|hello|hey|heyho|yo|sup|hallo|servus|moin|ciao|buongiorno|buonasera|how are you|wie gehts|wie geht s|was geht|come va)\b/.test(
    compacted,
  );
}

function isLikelyVagueBuildRequestForClarification(text = "") {
  // heuristic: user fragt nach build ohne konkrete anforderungen → clarification nötig
  // checks: build verb + broad target + NOT specific scope + < 20 words
  const compacted = compactIntentText(text, 420);
  if (!compacted) return false;
  if (looksLikeGreetingOrSmalltalk(compacted)) return false;

  const wordCount = compacted.split(" ").filter(Boolean).length;

  const hasBuildVerb =
    /\b(build|create|make|generate|develop|design|code|program|implement|setup|set up|mach|mache|baue?|erstell\w*|generier\w*|entwickl\w*|programmiere|crea|sviluppa|genera|costruisci|progetta|fai)\b/.test(
      compacted,
    );

  const hasBroadTarget =
    /\b(app|web app|website|webseite|site|landing page|tool|project|projekt|bot|script|extension|plugin|automation|automatisierung|automazione|api|saas|programma|sito|estensione)\b/.test(
      compacted,
    );

  const hasSpecificScopeHint =
    /\b(react|vue|svelte|node|python|java|typescript|javascript|html|css|backend|frontend|ios|android|chrome extension|browser extension|deadline|budget|target audience|zielgruppe)\b/.test(
      compacted,
    );

  if (!hasBuildVerb || !hasBroadTarget) return false;
  if (hasSpecificScopeHint) return false;

  return wordCount <= 20;
}

const DE_LANGUAGE_HINT_WORDS = new Set([
  "und",
  "oder",
  "nicht",
  "ich",
  "du",
  "wir",
  "was",
  "wie",
  "warum",
  "wieso",
  "bitte",
  "danke",
  "kannst",
  "kann",
  "soll",
  "möchte",
  "mochte",
  "hallo",
  "tschuss",
  "ciao",
]);

const IT_LANGUAGE_HINT_WORDS = new Set([
  "e",
  "non",
  "che",
  "come",
  "cosa",
  "perche",
  "perché",
  "grazie",
  "ciao",
  "puoi",
  "voglio",
  "vorrei",
  "dove",
  "quando",
  "oggi",
  "domani",
  "allora",
  "adesso",
  "sono",
  "sei",
]);

const EN_LANGUAGE_HINT_WORDS = new Set([
  "the",
  "and",
  "or",
  "not",
  "you",
  "your",
  "i",
  "we",
  "what",
  "how",
  "why",
  "please",
  "thanks",
  "can",
  "could",
  "should",
  "hello",
  "hi",
  "hey",
  "today",
]);

// detect likely language from text: score de/en/it via hint words + unicode indicators
function detectLikelyLanguageFromText(text = "") {
  const raw = String(text || "");
  const compacted = compactIntentText(raw, 320);
  if (!compacted) return "";

  const score = { de: 0, en: 0, it: 0 };

  if (/[äöüß]/i.test(raw)) score.de += 3;
  if (/[àèéìíîòóù]/i.test(raw)) score.it += 3;

  const words = compacted.split(" ").filter(Boolean);
  for (const word of words) {
    if (DE_LANGUAGE_HINT_WORDS.has(word)) score.de += 1;
    if (IT_LANGUAGE_HINT_WORDS.has(word)) score.it += 1;
    if (EN_LANGUAGE_HINT_WORDS.has(word)) score.en += 1;
  }

  let winner = "";
  let best = 0;
  for (const code of ["de", "en", "it"]) {
    if (score[code] > best) {
      winner = code;
      best = score[code];
      continue;
    }
    if (score[code] === best && best > 0) {
      winner = "";
    }
  }

  return best >= 2 ? winner : "";
}

// build language + style policy: system message für language detection + style guidance
function buildLanguageAndStylePolicySystemMessage(
  userMessage = "",
  previousUserMessage = "",
) {
  const currentText = String(userMessage || "").trim();
  const previousText = String(previousUserMessage || "").trim();

  const currentDetected = detectLikelyLanguageFromText(currentText);
  const previousDetected = detectLikelyLanguageFromText(previousText);
  const preferPrevious = looksLikeGreetingOrSmalltalk(currentText);
  const resolvedLanguage = preferPrevious
    ? previousDetected || currentDetected
    : currentDetected || previousDetected;

  const langLabels = {
    de: "German",
    en: "English",
    it: "Italian",
  };

  const lines = [
    "Language policy:",
    "- Reply in the same language as the user's latest message.",
    "- If the latest message is only a short greeting, keep the language from the most recent substantive user message.",
    "- Only switch language if the user explicitly asks to switch or asks for translation.",
    "Style policy:",
    "- Never roleplay.",
    '- Never output stage directions or emotional narration (for example: "smiles slightly", "*laughs*", "(sighs)", "voice becoming more relaxed").',
    "- Use direct assistant voice in plain natural sentences.",
  ];

  if (resolvedLanguage) {
    lines.unshift(
      `Detected reply language: ${langLabels[resolvedLanguage] || resolvedLanguage}. Use this language for the reply.`,
    );
  }

  return lines.join("\n");
}

// merge message intent signals: combine base (heuristic) + model (LLM) intent detection
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
  merged.webSearchQuery = String(
    modelIntent.webSearchQuery || baseIntent.webSearchQuery || "",
  ).trim();
  merged.needsClarification = Boolean(
    baseIntent.needsClarification || modelIntent.needsClarification,
  );
  merged.liveFollowup = Boolean(
    baseIntent.liveFollowup || modelIntent.liveFollowup,
  );
  merged.prefersPageContext = Boolean(
    baseIntent.prefersPageContext || modelIntent.prefersPageContext,
  );
  merged.clarifyOptionReply = Boolean(
    baseIntent.clarifyOptionReply || modelIntent.clarifyOptionReply,
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

// should include runtime clock context: check if message asks for time-related info
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

// should run web lookup: check if message requires live web search (explicit or intent detected)
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
  const liveWebByText =
    looksLikeLiveWebLookupQuery(query) &&
    !looksLikeExplicitPageReference(query);

  const wantsWebLookup =
    intent.asksTodayEvents ||
    intent.liveFollowup ||
    intent.explicitWebLookup ||
    intent.asksLiveWeb ||
    liveWebByText;

  if (!wantsWebLookup) return false;
  if (intent.asksTime) return false;
  if (
    shouldPreferPageContext &&
    intent.prefersPageContext &&
    !intent.explicitWebLookup &&
    !liveWebByText
  ) {
    return false;
  }

  return true;
}

// normalize clarify option id: validate A-E or fallback to index-based (A=0, B=1, etc)
function normalizeClarifyOptionId(value = "", index = 0) {
  const candidate = String(value || "")
    .trim()
    .toUpperCase();

  if (candidate.length === 1) {
    const code = candidate.charCodeAt(0);
    if (code >= 65 && code <= 69) return candidate;
  }

  const safeIndex = Math.max(0, Math.min(4, index));
  return String.fromCharCode(65 + safeIndex);
}

// is disallowed clarify option label: filter out generic labels like "other", "more details"
function isDisallowedClarifyOptionLabel(value = "") {
  const compacted = compactIntentText(value, 120);
  if (!compacted) return true;

  return (
    /^(other|others|something else|anything else|custom|free text|explain|explanation|more details?|details?)$/.test(
      compacted,
    ) ||
    /^(etwas anderes|anderes|sonstiges|freitext|eigene angabe|eigene eingabe|erklaren|erklaeren|erklarung)$/.test(
      compacted,
    ) ||
    /^(altro|qualcos altro|spiega|spiegami)$/.test(compacted)
  );
}

// sanitize clarification payload: normalize question + filter invalid options, validate structure
function sanitizeClarificationPayload(payload = null) {
  if (!payload || typeof payload !== "object") return null;

  const question = normalizeMemoryText(payload.question, 120);
  const rawOptions = Array.isArray(payload.options) ? payload.options : [];
  const options = [];
  const seenOptionLabels = new Set();

  for (let i = 0; i < rawOptions.length && i < 5; i++) {
    const rawOption = rawOptions[i] || {};
    const label = normalizeMemoryText(rawOption.label, 100);
    if (!label) continue;
    if (isDisallowedClarifyOptionLabel(label)) continue;

    const labelKey = compactIntentText(label, 120);
    if (labelKey && seenOptionLabels.has(labelKey)) continue;
    if (labelKey) seenOptionLabels.add(labelKey);

    options.push({
      id: normalizeClarifyOptionId(rawOption.id, i),
      label,
    });
  }

  if (!question || options.length < 2) return null;

  return {
    question,
    options,
    allowFreeform: payload.allowFreeform !== false,
    freeformPlaceholder: normalizeMemoryText(payload.freeformPlaceholder, 80),
    skipLabel: normalizeMemoryText(payload.skipLabel, 40),
    step: 1,
    totalSteps: 1,
  };
}

// build clarification response text: format payload als JSON mit WIELAND_CLARIFY_JSON markers
function buildClarificationResponseText(payload = null) {
  const sanitized = sanitizeClarificationPayload(payload);
  if (!sanitized) return "";

  const responsePayload = {
    ...sanitized,
    step: 1,
    totalSteps: 1,
  };

  return [
    responsePayload.question,
    `${CLARIFY_JSON_BLOCK_START}${JSON.stringify(responsePayload)}${CLARIFY_JSON_BLOCK_END}`,
  ].join("\n");
}

// build forced clarification fallback: generate clarification payload from context wenn LLM clarify request fehlschlägt
async function buildForcedClarificationFallbackPayload(
  message = "",
  assistantDraft = "",
) {
  const userText = normalizeMemoryText(message, INTENT_NLU_MAX_MESSAGE_CHARS);
  if (!userText) return null;
  const assistantText = normalizeMemoryText(assistantDraft, 700);

  const model = "qwen3-vl:2b-instruct";
  const baseInstructionLines = [
    "You generate one clarification popup payload as strict JSON for a UI modal.",
    "Output ONLY raw JSON. No markdown.",
    'Schema: {"question":string,"options":[{"id":"A","label":string}],"allowFreeform":true,"freeformPlaceholder":string,"skipLabel":string,"step":1,"totalSteps":1}',
    "Use the exact language of the user request.",
    "Use BOTH the user request and the assistant draft clarification text.",
    "The popup question and options must align with the assistant draft meaning.",
    "Create 3 to 5 concise options.",
    "Every option must be a concrete choice.",
    "Do not include options like Other, Others, Something else, Explain, or Custom (freeform input already exists).",
    "Set step and totalSteps to 1.",
  ];

  const routerUserPayload = [
    `user_request: ${userText}`,
    `assistant_draft_clarification: ${assistantText || ""}`,
  ].join("\n");

  async function requestPayload(systemInstruction) {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: routerUserPayload },
        ],
        stream: false,
        format: "json",
        options: {
          think: false,
          num_ctx: 1024,
          num_predict: 180,
          temperature: 0,
          ...OLLAMA_ANTI_REPEAT_OPTIONS,
        },
        keep_alive: OLLAMA_KEEP_ALIVE,
      }),
      signal: AbortSignal.timeout(
        Math.max(2000, Math.min(INTENT_NLU_TIMEOUT_MS, 8000)),
      ),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const raw = String(data?.message?.content || "");
    const parsed = parseJsonObjectFromText(raw);
    return sanitizeClarificationPayload(parsed);
  }

  try {
    const primaryInstruction = baseInstructionLines.join("\n");
    const firstPass = await requestPayload(primaryInstruction);
    if (firstPass) return firstPass;

    const retryInstruction = [
      ...baseInstructionLines,
      "Retry policy: if any option would be generic, replace it with a concrete scope/format choice.",
      "Return exactly 4 options (A, B, C, D).",
    ].join("\n");

    return await requestPayload(retryInstruction);
  } catch {
    return null;
  }
}

async function requestForcedClarificationTextFromChatModel({
  model,
  aiStyle,
  message,
  context,
  currentMessageImages,
  options,
}) {
  const userContent =
    String(message || "").trim() ||
    (Array.isArray(currentMessageImages) && currentMessageImages.length
      ? "Image attached."
      : "");
  if (!userContent) return "";

  const forcedMessages = [
    { role: "system", content: getSystemPrompt(aiStyle) },
    { role: "system", content: buildClarificationStyleSystemMessage() },
    { role: "system", content: buildForcedClarificationSystemMessage() },
    ...buildContextMessagesForOllama(context),
    {
      role: "user",
      content: userContent,
      ...(Array.isArray(currentMessageImages) && currentMessageImages.length
        ? { images: currentMessageImages }
        : {}),
    },
  ];

  const baseNumPredict = Number(options?.num_predict) || 220;
  const baseNumCtx = Number(options?.num_ctx) || 1024;

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: forcedMessages,
        stream: false,
        options: {
          ...options,
          think: false,
          num_ctx: Math.max(768, Math.min(baseNumCtx, 4096)),
          num_predict: Math.max(120, Math.min(baseNumPredict, 420)),
        },
        keep_alive: OLLAMA_KEEP_ALIVE,
      }),
    });

    if (!res.ok) return "";

    const data = await res.json();
    return String(data?.message?.content || "").trim();
  } catch {
    return "";
  }
}

function hasClarificationPayload(text = "") {
  const source = String(text || "");
  if (!source.trim()) return false;

  const blockMatch = source.match(CLARIFY_JSON_BLOCK_ANY_RE);
  if (blockMatch) {
    const parsed = parseJsonObjectFromText(blockMatch[1] || "");
    if (sanitizeClarificationPayload(parsed)) return true;
  }

  let optionCount = 0;
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*[A-E][)\].:-]\s*(.+)$/i);
    if (!match) continue;
    const optionLabel = normalizeMemoryText(match[1], 100);
    if (!optionLabel || isDisallowedClarifyOptionLabel(optionLabel)) continue;
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

// collapse whitespace: normalize all whitespace (spaces, tabs, nbsp, etc.) to single spaces
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

// trim underscores: remove leading/trailing underscores from string
function trimUnderscores(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "_") start++;
  while (end > start && value[end - 1] === "_") end--;
  return value.slice(start, end);
}

// to underscore key: convert text to lowercase underscore-delimited key (alphanumeric + underscore only)
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

// normalize memory text: collapse whitespace and truncate to max length (default 180 chars)
function normalizeMemoryText(value, maxLen = 180) {
  return collapseWhitespace(value).slice(0, maxLen);
}

// to memory key suffix: generate keyboard-safe suffix from text for memory keys (e.g., "favorite_dogs")
function toMemoryKeySuffix(value) {
  const normalized = toUnderscoreKey(normalizeMemoryText(value, 30), 30);
  return normalized || "item";
}

// parse json object from text: extract JSON from text (handles code fences, inline JSON, brace extraction)
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

// normalize suggested memory key: validate + normalize memory key via aliases, apply favorite/note prefixes
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

// sanitize memory candidate: validate and normalize a single memory key-value pair
function sanitizeMemoryCandidate(candidate, defaultExplicit = false) {
  const value = normalizeMemoryText(candidate?.value, 180);
  if (!value) return null;

  const key = normalizeSuggestedMemoryKey(candidate?.key, value);
  if (!key) return null;

  const explicit =
    candidate?.explicit === true ||
    candidate?.explicit === 1 ||
    defaultExplicit;

  return { key, value, explicit };
}

// merge memory candidates: deduplicate memory items by signature, preserve explicit flag if set in any copy
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

// normalize hint key: normalize a memory hint key (collapse favorite_* and note_* variants to base keys)
function normalizeHintKey(key) {
  const source = normalizeMemoryText(key, 60);
  if (!source) return "";

  const normalized = normalizeSuggestedMemoryKey(source, source);
  if (normalized.startsWith("favorite_")) return "favorite";
  if (normalized.startsWith("note_")) return "note";
  return normalized;
}

// get intent NLU model: get configured LLM model for intent analysis, fallback to default
function getIntentNluModel() {
  const configured = String(INTENT_NLU_MODEL || "").trim();
  if (configured) return configured;

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

// normalize router action: validate action enum (CHAT, MEMORY_STORE, MEMORY_QUERY, SEARCH_WEB, READ_PAGE, POPUP_ACTION)
function normalizeRouterAction(value = "") {
  const action = String(value || "")
    .trim()
    .toUpperCase();
  if (!action) return "";
  if (ROUTER_ACTION_VALUES.has(action)) return action;

  return "";
}

// normalize client source: normalize request source (extension/web to standard enum)
function normalizeClientSource(value = "") {
  const source = String(value || "")
    .trim()
    .toLowerCase();

  if (!source) return "";
  if (
    source === "extension" ||
    source === "browser_extension" ||
    source === "sidepanel"
  ) {
    return "extension";
  }
  if (source === "web" || source === "webapp" || source === "website") {
    return "web";
  }

  return "";
}

// analyze message intent with model: call LLM to detect user intent signals (clarify, web, memory, etc)
async function analyzeMessageIntentWithModel(
  message,
  previousUserMessage = "",
  metadata = {},
) {
  const emptyIntent = emptyMessageIntentSignals();
  if (!INTENT_NLU_ENABLED) return emptyIntent;

  const userText = normalizeMemoryText(message, INTENT_NLU_MAX_MESSAGE_CHARS);
  const previousText = normalizeMemoryText(
    previousUserMessage,
    INTENT_NLU_MAX_MESSAGE_CHARS,
  );
  const clientSource = normalizeClientSource(metadata?.clientSource || "");
  const hasPageContext = metadata?.hasPageContext === true;
  const preferPageContext = metadata?.preferPageContext === true;
  const hasImageInput = metadata?.hasImageInput === true;
  if (!userText) return emptyIntent;

  const intentNluModel = getIntentNluModel();
  const allowReadPageAction = clientSource !== "web";
  const actionSchema = allowReadPageAction
    ? "CHAT|MEMORY_STORE|MEMORY_QUERY|SEARCH_WEB|READ_PAGE|POPUP_ACTION"
    : "CHAT|MEMORY_STORE|MEMORY_QUERY|SEARCH_WEB|POPUP_ACTION";

  const sourceContextLines = [];
  if (clientSource) {
    sourceContextLines.push(`Client source: ${clientSource}.`);
  }
  if (hasImageInput) {
    sourceContextLines.push("An image was attached for this turn.");
  }
  if (hasPageContext) {
    sourceContextLines.push(
      "A page context snapshot from the active tab is available for this turn.",
    );
  }
  if (preferPageContext) {
    sourceContextLines.push(
      "Prefer active page context only when the user clearly refers to on-page content.",
    );
  }
  if (clientSource === "extension" || hasPageContext || preferPageContext) {
    sourceContextLines.push(
      "Routing rule: use READ_PAGE only when the user explicitly refers to the current/active page, this site, this tab, this article, or on-page content.",
    );
    sourceContextLines.push(
      "Routing rule: generic live-information requests (news, latest updates, weather, markets, sports results, current events) must be SEARCH_WEB even if page context exists.",
    );
  }
  if (clientSource === "web") {
    sourceContextLines.push(
      "Routing rule: for web client turns, never choose READ_PAGE.",
    );
  }
  if (hasImageInput) {
    sourceContextLines.push(
      "Routing rule: for image analysis prompts (e.g., what is this / what do you see), choose CHAT with needs_clarification=false.",
    );
  }
  const sourceContextInstruction = sourceContextLines.join("\n");

  const systemInstruction = [
    "You are a JSON intent classifier. Output ONLY raw JSON, nothing else.",
    "",
    `Output schema: {"action":"${actionSchema}","memory_items":[{"key":"string","value":"string"}],"search_query":"","needs_clarification":false,"clarify_option_reply":false}`,
    "",
    ...(sourceContextInstruction ? [sourceContextInstruction, ""] : []),
    "MEMORY_STORE: user shares personal info. Extract key+value pairs.",
    "MEMORY_QUERY: user asks what you remember about them.",
    "SEARCH_WEB: needs live/current internet data.",
    ...(allowReadPageAction
      ? [
          "READ_PAGE: user asks about the current/open page content.",
          "Never choose READ_PAGE for generic live-information queries (news/weather/markets/current events) that are not explicitly page-scoped.",
        ]
      : []),
    "POPUP_ACTION: user is replying to an existing clarification popup (option-style reply).",
    "Set needs_clarification=true when the user asks to build/create software but key scope details are missing.",
    "If an image is attached and the user asks to identify/describe it, needs_clarification must be false.",
    "For vague build requests, use action CHAT with needs_clarification=true.",
    "Do NOT set needs_clarification for greetings, small talk, normal Q&A, or support/debug requests.",
    "Never set needs_clarification for short casual messages like hi, hello, hey, heyho, ciao, or hallo.",
    "CHAT: everything else.",
    "",
    'Input: "I am 20 years old" -> {"action":"MEMORY_STORE","memory_items":[{"key":"age","value":"20"}],"search_query":"","needs_clarification":false,"clarify_option_reply":false}',
    'Input: "what do you know about me" -> {"action":"MEMORY_QUERY","memory_items":[],"search_query":"","needs_clarification":false,"clarify_option_reply":false}',
    'Input: "whats the weather in Vienna" -> {"action":"SEARCH_WEB","memory_items":[],"search_query":"weather Vienna","needs_clarification":false,"clarify_option_reply":false}',
    'Input: "what are the news today?" -> {"action":"SEARCH_WEB","memory_items":[],"search_query":"news today","needs_clarification":false,"clarify_option_reply":false}',
    'Input: "heyho!" -> {"action":"CHAT","memory_items":[],"search_query":"","needs_clarification":false,"clarify_option_reply":false}',
    ...(allowReadPageAction
      ? [
          'Input: "was steht auf dieser website" -> {"action":"READ_PAGE","memory_items":[],"search_query":"","needs_clarification":false,"clarify_option_reply":false}',
        ]
      : []),
    'Input: "what is this" (with image attached) -> {"action":"CHAT","memory_items":[],"search_query":"","needs_clarification":false,"clarify_option_reply":false}',
    'Input: "generate a website for me" -> {"action":"CHAT","memory_items":[],"search_query":"","needs_clarification":true,"clarify_option_reply":false}',
    'Input: "A" -> {"action":"POPUP_ACTION","memory_items":[],"search_query":"","needs_clarification":false,"clarify_option_reply":true}',
  ].join("\n");

  const userPayload = [
    `current_user_message: ${userText}`,
    ...(previousText ? [`previous_user_message: ${previousText}`] : []),
    `client_source: ${clientSource || "unknown"}`,
    `has_page_context: ${hasPageContext ? "true" : "false"}`,
    `prefer_page_context: ${preferPageContext ? "true" : "false"}`,
    `has_image_input: ${hasImageInput ? "true" : "false"}`,
  ].join("\n");

  async function requestIntentObject(
    instruction,
    timeoutMs = INTENT_NLU_TIMEOUT_MS,
  ) {
    console.log(
      "[intent-call] calling model:",
      intentNluModel,
      "timeoutMs:",
      timeoutMs,
      "message:",
      userText,
    );

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: intentNluModel,
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: userPayload },
        ],
        stream: false,
        format: "json",
        options: {
          think: false,
          num_ctx: 1024,
          num_predict: 60,
          temperature: 0,
          ...OLLAMA_ANTI_REPEAT_OPTIONS,
        },
        keep_alive: OLLAMA_KEEP_ALIVE,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const raw = String(data?.message?.content || "");
    console.log("[intent-raw]", raw);

    const parsed = parseJsonObjectFromText(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  }

  try {
    const timeoutMs = Math.max(2000, Math.min(INTENT_NLU_TIMEOUT_MS, 8000));
    const parsed = await requestIntentObject(systemInstruction, timeoutMs);
    if (!parsed) return emptyIntent;

    const routerAction = normalizeRouterAction(
      parsed?.action || parsed?.intent,
    );
    if (!routerAction) return emptyIntent;

    const selectedOptionValue = String(
      parsed?.selected_option || parsed?.option_id || parsed?.option || "",
    )
      .trim()
      .toUpperCase();
    const selectedOptionCode =
      selectedOptionValue.length === 1 ? selectedOptionValue.charCodeAt(0) : -1;
    const hasSelectedOptionId =
      selectedOptionCode >= 65 && selectedOptionCode <= 69;
    const clarifyOptionReply =
      toIntentBoolean(parsed?.clarify_option_reply) || hasSelectedOptionId;
    const forceChatForWebReadPage =
      clientSource === "web" && routerAction === "READ_PAGE";
    const effectiveAction = forceChatForWebReadPage
      ? "CHAT"
      : routerAction === "POPUP_ACTION" && !clarifyOptionReply
        ? "CHAT"
        : routerAction;
    const forceChatForImageReadPage =
      hasImageInput && effectiveAction === "READ_PAGE";
    const forceSearchWebForLiveQuery =
      effectiveAction === "READ_PAGE" &&
      looksLikeLiveWebLookupQuery(userText) &&
      !looksLikeExplicitPageReference(userText);
    const routedAction = forceChatForImageReadPage
      ? "CHAT"
      : forceSearchWebForLiveQuery
        ? "SEARCH_WEB"
        : effectiveAction;

    if (forceChatForWebReadPage) {
      console.log("[intent-override] READ_PAGE -> CHAT (web client)");
    }

    if (forceChatForImageReadPage) {
      console.log("[intent-override] READ_PAGE -> CHAT (image input)");
    }

    if (forceSearchWebForLiveQuery) {
      console.log(
        "[intent-override] READ_PAGE -> SEARCH_WEB (generic live query)",
      );
    }

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

    if (routerAction === "MEMORY_STORE" && memoryItems.length === 0) {
      let memoryValue = "";
      let memoryKey = "note";

      if (typeof parsed?.memory === "string" && parsed.memory.trim()) {
        memoryValue = parsed.memory;
      } else if (typeof parsed?.extract === "string" && parsed.extract.trim()) {
        memoryValue = parsed.extract;
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
      routedAction === "MEMORY_QUERY"
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

    if (routedAction === "MEMORY_STORE") {
      modelIntent.needsMemoryContext = true;
      modelIntent.explicitRemember = true;
      modelIntent.memoryHintKeys = toUniqueHintKeys(["note"]);
    } else if (routedAction === "MEMORY_QUERY") {
      modelIntent.needsMemoryContext = true;
      modelIntent.memoryHintKeys = toUniqueHintKeys([
        "name",
        "age",
        "location",
        "birthday",
        "timezone",
        "occupation",
        "favorite",
        "note",
      ]);
    } else if (routedAction === "SEARCH_WEB") {
      modelIntent.asksLiveWeb = true;
      modelIntent.explicitWebLookup = true;
      modelIntent.webSearchQuery = normalizeMemoryText(
        String(parsed?.search_query || parsed?.query || userText),
        INTENT_NLU_MAX_MESSAGE_CHARS,
      );
    } else if (routedAction === "READ_PAGE") {
      modelIntent.prefersPageContext = true;
    } else if (routedAction === "POPUP_ACTION") {
      modelIntent.liveFollowup = !!previousText;
      modelIntent.clarifyOptionReply = clarifyOptionReply;
    }

    modelIntent.asksTime =
      modelIntent.asksTime || toIntentBoolean(parsed.asks_time);
    modelIntent.asksTodayEvents =
      modelIntent.asksTodayEvents || toIntentBoolean(parsed.asks_today_events);
    modelIntent.asksLiveWeb =
      modelIntent.asksLiveWeb || toIntentBoolean(parsed.asks_live_web);
    modelIntent.explicitWebLookup =
      modelIntent.explicitWebLookup ||
      toIntentBoolean(parsed.explicit_web_lookup);
    modelIntent.needsClarification =
      modelIntent.needsClarification ||
      toIntentBoolean(parsed.needs_clarification) ||
      toIntentBoolean(parsed.should_clarify) ||
      toIntentBoolean(parsed.clarify_needed);
    modelIntent.liveFollowup =
      modelIntent.liveFollowup ||
      (toIntentBoolean(parsed.live_followup) && !!previousText);
    modelIntent.prefersPageContext =
      modelIntent.prefersPageContext ||
      toIntentBoolean(parsed.prefers_page_context);
    modelIntent.clarifyOptionReply =
      modelIntent.clarifyOptionReply || clarifyOptionReply;
    modelIntent.needsMemoryContext =
      modelIntent.needsMemoryContext ||
      toIntentBoolean(parsed.needs_memory_context);
    modelIntent.explicitRemember =
      modelIntent.explicitRemember ||
      toIntentBoolean(parsed.explicit_remember) ||
      defaultExplicit;
    modelIntent.memoryHintKeys = toUniqueHintKeys([
      ...(modelIntent.memoryHintKeys || []),
      ...actionHintKeys,
      ...rawHintKeys,
    ]);
    modelIntent.memoryItems = memoryItems;

    if (
      modelIntent.needsClarification &&
      !isLikelyVagueBuildRequestForClarification(userText)
    ) {
      modelIntent.needsClarification = false;
      if (INTENT_NLU_DEBUG) {
        console.log(
          "[intent-override] needs_clarification -> false (non-vague-build message)",
        );
      }
    }

    if (hasImageInput) {
      modelIntent.needsClarification = false;
      modelIntent.prefersPageContext = false;
    }

    return modelIntent;
  } catch (err) {
    console.error("[intent-error-full]", err?.name, err?.message, err?.cause);
    console.error("[intent-error]", err?.message || err);
    return emptyIntent;
  }
}

// save user memories: persist extracted memory candidates to database, handle duplicates + explicit flag
async function saveUserMemories(userId, candidates = []) {
  let savedCount = 0;

  for (const candidate of candidates) {
    const key = normalizeMemoryText(candidate?.key, 60).toLowerCase();
    const value = normalizeMemoryText(candidate?.value, 180);
    if (!key || !value) continue;

    const existing = await pool.query(
      `SELECT id, is_explicit FROM user_memories
       WHERE user_id = ? AND memory_key = ? AND memory_value = ?
       LIMIT 1`,
      [userId, key, value],
    );

    if (existing.rows[0]) {
      if (candidate.explicit && !existing.rows[0].is_explicit) {
        await pool.query(
          `UPDATE user_memories
           SET is_explicit = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [existing.rows[0].id],
        );
      }
      continue;
    }

    if (SINGLE_VALUE_MEMORY_KEYS.has(key)) {
      await pool.query(
        `DELETE FROM user_memories WHERE user_id = ? AND memory_key = ?`,
        [userId, key],
      );
    }

    await pool.query(
      `INSERT INTO user_memories
       (user_id, memory_key, memory_value, is_explicit, usage_count, last_used_at)
       VALUES (?, ?, ?, ?, 0, NULL)`,
      [userId, key, value, candidate.explicit ? 1 : 0],
    );
    savedCount++;
  }

  return savedCount;
}

// should inject user memories: determine if user memory should be injected into context based on intent
function shouldInjectUserMemories(
  _message = "",
  _context = [],
  intentSignals = null,
) {
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

// get relevant user memories: fetch stored user memories filtered by hint keys (name, age, location, favorites, notes)
async function getRelevantUserMemories(
  userId,
  _message = "",
  limit = 6,
  externalHintKeys = [],
) {
  const keyHints = new Set();
  for (const key of externalHintKeys || []) {
    const normalized = normalizeHintKey(key);
    if (normalized) keyHints.add(normalized);
  }

  const whereClauses = ["user_id = ?"];
  const params = [userId];

  if (keyHints.size > 0) {
    const hints = [...keyHints];
    const directKeys = hints.filter(
      (key) => key !== "favorite" && key !== "note",
    );
    const scopedClauses = [];

    if (directKeys.length) {
      const placeholders = directKeys.map(() => "?");
      params.push(...directKeys);
      scopedClauses.push(`memory_key IN (${placeholders.join(", ")})`);
    }

    if (hints.includes("favorite")) {
      scopedClauses.push("memory_key LIKE 'favorite_%'");
    }

    if (hints.includes("note")) {
      scopedClauses.push("memory_key LIKE 'note_%'");
    }

    if (scopedClauses.length) {
      whereClauses.push(`(${scopedClauses.join(" OR ")})`);
    }
  }

  const rowsRes = await pool.query(
    `SELECT id, memory_key, memory_value, is_explicit, usage_count, updated_at
     FROM user_memories
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT 40`,
    params,
  );

  const rows = rowsRes.rows || [];
  if (!rows.length) return [];

  const seenSingleValueKeys = new Set();
  const selected = [];
  for (const memory of rows) {
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

// mark user memories used: update usage counters and last-used timestamps for accessed memory entries
async function markUserMemoriesUsed(memories = []) {
  for (const memory of memories) {
    if (!memory?.id) continue;
    await pool.query(
      `UPDATE user_memories
       SET usage_count = usage_count + 1,
           last_used_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [memory.id],
    );
  }
}

// format memory label: convert memory_key to human-readable label (e.g., "favorite_animals" → "favorite animals")
function formatMemoryLabel(key = "") {
  if (key.startsWith("favorite_")) {
    return `favorite ${key.slice("favorite_".length).replace(/_/g, " ")}`;
  }
  if (key.startsWith("note_")) {
    return "note";
  }
  return key;
}

// build user memory system message: format memory items into system prompt block with labels and values
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

// decode html entities: convert HTML entities (&#123;, &nbsp;, etc.) to plain text characters
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

// is private ipv4: check if IPv4 address is private/reserved (10.x, 127.x, 192.168.x, 172.16-31.x, 169.254.x)
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

// is safe public http url: validate URL is public HTTP/HTTPS (reject localhost, private IPs, .local domains)
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

// normalize duckduckgo url: unwrap DuckDuckGo redirect URLs and validate safety
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

// fetch web sources: query DuckDuckGo HTML endpoint and parse results via parseDuckDuckGoResults
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

// build web context system message: format web search results into system prompt with titles, URLs, snippets
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

// build clarification style system message: defines when/how to ask multi-option clarification popups
function buildClarificationStyleSystemMessage() {
  return [
    "Clarification behavior for build/coding requests only:",
    "- Only ask a clarification question with options when the user is asking to build/create software, websites, apps, scripts, or extensions and key scope details are missing.",
    "- For non-build requests, answer directly without option lists.",
    "- If language understanding is uncertain, ask for a short rephrase and do not output option lists or clarification JSON.",
    "- If user intent is too vague, risky, or has competing output goals, ask a clarification question before delivering a final solution.",
    "- Use exactly one concise question sentence and provide 3-5 labeled options: A), B), C), D) (optional E)).",
    "- Add one final line that invites a freeform reply as an alternative to choosing an option.",
    "- Do not include options like Other/Others/Something else/Explain/Custom because freeform input already covers that.",
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

// build forced clarification system message: instructs model request is too vague, ask ONE clarification popup
function buildForcedClarificationSystemMessage() {
  return [
    "The current request is too vague for a useful final output.",
    "Do not provide the final solution yet.",
    "Ask one concise clarification question only.",
    "Visible output should be one short sentence only.",
    "Do not output option lists (A/B/C...) in visible text.",
    "Do not output clarification JSON blocks in visible text.",
    "Popup options will be generated separately by the router model.",
    "The question field must be one short sentence only (max 120 characters).",
    "After the user responds with an option or free text, continue with a concrete answer and avoid another popup unless absolutely blocked.",
  ].join("\n");
}

// build clarification continue system message: tells model user is answering a prior clarification popup
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

// build factual safety system message: defines behavior re: factual claims, web sources, page context
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
    lines.push(
      "- If relevant, prioritize the provided page context before other knowledge.",
    );
  }

  if (webSourcesCount > 0) {
    lines.push("- Prefer exact factual claims from provided web snippets.");
  } else if (internetAccessEnabled && shouldLookupWeb && webUnavailable) {
    lines.push(
      "- Mention that live internet lookup is currently unavailable and offer a retry.",
    );
  } else if (internetAccessEnabled) {
    lines.push(
      "- Offer an internet/source lookup when verification is needed.",
    );
  } else {
    lines.push(
      "- Internet mode is off; offer to continue with internet lookup if the user wants verified facts.",
    );
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

// escape markdown link text: remove square brackets and collapse whitespace for safe markdown link display text
function escapeMarkdownLinkText(text) {
  return String(text || "")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// escape markdown url: URL-encode parentheses for safe markdown link URLs
function escapeMarkdownUrl(url) {
  return String(url || "")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

// format web sources markdown: format web search results as numbered markdown links with source attribution
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

// build context messages for ollama: convert plain conversation context to Ollama API format, strip/encode base64 images
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

const CODING_REQUEST_HINT_RE =
  /```|\b(code|coding|function|class|method|bug|fix|refactor|script|api|endpoint|react|vue|node|python|javascript|typescript|html|css|sql|regex|stack\s*trace|error|exception|compile|build|npm|yarn|vite|express|database|query|schema|migration)\b/i;

function isLikelyCodingRequest(message = "", context = []) {
  const current = String(message || "").trim();
  const previous = getLastUserContextMessage(context);

  return (
    CODING_REQUEST_HINT_RE.test(current) ||
    CODING_REQUEST_HINT_RE.test(previous)
  );
}

function getModelResponseGuidance(model, { codingRequest = false } = {}) {
  if (codingRequest) {
    if (model === "qwen3-vl:2b-instruct") {
      return "Model guidance (coding): prioritize complete, usable code over shortness. Continue until all essential parts are provided. Avoid repeating already written lines.";
    }
    if (model === "qwen3-vl:4b-instruct") {
      return "Model guidance (coding): provide complete implementations and finish incomplete snippets. Keep explanations concise, but do not truncate required code.";
    }
    return "Model guidance (coding): deliver complete end-to-end code with any required glue code and finish pending sections before stopping.";
  }

  if (model === "qwen3-vl:2b-instruct") {
    return "Model guidance: keep replies focused and practical. Expand when needed for correctness. Never output stage directions or roleplay text (for example 'smiles slightly').";
  }
  if (model === "qwen3-vl:4b-instruct") {
    return "Model guidance: prioritize direct answers with enough detail to be complete. Never output stage directions or roleplay text (for example 'smiles slightly').";
  }
  return "Model guidance: stay on-topic and complete. Expand when needed for correctness. Never output stage directions or roleplay text (for example 'smiles slightly').";
}

const OLLAMA_ANTI_REPEAT_OPTIONS = {
  repeat_penalty: 1.12,
  repeat_last_n: 128,
};

function getBoundedIntEnv(name, fallback, min = 64, max = 16_384) {
  const parsed = parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const OLLAMA_NUM_CTX_8B = getBoundedIntEnv(
  "OLLAMA_NUM_CTX_8B",
  3072,
  768,
  16_384,
);
const OLLAMA_NUM_CTX_4B = getBoundedIntEnv(
  "OLLAMA_NUM_CTX_4B",
  2048,
  768,
  12_288,
);
const OLLAMA_NUM_CTX_2B = getBoundedIntEnv(
  "OLLAMA_NUM_CTX_2B",
  1536,
  512,
  8192,
);
const OLLAMA_NUM_PREDICT_8B = getBoundedIntEnv(
  "OLLAMA_NUM_PREDICT_8B",
  1536,
  128,
  8192,
);
const OLLAMA_NUM_PREDICT_4B = getBoundedIntEnv(
  "OLLAMA_NUM_PREDICT_4B",
  896,
  128,
  4096,
);
const OLLAMA_NUM_PREDICT_2B = getBoundedIntEnv(
  "OLLAMA_NUM_PREDICT_2B",
  640,
  128,
  3072,
);

const OLLAMA_OPTIONS_8B = {
  think: false,
  num_ctx: OLLAMA_NUM_CTX_8B,
  num_predict: OLLAMA_NUM_PREDICT_8B,
  temperature: 0.65,
  ...OLLAMA_ANTI_REPEAT_OPTIONS,
};
const OLLAMA_OPTIONS_4B = {
  think: false,
  num_ctx: OLLAMA_NUM_CTX_4B,
  num_predict: OLLAMA_NUM_PREDICT_4B,
  temperature: 0.55,
  ...OLLAMA_ANTI_REPEAT_OPTIONS,
};
const OLLAMA_OPTIONS_2B = {
  think: false,
  num_ctx: OLLAMA_NUM_CTX_2B,
  num_predict: OLLAMA_NUM_PREDICT_2B,
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
  const intentModel = getIntentNluModel();
  if (intentModel && !models.includes(intentModel)) {
    models.push(intentModel);
  }

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

async function pipeOllamaChatStream(
  ollamaRes,
  expressRes,
  abortSignal,
  onToken = null,
) {
  const body = ollamaRes.body;
  if (!body) return { text: "", doneReason: "" };

  let fullText = "";
  let doneReason = "";

  const onLine = (line) => {
    if (!line.trim()) return;
    try {
      const chunk = JSON.parse(line);
      if (chunk?.done) {
        doneReason = String(chunk?.done_reason || chunk?.doneReason || "")
          .trim()
          .toLowerCase();
      }
      const token = chunk?.message?.content ?? "";
      if (token && !expressRes.writableEnded && !expressRes.destroyed) {
        fullText += token;
        expressRes.write(token);
        if (typeof onToken === "function") {
          try {
            onToken(token, fullText);
          } catch {}
        }
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

  return { text: fullText, doneReason };
}

function shouldAutoContinueForDoneReason(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  return (
    normalized === "length" ||
    normalized === "max_tokens" ||
    normalized === "max_output_tokens"
  );
}

function buildAutoContinueUserPrompt(codingRequest = false) {
  if (codingRequest) {
    return [
      "Continue exactly where you stopped due to output length.",
      "Do not repeat previously generated text.",
      "Complete the remaining code and include any missing closing parts.",
    ].join(" ");
  }

  return [
    "Continue exactly where you stopped due to output length.",
    "Do not repeat previously generated text.",
    "Finish the answer completely.",
  ].join(" ");
}

const MARKDOWN_FENCE_LINE_RE = /^```([a-zA-Z0-9_+.-]*)\s*$/;

function getMarkdownFenceState(text = "") {
  const source = String(text || "").replace(/\r\n/g, "\n");
  if (!source) return { inFence: false, activeLang: "" };

  const lines = source.split("\n");
  let inFence = false;
  let activeLang = "";

  for (const line of lines) {
    const match = line.match(MARKDOWN_FENCE_LINE_RE);
    if (!match) continue;

    const fenceLang = String(match[1] || "")
      .trim()
      .toLowerCase();

    if (!inFence) {
      inFence = true;
      activeLang = fenceLang;
      continue;
    }

    if (!fenceLang) {
      inFence = false;
      activeLang = "";
      continue;
    }

    if (activeLang && fenceLang === activeLang) {
      // Duplicate re-open of the same fence during continuation.
      continue;
    }
  }

  return { inFence, activeLang };
}

function normalizeContinuationMarkdown(
  previousText = "",
  continuationText = "",
) {
  let chunk = String(continuationText || "").replace(/\r\n/g, "\n");
  if (!chunk) return "";

  const state = getMarkdownFenceState(previousText);
  if (!state.inFence) return chunk;

  const lines = chunk.split("\n");
  let firstContentIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      firstContentIndex = i;
      break;
    }
  }

  if (firstContentIndex < 0) return chunk;

  const firstLineMatch = lines[firstContentIndex].match(MARKDOWN_FENCE_LINE_RE);
  if (!firstLineMatch) return chunk;

  const continuationLang = String(firstLineMatch[1] || "")
    .trim()
    .toLowerCase();

  if (
    !continuationLang ||
    !state.activeLang ||
    continuationLang === state.activeLang
  ) {
    lines.splice(firstContentIndex, 1);
    chunk = lines.join("\n");
  }

  return chunk;
}

function ensureClosedMarkdownCodeFence(text = "") {
  const source = String(text || "").replace(/\r\n/g, "\n");
  if (!source) return "";

  const state = getMarkdownFenceState(source);
  if (!state.inFence) return source;

  return source.endsWith("\n") ? `${source}\`\`\`` : `${source}\n\`\`\``;
}

async function generateChatTitle(
  firstUserMessage,
  model = getModelForPlan("free"),
) {
  const truncated = firstUserMessage.slice(0, 200);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
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

async function resolveUserPlan(req) {
  if (req?.userPlan) return req.userPlan;

  try {
    const planResult = await pool.query(`SELECT plan FROM users WHERE id = ?`, [
      req.userId,
    ]);
    return normalizePlan(planResult.rows[0]?.plan || "free");
  } catch {
    return "free";
  }
}

// Modell vorwärmen in Ollama (damit kein Cold-Start beim ersten Request)
app.post("/api/chat/preload", requireAuth, async (req, res) => {
  // Plan auflösen um korrektes Model zu nehmen
  const userPlan = await resolveUserPlan(req);

  // Model Request gegen Plan validieren
  const requestedModel = req.body?.model || getModelForPlan(userPlan);
  const requestedSafeModel = ALLOWED_MODELS.has(requestedModel)
    ? requestedModel
    : getModelForPlan(userPlan);
  const defaultModel = getModelForPlan(userPlan);
  // Final Model: Safe oder Default
  const model = isModelAllowedForPlan(requestedSafeModel, userPlan)
    ? requestedSafeModel
    : defaultModel;

  const baseOptions = getOptionsForModel(model);

  try {
    // Modell in Ollama warm halten
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

// Flow: (1) image upload → base64 encode
//       (2) intent NLU analysis (asksTime, asksLiveWeb, needsMemoryContext, needsClarification)
//       (3) memory context injection (prev messages + relevant user memories)
//       (4) web search if needed (internet access + search intent)
//       (5) build runtime system context (server time, timezone, previous context)
//       (6) call Ollama streaming endpoint → collect tokens + process clarification
//       (7) save memory candidates + save chat history
app.post(
  "/api/chat/stream",
  requireAuth,
  upload.single("image"),
  async (req, res) => {
    // image file optional: POST multipart form-data mit "image" field
    const imageFile = req.file ?? null;
    const rawMessage =
      req.body.message?.trim() || (imageFile ? "Describe this image" : "");
    if (!rawMessage)
      return res.status(400).json({ error: "message or image required" });

    // strip markdown image references - we handle images via file upload
    const message = stripImageMarkdown(rawMessage);
    const currentMessageImages = [];

    // image processing: either uploaded file OR inline markdown URLs
    if (imageFile) {
      // multipart upload: base64 the buffer directly
      currentMessageImages.push(imageFile.buffer.toString("base64"));
    } else {
      // inline markdown: extract ![...](url) references + load from /history/images
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

    // resolve user plan + select appropriate model
    const userPlan = await resolveUserPlan(req);

    const requestedModel = req.body.model || getModelForPlan(userPlan);
    const requestedSafeModel = ALLOWED_MODELS.has(requestedModel)
      ? requestedModel
      : getModelForPlan(userPlan);
    const defaultModel = getModelForPlan(userPlan);
    const model = isModelAllowedForPlan(requestedSafeModel, userPlan)
      ? requestedSafeModel
      : defaultModel;

    // optional request parameters
    const aiStyle = req.body.aiStyle || "formal";
    const internetAccessEnabled = isEnvEnabled(req.body.internetAccess, false);
    const clarifyReply = isEnvEnabled(req.body.clarifyReply, false);
    const pageContext = parseClientPageContext(req.body.pageContext);
    const preferPageContext = isEnvEnabled(req.body.preferPageContext, false);
    const clientSource = normalizeClientSource(
      req.body.clientSource || (pageContext ? "extension" : "web"),
    );
    const options = getOptionsForModel(model);

    let context = [];
    try {
      context = req.body.context ? JSON.parse(req.body.context) : [];
      if (!Array.isArray(context)) context = [];
    } catch {
      context = [];
    }

    // analyze message intent via NLU model: erkennt web search, time queries, memory context, clarification needs
    const previousUserMessage = getLastUserContextMessage(context);
    let intentSignals = emptyMessageIntentSignals();
    if (message) {
      intentSignals = await analyzeMessageIntentWithModel(
        message,
        previousUserMessage,
        {
          clientSource,
          hasPageContext: Boolean(pageContext),
          preferPageContext,
          hasImageInput: currentMessageImages.length > 0,
        },
      );
    }

    // (optional) debug: log intent NLU result
    if (INTENT_NLU_DEBUG) {
      console.log(
        "[intent-nlu]",
        JSON.stringify({
          message: normalizeMemoryText(message, 120),
          asksTime: intentSignals.asksTime,
          asksTodayEvents: intentSignals.asksTodayEvents,
          asksLiveWeb: intentSignals.asksLiveWeb,
          explicitWebLookup: intentSignals.explicitWebLookup,
          webSearchQuery: intentSignals.webSearchQuery || "",
          clientSource: clientSource || "unknown",
          hasPageContext: Boolean(pageContext),
          hasImageInput: currentMessageImages.length > 0,
          prefersPageContext: intentSignals.prefersPageContext,
          clarifyOptionReply: intentSignals.clarifyOptionReply,
          needsClarification: intentSignals.needsClarification,
          liveFollowup: intentSignals.liveFollowup,
          needsMemoryContext: intentSignals.needsMemoryContext,
          explicitRemember: intentSignals.explicitRemember,
          memoryHintKeys: intentSignals.memoryHintKeys || [],
          memoryItemsCount: (intentSignals.memoryItems || []).length,
        }),
      );
    }

    // memory handling: save candidates (from NLU) + inject relevant memories from DB
    let memorySavedCount = 0;
    let memoryShouldInject = shouldInjectUserMemories(
      message,
      context,
      intentSignals,
    );
    let memoryHintKeys = intentSignals.memoryHintKeys || [];
    try {
      let memoryCandidates = [...(intentSignals.memoryItems || [])];

      // if user says "remember X" but no structured memory extracted, create note
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

      // save any candidates to user_memories table
      if (memoryCandidates.length) {
        memorySavedCount = await saveUserMemories(req.userId, memoryCandidates);
      }
    } catch (err) {
      console.warn("Memory save failed:", err?.message || err);
    }

    // retrieve relevant memories from user DB for context injection
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
          // mark memories as used for ranking
          await markUserMemoriesUsed(relevantUserMemories);
        }
      } catch (err) {
        console.warn("Memory lookup failed:", err?.message || err);
      }
    }

    // web search decision: check if needs live internet data
    let webSources = [];
    let webUnavailable = false;
    const optionClarifyReply =
      clarifyReply && Boolean(intentSignals.clarifyOptionReply);
    const clarifyEligibleByText =
      isLikelyVagueBuildRequestForClarification(message);
    const shouldForceClarification =
      intentSignals.needsClarification &&
      !clarifyReply &&
      clarifyEligibleByText;
    const shouldAttachClarificationStyleMessage = clarifyReply;
    const shouldLookupWeb =
      internetAccessEnabled &&
      !shouldForceClarification &&
      shouldRunWebLookup(message, context, intentSignals, {
        pageContextAvailable: !!pageContext,
        preferPageContext,
      });
    const likelyFactualQuery = Boolean(
      intentSignals.explicitWebLookup || intentSignals.asksLiveWeb,
    );
    const likelyCodingRequest = isLikelyCodingRequest(message, context);
    const webLookupQuery = normalizeMemoryText(
      intentSignals.webSearchQuery || message,
      INTENT_NLU_MAX_MESSAGE_CHARS,
    );

    // SSE headers für streaming response
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Wieland-Memory-Saved", memorySavedCount > 0 ? "1" : "0");
    res.setHeader("X-Wieland-Memory-Count", String(memorySavedCount));
    res.setHeader(
      "X-Wieland-Clarify-Forced",
      shouldForceClarification ? "1" : "0",
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Wieland-Memory-Saved, X-Wieland-Memory-Count, X-Wieland-Clarify-Forced",
    );

    // web search: fetch live sources wenn needed
    if (shouldLookupWeb && webLookupQuery) {
      try {
        webSources = await fetchWebSources(webLookupQuery);
        if (!webSources.length) {
          webUnavailable = true;
        }
      } catch (err) {
        webUnavailable = true;
        console.warn("Web access unavailable:", err?.message || err);
      }
    }

    // build multi-part system prompt: base style + policies + model guidance + runtime context
    const systemPrompt = getSystemPrompt(aiStyle);
    const languageAndStylePolicySystemMessage =
      buildLanguageAndStylePolicySystemMessage(message, previousUserMessage);
    const modelResponseGuidance = getModelResponseGuidance(model, {
      codingRequest: likelyCodingRequest,
    });
    const clarificationStyleSystemMessage =
      buildClarificationStyleSystemMessage();
    const factualSafetySystemMessage = likelyFactualQuery
      ? buildFactualSafetySystemMessage({
          internetAccessEnabled,
          shouldLookupWeb,
          webSourcesCount: webSources.length,
          hasPageContext: !!pageContext,
          webUnavailable,
        })
      : "";

    // runtime context: server time + timezone (for "what time is it" type queries)
    const includeRuntimeSystemContext = shouldIncludeRuntimeClockContext(
      message,
      context,
      intentSignals,
    );
    const runtimeSystemContext = includeRuntimeSystemContext
      ? buildRuntimeSystemContextMessage()
      : "";

    // assemble full messages array für Ollama: system prompts + memories + web sources + conversation history
    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      { role: "system", content: languageAndStylePolicySystemMessage },
      { role: "system", content: modelResponseGuidance },
      ...(shouldAttachClarificationStyleMessage
        ? [{ role: "system", content: clarificationStyleSystemMessage }]
        : []),
      ...(clarifyReply
        ? [
            {
              role: "system",
              content:
                buildClarificationContinueSystemMessage(optionClarifyReply),
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

      const streamResult = await pipeOllamaChatStream(
        ollamaRes,
        res,
        upstreamAbort.signal,
      );
      let streamedAssistantText = streamResult.text;
      const firstDoneReason = streamResult.doneReason;

      if (
        !upstreamAbort.signal.aborted &&
        !res.writableEnded &&
        !res.destroyed &&
        !shouldForceClarification &&
        shouldAutoContinueForDoneReason(firstDoneReason)
      ) {
        const continuationMessages = [
          ...ollamaMessages,
          {
            role: "assistant",
            content: streamedAssistantText,
          },
          {
            role: "user",
            content: buildAutoContinueUserPrompt(likelyCodingRequest),
          },
        ];

        const continuationRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: continuationMessages,
            stream: true,
            options,
            keep_alive: OLLAMA_KEEP_ALIVE,
          }),
          signal: upstreamAbort.signal,
        });

        if (continuationRes.ok) {
          const continuationCollector = {
            writableEnded: false,
            destroyed: false,
            write: () => {},
          };

          const continuationResult = await pipeOllamaChatStream(
            continuationRes,
            continuationCollector,
            upstreamAbort.signal,
          );

          let normalizedContinuationText = normalizeContinuationMarkdown(
            streamedAssistantText,
            continuationResult.text,
          );

          if (normalizedContinuationText) {
            if (
              streamedAssistantText &&
              !/\s$/.test(streamedAssistantText) &&
              !/^\s/.test(normalizedContinuationText) &&
              !res.writableEnded &&
              !res.destroyed
            ) {
              res.write("\n");
              streamedAssistantText += "\n";
            }

            if (!res.writableEnded && !res.destroyed) {
              res.write(normalizedContinuationText);
            }
            streamedAssistantText += normalizedContinuationText;
          }
        } else {
          console.warn(
            "Auto-continue skipped: upstream model error",
            continuationRes.status,
          );
        }
      }

      const repairedAssistantText = ensureClosedMarkdownCodeFence(
        streamedAssistantText,
      );
      if (repairedAssistantText !== streamedAssistantText) {
        const repairSuffix = repairedAssistantText.slice(
          streamedAssistantText.length,
        );
        if (repairSuffix && !res.writableEnded && !res.destroyed) {
          res.write(repairSuffix);
        }
        streamedAssistantText = repairedAssistantText;
      }

      if (shouldForceClarification && !res.writableEnded && !res.destroyed) {
        const finalPayload = await buildForcedClarificationFallbackPayload(
          message,
          streamedAssistantText,
        );

        if (finalPayload) {
          const separator = streamedAssistantText.trim() ? "\n" : "";
          const finalBlock =
            CLARIFY_JSON_BLOCK_START +
            JSON.stringify(finalPayload) +
            CLARIFY_JSON_BLOCK_END;
          res.write(`${separator}${finalBlock}`);
        } else {
          const retryPayload = await buildForcedClarificationFallbackPayload(
            message,
            "",
          );
          if (retryPayload) {
            const separator = streamedAssistantText.trim() ? "\n" : "";
            const retryBlock =
              CLARIFY_JSON_BLOCK_START +
              JSON.stringify(retryPayload) +
              CLARIFY_JSON_BLOCK_END;
            res.write(`${separator}${retryBlock}`);
          }
        }
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

// endpoint: upload image (multipart) → save to disk → return URL für inline references
app.post(
  "/api/history/upload-image",
  requireAuth,
  upload.single("image"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image provided" });
    try {
      // save image: SHA256 hash + MIME type detection
      res.json({ url: saveImageToDisk(req.file.buffer, req.file.mimetype) });
    } catch (err) {
      console.error("Image save error:", err);
      res.status(500).json({ error: "Failed to save image" });
    }
  },
);

// endpoint: POST save/update chat conversation (transaction protected)
// if filename provided: update existing chat, otherwise: create new chat
app.post("/api/history/save", requireAuth, async (req, res) => {
  const { messages, filename, generateTitle } = req.body;
  if (!Array.isArray(messages))
    return res.status(400).json({ error: "messages must be array" });

  const client = await pool.connect();
  const titleModel = getModelForPlan(req.userPlan || "free");
  let txStarted = false;
  try {
    // transaction: atomare chat + message insert/update
    await client.query("BEGIN IMMEDIATE");
    txStarted = true;

    let title = null;
    let chatId, targetFilename;

    if (filename) {
      // update existing: find by user+filename
      const existing = await client.query(
        `SELECT id FROM chats WHERE user_id = ? AND filename = ?`,
        [req.userId, filename],
      );
      if (!existing.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Chat not found" });
      }

      chatId = existing.rows[0].id;
      targetFilename = filename;
      // update timestamp + clear old messages
      await client.query(
        `UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [chatId],
      );
      await client.query(`DELETE FROM chat_messages WHERE chat_id = ?`, [
        chatId,
      ]);
    } else {
      // new chat: generate UUID filename
      const chatUuid = crypto.randomUUID();
      targetFilename = `chat_${chatUuid}.json`;
      const result = await client.query(
        `INSERT INTO chats (user_id, filename) VALUES (?, ?) RETURNING id`,
        [req.userId, targetFilename],
      );
      chatId = result.rows[0].id;
    }

    // insert all messages (user + assistant roles)
    for (const m of messages) {
      if (!m.content) continue;
      await client.query(
        `INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)`,
        [chatId, m.role === "user" ? "user" : "assistant", m.content],
      );
    }

    await client.query("COMMIT");
    txStarted = false;
    res.json({ success: true, filename: targetFilename, title: null });

    // async: generate title in background (nur für neue chats)
    if (generateTitle && !filename) {
      setImmediate(async () => {
        try {
          const firstUser =
            messages.find((m) => m.role === "user")?.content ?? "";
          const clean = firstUser.replace(/!\[.*?\]\([^)]+\)\n\n?/g, "").trim();
          if (clean) {
            const newTitle = await generateChatTitle(clean, titleModel);
            const updateClient = await pool.connect();
            try {
              await updateClient.query(
                `UPDATE chats SET title = ? WHERE id = ?`,
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
    if (txStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    console.error("Save error:", err.message);
    res.status(500).json({ error: "Failed to save chat" });
  } finally {
    client.release();
  }
});

// endpoint: GET single chat by filename (load conversation history)
app.get("/api/history/:filename", requireAuth, async (req, res) => {
  try {
    // fetch chat metadata
    const chatResult = await pool.query(
      `SELECT id, title, created_at, updated_at FROM chats WHERE user_id = ? AND filename = ?`,
      [req.userId, req.params.filename],
    );
    if (!chatResult.rows[0])
      return res.status(404).json({ error: "Not found" });

    const chat = chatResult.rows[0];
    // fetch all messages chronologisch
    const msgResult = await pool.query(
      `SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC`,
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

// endpoint: DELETE single chat by filename
app.delete("/api/history/:filename", requireAuth, async (req, res) => {
  try {
    // cascading delete via foreign keys (messages auto-deleted)
    const result = await pool.query(
      `DELETE FROM chats WHERE user_id = ? AND filename = ? RETURNING id`,
      [req.userId, req.params.filename],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err.message);
    res.status(500).json({ error: "Failed to delete" });
  }
});

// endpoint: GET chat list for user (dashboard: all chats mit message count + preview)
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
       WHERE c.user_id = ?
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

// endpoint: liveness check - ollama status + models list
app.get("/api/health", (_req, res) => {
  // check ob ollama process running ist (über "ollama list" command)
  exec("ollama list", (err, stdout) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      ollama: err ? "unreachable" : "running",
      models: stdout || "none",
    });
  });
});

// error handler middleware: catch all unhandled errors
app.use((err, _req, res, _next) => {
  console.error("Unhandled:", err.message);
  res
    .status(err.status ?? 500)
    .json({ error: err.message || "Internal server error" });
});

// endpoint: public stats - user/chat/message counts (no auth)
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

// endpoint: contact form submission → JSON file in contacts folder
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // create contacts dir + write JSON
    const contactDir = path.join(__dirname, "contacts");
    await fs.promises.mkdir(contactDir, { recursive: true });

    const contactData = {
      name,
      email,
      subject,
      message,
      timestamp: new Date().toISOString(),
    };

    const filename = `contact_${Date.now()}.json`;
    await fs.promises.writeFile(
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
      console.log(
        "[intent-config] timeout:",
        INTENT_NLU_TIMEOUT_MS,
        "model:",
        INTENT_NLU_MODEL,
      );
      void prewarmModelsOnStartup();
    });
  })
  .catch((err) => {
    console.error("DB init failed:", err.message);
    process.exit(1);
  });
