#!/usr/bin/env node

/**
 * Multi-language Intent Classification Test
 * Tests the NLU model with prompts in English, German, and Italian
 * to validate that intent classification works across languages
 */

const BASE_URL = "http://localhost:3001";
const TEST_USERNAME = `testuser${Date.now().toString().slice(-6)}`;
const TEST_EMAIL = `test-${Date.now()}@test.local`;
const TEST_PASSWORD = "TestPassword123!";

let authToken = null;

// Test cases across multiple languages
const testCases = [
  // ==================== ENGLISH TESTS ====================
  {
    language: "English",
    type: "MEMORY_STORE",
    prompt: "My name is John Smith",
  },
  { language: "English", type: "MEMORY_STORE", prompt: "I am 30 years old" },
  {
    language: "English",
    type: "MEMORY_STORE",
    prompt: "My favorite color is blue",
  },
  {
    language: "English",
    type: "MEMORY_STORE",
    prompt: "I work as a software engineer",
  },
  { language: "English", type: "MEMORY_QUERY", prompt: "What is my name?" },
  { language: "English", type: "MEMORY_QUERY", prompt: "How old am I?" },
  { language: "English", type: "MEMORY_QUERY", prompt: "Where do I live?" },
  {
    language: "English",
    type: "SEARCH_WEB",
    prompt: "What is the weather in London today?",
  },
  {
    language: "English",
    type: "SEARCH_WEB",
    prompt: "Tell me about recent AI breakthroughs",
  },
  { language: "English", type: "CHAT", prompt: "Hello, how are you?" },

  // ==================== GERMAN TESTS ====================
  {
    language: "German",
    type: "MEMORY_STORE",
    prompt: "Mein Name ist Anna Müller",
  },
  { language: "German", type: "MEMORY_STORE", prompt: "Ich bin 28 Jahre alt" },
  {
    language: "German",
    type: "MEMORY_STORE",
    prompt: "Meine liebste Farbe ist Grün",
  },
  {
    language: "German",
    type: "MEMORY_STORE",
    prompt: "Ich arbeite als Ärztin",
  },
  { language: "German", type: "MEMORY_QUERY", prompt: "Wie heiße ich?" },
  { language: "German", type: "MEMORY_QUERY", prompt: "Wie alt bin ich?" },
  { language: "German", type: "MEMORY_QUERY", prompt: "Wo lebe ich?" },
  {
    language: "German",
    type: "SEARCH_WEB",
    prompt: "Wie ist das Wetter in Berlin heute?",
  },
  {
    language: "German",
    type: "SEARCH_WEB",
    prompt: "Erzähl mir von den neuesten Technologie-News",
  },
  { language: "German", type: "CHAT", prompt: "Guten Tag, wie geht es dir?" },

  // ==================== ITALIAN TESTS ====================
  {
    language: "Italian",
    type: "MEMORY_STORE",
    prompt: "Mi chiamo Marco Rossi",
  },
  { language: "Italian", type: "MEMORY_STORE", prompt: "Ho 32 anni" },
  {
    language: "Italian",
    type: "MEMORY_STORE",
    prompt: "Il mio colore preferito è rosso",
  },
  {
    language: "Italian",
    type: "MEMORY_STORE",
    prompt: "Lavoro come insegnante",
  },
  { language: "Italian", type: "MEMORY_QUERY", prompt: "Come mi chiamo?" },
  { language: "Italian", type: "MEMORY_QUERY", prompt: "Quanti anni ho?" },
  { language: "Italian", type: "MEMORY_QUERY", prompt: "Dove vivo?" },
  {
    language: "Italian",
    type: "SEARCH_WEB",
    prompt: "Quale è il meteo a Roma oggi?",
  },
  {
    language: "Italian",
    type: "SEARCH_WEB",
    prompt: "Dimmi le ultime notizie sulla tecnologia",
  },
  { language: "Italian", type: "CHAT", prompt: "Ciao, come stai?" },
];

async function request(path, method = "GET", body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
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
  console.log("\n🔐 Setting up authentication...\n");

  const regRes = await request("/api/auth/register", "POST", {
    username: TEST_USERNAME,
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (!regRes.ok && regRes.status !== 409) {
    console.error("❌ Registration failed:", regRes.status);
    process.exit(1);
  }

  const loginRes = await request("/api/auth/login", "POST", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (!loginRes.ok) {
    console.error("❌ Login failed:", loginRes.status);
    process.exit(1);
  }

  authToken = loginRes.data?.token;
  if (!authToken) {
    console.error("❌ No token in response");
    process.exit(1);
  }

  console.log(`✅ Authenticated as ${TEST_EMAIL}\n`);
}

async function sendTestPrompt(testCase, index) {
  return new Promise(async (resolve) => {
    try {
      const result = await request("/api/chat/stream", "POST", {
        message: testCase.prompt,
      });
      resolve({
        index,
        testCase,
        success: result.ok,
        statusCode: result.status,
      });
    } catch (error) {
      resolve({
        index,
        testCase,
        success: false,
        error: error.message,
      });
    }
  });
}

async function runTests() {
  // First, authenticate
  await registerAndAuth();

  console.log(
    "\n╔════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║         MULTI-LANGUAGE INTENT CLASSIFICATION TEST            ║",
  );
  console.log(
    "║                  (English, German, Italian)                  ║",
  );
  console.log(
    "╚════════════════════════════════════════════════════════════════╝\n",
  );

  console.log(`📋 Total test cases: ${testCases.length}\n`);
  console.log("💡 Instructions:");
  console.log(
    "   1. Watch the server console for [intent-raw] and [intent-classified] logs",
  );
  console.log(
    "   2. Verify each classification matches the expected type in the list below",
  );
  console.log(
    "   3. Check that memory is properly stored/retrieved across languages\n",
  );

  // Group tests by language and type
  const groupedTests = {};
  testCases.forEach((test) => {
    const key = test.language;
    if (!groupedTests[key]) {
      groupedTests[key] = {};
    }
    if (!groupedTests[key][test.type]) {
      groupedTests[key][test.type] = [];
    }
    groupedTests[key][test.type].push(test.prompt);
  });

  // Display test plan
  console.log("📝 TEST PLAN:\n");
  Object.entries(groupedTests).forEach(([language, types]) => {
    console.log(`\n🌍 ${language}:`);
    Object.entries(types).forEach(([type, prompts]) => {
      console.log(`   ${type}:`);
      prompts.forEach((prompt, idx) => {
        console.log(`      ${idx + 1}. "${prompt}"`);
      });
    });
  });

  console.log("\n" + "=".repeat(70));
  console.log("🚀 SENDING TEST PROMPTS...\n");

  // Send all test prompts
  const results = [];
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const result = await sendTestPrompt(testCase, i + 1);
    results.push(result);

    const status = result.success ? "✅" : "❌";
    const language = testCase.language.padEnd(8);
    const type = testCase.type.padEnd(14);
    console.log(
      `${status} [${i + 1}/${testCases.length}] ${language} | ${type} | "${testCase.prompt.substring(0, 40)}${testCase.prompt.length > 40 ? "..." : ""}"`,
    );

    // Small delay to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("\n📊 TEST SUMMARY:\n");

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  console.log(`✅ Passed: ${successCount}/${testCases.length}`);
  console.log(`❌ Failed: ${failureCount}/${testCases.length}`);

  // Group results by language
  console.log("\n📈 Results by Language:\n");
  Object.entries(groupedTests).forEach(([language]) => {
    const langResults = results.filter((r) => r.testCase.language === language);
    const langSuccess = langResults.filter((r) => r.success).length;
    const langTotal = langResults.length;
    console.log(`${language.padEnd(10)} ${langSuccess}/${langTotal} passed`);
  });

  // Group results by intent type
  console.log("\n📈 Results by Intent Type:\n");
  const intentTypes = [...new Set(testCases.map((t) => t.type))];
  intentTypes.forEach((type) => {
    const typeResults = results.filter((r) => r.testCase.type === type);
    const typeSuccess = typeResults.filter((r) => r.success).length;
    const typeTotal = typeResults.length;
    console.log(`${type.padEnd(15)} ${typeSuccess}/${typeTotal} passed`);
  });

  console.log("\n" + "=".repeat(70));
  console.log("\n📌 NEXT STEPS:\n");
  console.log("1. Review server logs for [intent-raw] classifications");
  console.log("2. Verify each prompt was classified as its expected type");
  console.log(
    "3. Check [memory-query] logs to see if memory retrieval works across languages",
  );
  console.log("4. Note any patterns in failures (if any)\n");

  if (failureCount > 0) {
    console.log(
      "⚠️  Some tests failed. Check network connectivity and server status.\n",
    );
  } else {
    console.log(
      "✨ All prompts sent successfully! Check server logs for classifications.\n",
    );
  }
}

// Run the tests
runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
