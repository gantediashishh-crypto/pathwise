"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createApi } = require("../pathwise-api.js");

test("API client sends same-origin JSON requests and returns the payload", async () => {
  let actualRequest;
  const api = createApi(async (route, options) => {
    actualRequest = { route, options };
    return { status: 200, ok: true, json: async () => ({ saved: true }) };
  });
  const result = await api.request("/api/state", {
    method: "PUT",
    body: { encryptedData: "ciphertext" }
  });

  assert.deepEqual(result, { saved: true });
  assert.equal(actualRequest.route, "/api/state");
  assert.equal(actualRequest.options.method, "PUT");
  assert.equal(actualRequest.options.credentials, "same-origin");
  assert.equal(actualRequest.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(actualRequest.options.body), { encryptedData: "ciphertext" });
});

test("API client returns null for no-content responses", async () => {
  const api = createApi(async () => ({ status: 204 }));
  assert.equal(await api.request("/api/auth/logout", { method: "POST" }), null);
});

test("API client preserves server errors and status codes", async () => {
  const api = createApi(async () => ({
    status: 429,
    ok: false,
    json: async () => ({ error: "Try again later." })
  }));
  await assert.rejects(api.request("/api/auth/login"), error => {
    assert.equal(error.message, "Try again later.");
    assert.equal(error.status, 429);
    return true;
  });
});

test("API client reports malformed server responses clearly", async () => {
  const api = createApi(async () => ({
    status: 200,
    ok: true,
    json: async () => { throw new SyntaxError("bad json"); }
  }));
  await assert.rejects(api.request("/api/health"), {
    message: "The server returned an invalid response."
  });
});
