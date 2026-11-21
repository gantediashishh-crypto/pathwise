"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { escapeHtml, renderDailyStreak, renderProgressChart } = require("../pathwise-ui.js");

test("HTML escaping protects text and quoted attributes", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">&`),
    "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;"
  );
});

test("daily streak markup escapes date labels and retains accessible status text", () => {
  const markup = renderDailyStreak({
    currentStreak: 1,
    activeToday: false,
    week: [{ label: "<x>", title: `" onmouseover="alert(1)`, active: true, today: false }]
  });

  assert.match(markup, /aria-label="Daily learning streak"/);
  assert.match(markup, /Keep it going/);
  assert.match(markup, /&lt;x&gt;/);
  assert.match(markup, /&quot; onmouseover=&quot;alert\(1\)/);
});

test("progress graph rejects malformed data and renders valid credit history", () => {
  assert.match(renderProgressChart([
    { date: "<script>", creditsCompleted: 4, totalCredits: 20 },
    { date: "2026-01-02", creditsCompleted: 4, totalCredits: 20 }
  ], 20), /<svg class="progress-chart"/);
  assert.match(renderProgressChart([
    { date: "<script>", creditsCompleted: "<img>", totalCredits: 20 }
  ], 20), /Complete a course to start your progress graph/);
});
