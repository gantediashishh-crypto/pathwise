"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { once } = require("node:events");
const { createApp, openDatabase } = require("../server.js");
const Content = require("../pathwise-content.js");

async function fixture(t) {
  const db = openDatabase(":memory:");
  const server = createApp({ db }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise(r => server.close(r)); db.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("server source, manifests and tests are not publicly downloadable", async t => {
  const base = await fixture(t);
  for (const path of ["/server.js", "/package.json", "/package-lock.json", "/README.md", "/tests/server-api.test.js", "/node_modules/express/package.json", "/.gitignore", "/.pathwise-data/pathwise.sqlite"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, `${path} must not be served`);
  }
});

test("public pages and assets are still served", async t => {
  const base = await fixture(t);
  for (const path of ["/", "/index.html", "/app.js", "/styles.css", "/favicon.svg", "/privacy.html", "/terms.html", "/pathwise-content.js", "/data/course-catalog.json", "/data/mock-tests.json"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, `${path} must be served`);
  }
});

test("static content module exposes complete, well-formed data", () => {
  assert.equal(Content.YEAR_ROADMAP.length, 4);
  assert.ok(Content.INTERVIEW_TOPICS.length >= 4);
  for (const topic of Content.INTERVIEW_TOPICS) {
    assert.ok(topic.id && topic.title && topic.questions.length > 0);
    for (const q of topic.questions) assert.equal(q.length, 2);
  }
  for (const path of Content.CAREER_PATHS) {
    assert.ok(path.links.every(l => /^https:\/\//.test(l.url)));
  }
  assert.ok(Content.LEARNING_RESOURCES.every(r => /^https:\/\//.test(r.url)));
});
