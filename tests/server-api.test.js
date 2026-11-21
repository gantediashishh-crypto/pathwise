"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { once } = require("node:events");
const { createApp, openDatabase } = require("../server.js");

async function createFixture(t) {
  const db = openDatabase(":memory:");
  const app = createApp({ db });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    db.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function send(base, route, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload, cookie: response.headers.get("set-cookie")?.split(";")[0] || null };
}

test("serves the application shell, client modules, and externalized data", async t => {
  const base = await createFixture(t);
  const routes = [
    ["/", "text/html"],
    ["/styles.css", "text/css"],
    ["/pathwise-api.js", "javascript"],
    ["/pathwise-ui.js", "javascript"],
    ["/pathwise-student-data.js", "javascript"],
    ["/pathwise-logger.js", "javascript"],
    ["/pathwise-activity.js", "javascript"],
    ["/data/course-catalog.json", "application/json"],
    ["/data/mock-tests.json", "application/json"]
  ];

  for (const [route, contentType] of routes) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, `${route} should be available`);
    assert.match(response.headers.get("content-type"), new RegExp(contentType));
    assert.ok((await response.text()).length > 0);
  }
  const shell = await (await fetch(base)).text();
  assert.ok(shell.indexOf("pathwise-api.js") < shell.indexOf("app.js"));
  assert.ok(shell.indexOf("pathwise-ui.js") < shell.indexOf("app.js"));
  assert.ok(shell.indexOf("pathwise-student-data.js") < shell.indexOf("app.js"));
  assert.ok(shell.indexOf("pathwise-logger.js") < shell.indexOf("app.js"));
  assert.ok(shell.indexOf("pathwise-activity.js") < shell.indexOf("app.js"));
});

test("registration creates a server account with an HttpOnly session cookie", async t => {
  const base = await createFixture(t);
  const result = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "Student@Example.edu", password: "A-strong-test-password" }
  });

  assert.equal(result.response.status, 201);
  assert.equal(result.payload.email, "student@example.edu");
  assert.match(result.payload.dataSalt, /^[a-f0-9]{32}$/);
  assert.match(result.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(result.response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal((await send(base, "/api/state")).response.status, 401);
});

test("account sessions isolate encrypted state and validate payload size and shape", async t => {
  const base = await createFixture(t);
  const first = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "one@example.edu", password: "A-strong-test-password" }
  });
  const second = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "two@example.edu", password: "A-strong-test-password" }
  });
  const encrypted = { dataIv: "a".repeat(24), encryptedData: Buffer.alloc(32, 1).toString("base64") };

  assert.equal((await send(base, "/api/state", {
    method: "PUT",
    cookie: first.cookie,
    body: encrypted
  })).response.status, 200);
  assert.deepEqual((await send(base, "/api/state", { cookie: second.cookie })).payload, {
    email: "two@example.edu",
    dataSalt: second.payload.dataSalt,
    dataIv: null,
    encryptedData: null
  });
  assert.equal((await send(base, "/api/state", {
    method: "PUT",
    cookie: first.cookie,
    body: { dataIv: "bad", encryptedData: "plaintext" }
  })).response.status, 400);
});

test("login rejects bad credentials and accepts case-normalized email", async t => {
  const base = await createFixture(t);
  await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "student@example.edu", password: "A-strong-test-password" }
  });
  const badPassword = await send(base, "/api/auth/login", {
    method: "POST",
    body: { email: "student@example.edu", password: "wrong-password" }
  });
  const goodPassword = await send(base, "/api/auth/login", {
    method: "POST",
    body: { email: "STUDENT@example.edu", password: "A-strong-test-password" }
  });

  assert.equal(badPassword.response.status, 401);
  assert.equal(goodPassword.response.status, 200);
  assert.equal(goodPassword.payload.email, "student@example.edu");
  assert.ok(goodPassword.cookie);
});

test("sign-in throttling does not block account registration", async t => {
  const base = await createFixture(t);
  const credentials = { email: "student@example.edu", password: "A-strong-test-password" };

  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await send(base, "/api/auth/login", { method: "POST", body: credentials });
    assert.equal(response.response.status, 401);
  }
  assert.equal((await send(base, "/api/auth/login", {
    method: "POST",
    body: credentials
  })).response.status, 429);

  const registration = await send(base, "/api/auth/register", {
    method: "POST",
    body: credentials
  });
  assert.equal(registration.response.status, 201);
});

test("sign-in throttling is isolated by account on shared networks", async t => {
  const base = await createFixture(t);
  const password = "A-strong-test-password";
  await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "first@example.edu", password }
  });
  await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "second@example.edu", password }
  });

  for (let attempt = 0; attempt < 8; attempt++) {
    const failed = await send(base, "/api/auth/login", {
      method: "POST",
      body: { email: "first@example.edu", password: "Wrong-password" }
    });
    assert.equal(failed.response.status, 401);
  }
  assert.equal((await send(base, "/api/auth/login", {
    method: "POST",
    body: { email: "first@example.edu", password }
  })).response.status, 429);
  assert.equal((await send(base, "/api/auth/login", {
    method: "POST",
    body: { email: "second@example.edu", password }
  })).response.status, 200);
});

test("server-side advisor audit validates input and reports prerequisite blockers", async t => {
  const base = await createFixture(t);
  const account = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "audit@example.edu", password: "A-strong-test-password" }
  });
  const validProfile = {
    branch: "Computer Science",
    semester: 1,
    coding: "Beginner",
    goal: "AI/ML Engineer"
  };
  const audit = await send(base, "/api/advisor-audit", {
    method: "POST",
    cookie: account.cookie,
    body: { profile: validProfile, completed: [], enrolled: ["CS302"] }
  });
  const invalid = await send(base, "/api/advisor-audit", {
    method: "POST",
    cookie: account.cookie,
    body: { profile: { ...validProfile, semester: 99 }, completed: [], enrolled: [] }
  });

  assert.equal(audit.response.status, 200);
  assert.ok(audit.payload.summary.recommendedCourses > 0);
  assert.equal(audit.payload.issues[0].code, "PREREQUISITES_NOT_MET");
  assert.ok(audit.payload.recommendations.length > 0);
  assert.equal(invalid.response.status, 400);
});

test("course actions enforce prerequisite and enrollment status on the server", async t => {
  const base = await createFixture(t);
  const account = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "actions@example.edu", password: "A-strong-test-password" }
  });
  const common = {
    profile: {
      branch: "Computer Science",
      semester: 1,
      coding: "Beginner",
      goal: "AI/ML Engineer"
    },
    completed: [],
    enrolled: []
  };
  const locked = await send(base, "/api/course-action", {
    method: "POST",
    cookie: account.cookie,
    body: { ...common, action: "enroll", courseCode: "CS302" }
  });
  const available = await send(base, "/api/course-action", {
    method: "POST",
    cookie: account.cookie,
    body: { ...common, action: "enroll", courseCode: "CS101" }
  });
  const unstarted = await send(base, "/api/course-action", {
    method: "POST",
    cookie: account.cookie,
    body: { ...common, action: "complete", courseCode: "CS101" }
  });

  assert.equal(locked.response.status, 409);
  assert.equal(available.response.status, 200);
  assert.equal(unstarted.response.status, 409);
});

test("server-side assessment validation rejects malformed or out-of-range marks", async t => {
  const base = await createFixture(t);
  const account = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "marks@example.edu", password: "A-strong-test-password" }
  });
  const valid = await send(base, "/api/assessment/validate", {
    method: "POST",
    cookie: account.cookie,
    body: {
      type: "theory",
      record: { mid1: 20, mid2: 20, assignment1: 5, assignment2: 5, viva: 5, see: 21 }
    }
  });
  const invalid = await send(base, "/api/assessment/validate", {
    method: "POST",
    cookie: account.cookie,
    body: {
      type: "lab",
      record: { record: 16, internalTest: 0, vivaProject: 0, writeup: 0, execution: 0, analysis: 0, externalViva: 0 }
    }
  });

  assert.equal(valid.response.status, 200);
  assert.equal(valid.payload.result.passed, true);
  assert.equal(invalid.response.status, 400);
});

test("account deletion removes only that account and its sessions", async t => {
  const base = await createFixture(t);
  const first = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "remove@example.edu", password: "A-strong-test-password" }
  });
  const second = await send(base, "/api/auth/register", {
    method: "POST",
    body: { email: "keep@example.edu", password: "A-strong-test-password" }
  });
  const deleted = await send(base, "/api/account", { method: "DELETE", cookie: first.cookie });
  const removedAccess = await send(base, "/api/state", { cookie: first.cookie });
  const retainedAccess = await send(base, "/api/state", { cookie: second.cookie });

  assert.equal(deleted.response.status, 204);
  assert.equal(removedAccess.response.status, 401);
  assert.equal(retainedAccess.response.status, 200);
});

test("cross-origin mutation requests are rejected", async t => {
  const base = await createFixture(t);
  const response = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ email: "student@example.edu", password: "A-strong-test-password" })
  });

  assert.equal(response.status, 403);
});
