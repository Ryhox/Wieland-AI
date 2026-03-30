require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

function printUsage() {
  console.log("Usage: npm run make-admin -- --email <user@example.com>");
  console.log("   or: npm run make-admin -- --username <username>");
}

function parseArgs(argv) {
  const args = { email: null, username: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--email") {
      args.email = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (token === "--username") {
      args.username = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    }
  }
  return args;
}

function validateInput({ email, username, help }) {
  if (help) return { ok: false, help: true };
  const hasEmail = Boolean(email);
  const hasUsername = Boolean(username);

  if ((hasEmail && hasUsername) || (!hasEmail && !hasUsername)) {
    return {
      ok: false,
      error: "Provide exactly one of --email or --username.",
    };
  }

  if (hasEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 255) {
      return { ok: false, error: "Invalid email format." };
    }
  }

  if (hasUsername) {
    const usernameRegex = /^[a-zA-Z0-9_-]{3,32}$/;
    if (!usernameRegex.test(username)) {
      return {
        ok: false,
        error: "Username must be 3-32 chars (letters, digits, _ -).",
      };
    }
  }

  return { ok: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const validation = validateInput(args);

  if (!validation.ok) {
    if (validation.error) console.error(validation.error);
    printUsage();
    process.exit(validation.help ? 0 : 1);
  }

  const dbPath = process.env.SQLITE_PATH || "./data/wieland.sqlite";
  const resolvedDbPath = path.isAbsolute(dbPath)
    ? dbPath
    : path.resolve(__dirname, "..", dbPath);

  const db = await open({ filename: resolvedDbPath, driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");

  try {
    const user = args.email
      ? await db.get(
          "SELECT id, username, email, plan FROM users WHERE LOWER(email) = LOWER(?)",
          [args.email],
        )
      : await db.get(
          "SELECT id, username, email, plan FROM users WHERE username = ?",
          [args.username],
        );

    if (!user) {
      console.error("User not found.");
      process.exit(1);
    }

    if (user.plan === "Admin") {
      console.log(`User already admin: ${user.username} <${user.email}>`);
      process.exit(0);
    }

    const result = await db.run("UPDATE users SET plan = ? WHERE id = ?", [
      "Admin",
      user.id,
    ]);
    if (result.changes !== 1) {
      console.error("No change applied.");
      process.exit(1);
    }

    console.log(`Admin granted: ${user.username} <${user.email}>`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("make-admin failed:", err.message);
  process.exit(1);
});
