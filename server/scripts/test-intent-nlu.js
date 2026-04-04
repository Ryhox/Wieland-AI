#!/usr/bin/env node
/**
 * Intent NLU Test Suite
 * Tests memory store/query, web search, and chat classification
 */

const BASE_URL = "http://localhost:3001";
const TEST_USERNAME = `testuser${Date.now().toString().slice(-6)}`;
const TEST_EMAIL = `test-${Date.now()}@test.local`;
const TEST_PASSWORD = "TestPassword123!";

let authToken = null;
let testResults = {
  passed: 0,
  failed: 0,
  total: 0,
};

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

function log(color, label, message) {
  console.log(`${color}[${label}]${colors.reset} ${message}`);
}

async function request(path, method = "GET", body = null, headers = {}) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  if (authToken) {
    options.headers.Authorization = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const text = await response.text();
    try {
      return {
        ok: response.ok,
        status: response.status,
        data: JSON.parse(text),
      };
    } catch {
      return { ok: response.ok, status: response.status, data: text };
    }
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function registerAndAuth() {
  log(colors.cyan, "AUTH", "Registering test user...");

  const regRes = await request("/api/auth/register", "POST", {
    username: TEST_USERNAME,
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (!regRes.ok && regRes.status !== 409) {
    log(colors.red, "FAIL", `Registration failed: ${regRes.status}`);
    process.exit(1);
  }

  log(colors.cyan, "AUTH", "Logging in...");
  const loginRes = await request("/api/auth/login", "POST", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (!loginRes.ok) {
    log(colors.red, "FAIL", `Login failed: ${loginRes.status}`);
    process.exit(1);
  }

  authToken = loginRes.data?.token;
  if (!authToken) {
    log(colors.red, "FAIL", "No token in response");
    process.exit(1);
  }

  log(colors.green, "OK", `Authenticated as ${TEST_EMAIL}`);
}

async function testPrompt(message, expectedAction, description) {
  testResults.total++;

  try {
    const response = await fetch(`${BASE_URL}/api/chat/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        context: [],
      }),
    });

    if (!response.ok) {
      log(colors.red, "FAIL", `${description} - HTTP ${response.status}`);
      testResults.failed++;
      return false;
    }

    // Parse SSE stream to find intent logs
    const text = await response.text();
    const intentMatch = text.match(/\[intent-raw\](.*?)(?=\n|$)/);
    let intentData = null;

    if (intentMatch) {
      try {
        intentData = JSON.parse(intentMatch[1].trim());
      } catch {
        // Try to extract JSON differently
        const jsonMatch = text.match(/\{[^}]*"action"[^}]*\}/);
        if (jsonMatch) {
          intentData = JSON.parse(jsonMatch[0]);
        }
      }
    }

    const actualAction = intentData?.action || "UNKNOWN";
    const passed = actualAction === expectedAction;

    if (passed) {
      testResults.passed++;
      log(colors.green, "PASS", `${description}`);
      log(colors.gray, "    ", `Message: "${message.substring(0, 60)}..."`);
      log(colors.gray, "    ", `Action: ${actualAction}`);
    } else {
      testResults.failed++;
      log(colors.red, "FAIL", `${description}`);
      log(
        colors.gray,
        "    ",
        `Expected: ${expectedAction}, Got: ${actualAction}`,
      );
      log(colors.gray, "    ", `Message: "${message}"`);
    }

    return passed;
  } catch (err) {
    testResults.failed++;
    log(colors.red, "FAIL", `${description} - ${err.message}`);
    return false;
  }
}

async function runTests() {
  console.log(
    `\n${colors.blue}═══════════════════════════════════════════${colors.reset}`,
  );
  console.log(`${colors.blue}  Intent NLU Test Suite${colors.reset}`);
  console.log(
    `${colors.blue}═══════════════════════════════════════════${colors.reset}\n`,
  );

  await registerAndAuth();

  // MEMORY_STORE Tests
  console.log(`\n${colors.cyan}📝 MEMORY_STORE Tests${colors.reset}`);
  console.log("─".repeat(60));

  await testPrompt("I am 25 years old", "MEMORY_STORE", "EN: Store age");
  await testPrompt("My name is John Smith", "MEMORY_STORE", "EN: Store name");
  await testPrompt("I live in Berlin", "MEMORY_STORE", "EN: Store location");
  await testPrompt(
    "My favorite color is blue",
    "MEMORY_STORE",
    "EN: Store preference",
  );
  await testPrompt(
    "I work as a software engineer",
    "MEMORY_STORE",
    "EN: Store occupation",
  );

  await testPrompt("Ich bin 30 Jahre alt", "MEMORY_STORE", "DE: Store age");
  await testPrompt(
    "Mein Name ist Anna Müller",
    "MEMORY_STORE",
    "DE: Store name",
  );
  await testPrompt("Ich wohne in Wien", "MEMORY_STORE", "DE: Store location");
  await testPrompt(
    "Mein Lieblingsessen ist Schnitzel",
    "MEMORY_STORE",
    "DE: Store preference",
  );

  // MEMORY_QUERY Tests
  console.log(`\n${colors.cyan}🔍 MEMORY_QUERY Tests${colors.reset}`);
  console.log("─".repeat(60));

  await testPrompt(
    "What do you know about me?",
    "MEMORY_QUERY",
    "EN: Query general memory",
  );
  await testPrompt("How old am I?", "MEMORY_QUERY", "EN: Query age");
  await testPrompt("What's my name?", "MEMORY_QUERY", "EN: Query name");
  await testPrompt("Where do I live?", "MEMORY_QUERY", "EN: Query location");
  await testPrompt(
    "What's my favorite food?",
    "MEMORY_QUERY",
    "EN: Query preference",
  );
  await testPrompt(
    "Do you remember anything about me?",
    "MEMORY_QUERY",
    "EN: Query memory",
  );

  await testPrompt("Wie alt bin ich?", "MEMORY_QUERY", "DE: Query age");
  await testPrompt(
    "Was weißt du über mich?",
    "MEMORY_QUERY",
    "DE: Query general",
  );
  await testPrompt("Wie heiße ich?", "MEMORY_QUERY", "DE: Query name");
  await testPrompt("Wo lebe ich?", "MEMORY_QUERY", "DE: Query location");

  // SEARCH_WEB Tests
  console.log(`\n${colors.cyan}🌐 SEARCH_WEB Tests${colors.reset}`);
  console.log("─".repeat(60));

  await testPrompt(
    "What's the weather in Vienna today?",
    "SEARCH_WEB",
    "EN: Weather query",
  );
  await testPrompt("What are the latest news?", "SEARCH_WEB", "EN: News query");
  await testPrompt(
    "What's the current Bitcoin price?",
    "SEARCH_WEB",
    "EN: Price query",
  );
  await testPrompt(
    "How is the weather in Berlin?",
    "SEARCH_WEB",
    "EN: Weather Berlin",
  );
  await testPrompt("What's trending today?", "SEARCH_WEB", "EN: Trends");

  await testPrompt(
    "Wie ist das Wetter in Wien?",
    "SEARCH_WEB",
    "DE: Weather Vienna",
  );
  await testPrompt(
    "Was sind die aktuellen Nachrichten?",
    "SEARCH_WEB",
    "DE: News",
  );

  // CHAT Tests
  console.log(`\n${colors.cyan}💬 CHAT Tests${colors.reset}`);
  console.log("─".repeat(60));

  await testPrompt("Hello!", "CHAT", "EN: Greeting - Hello");
  await testPrompt("Hi there", "CHAT", "EN: Greeting - Hi");
  await testPrompt("Hey, how are you?", "CHAT", "EN: Small talk");
  await testPrompt("Heyho!", "CHAT", "EN: Casual - Heyho");
  await testPrompt("How do I use Python?", "CHAT", "EN: Tech Q&A");
  await testPrompt("Explain React hooks", "CHAT", "EN: Tech explanation");
  await testPrompt("Can you help me debug this?", "CHAT", "EN: Debug request");
  await testPrompt("Tell me a joke", "CHAT", "EN: Entertainment");

  await testPrompt("Hallo!", "CHAT", "DE: Greeting");
  await testPrompt("Wie geht es dir?", "CHAT", "DE: Small talk");
  await testPrompt("Kannst du mir helfen?", "CHAT", "DE: Help request");

  // CLARIFICATION Tests
  console.log(`\n${colors.cyan}❓ CLARIFICATION Tests${colors.reset}`);
  console.log("─".repeat(60));

  await testPrompt(
    "Create a website for me",
    "CHAT",
    "EN: Vague build request (needs clarification)",
  );
  await testPrompt("Build me an app", "CHAT", "EN: Vague build request");
  await testPrompt("Generate a program", "CHAT", "EN: Vague build request");

  // Edge Cases
  console.log(`\n${colors.cyan}⚠️  Edge Cases${colors.reset}`);
  console.log("─".repeat(60));

  await testPrompt(
    "I'm 25 and live in Berlin, what's the weather?",
    "SEARCH_WEB",
    "Ambiguous: Personal + Web",
  );
  await testPrompt(
    "Mein Name ist Jörg Müller",
    "MEMORY_STORE",
    "Special characters",
  );
  await testPrompt("I like things", "MEMORY_STORE", "Vague preference");

  // Results Summary
  console.log(
    `\n${colors.blue}═══════════════════════════════════════════${colors.reset}`,
  );
  console.log(`${colors.blue}  Test Results${colors.reset}`);
  console.log(
    `${colors.blue}═══════════════════════════════════════════${colors.reset}`,
  );
  console.log(
    `${colors.green}✓ Passed: ${testResults.passed}${colors.reset} / ${colors.red}✗ Failed: ${testResults.failed}${colors.reset} / Total: ${testResults.total}`,
  );

  const percentage = ((testResults.passed / testResults.total) * 100).toFixed(
    1,
  );
  console.log(`Success Rate: ${percentage}%\n`);

  if (testResults.failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  log(colors.red, "ERROR", err.message);
  process.exit(1);
});
